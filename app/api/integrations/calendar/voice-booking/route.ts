import { NextRequest,NextResponse } from "next/server";
import {activeTokens,ownerContext,siteOrigin} from "@/lib/intrigue-calendar-server";

const headers={"Cache-Control":"no-store"};
const eventUri=/^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9_-]{8,100}$/;
async function availableTypes(access:string){
  const userReq=await fetch("https://api.calendly.com/users/me",{
    headers:{Authorization:`Bearer ${access}`},cache:"no-store",signal:AbortSignal.timeout(12000),
  });
  if(!userReq.ok)throw Error(`Calendly user lookup failed (${userReq.status}). Reconnect the account.`);
  const profile=await userReq.json() as {resource?:{uri?:string}};
  const user=profile.resource?.uri||"";
  if(!/^https:\/\/api\.calendly\.com\/users\/[A-Za-z0-9_-]+$/.test(user))throw Error("Calendly returned an invalid user identifier");
  const query=new URLSearchParams({user,active:"true",count:"100"});
  const req=await fetch(`https://api.calendly.com/event_types?${query}`,{
    headers:{Authorization:`Bearer ${access}`},cache:"no-store",signal:AbortSignal.timeout(12000),
  });
  if(!req.ok)throw Error(req.status===403?"Calendly event_types:read permission missing. Reconnect.":`Calendly meeting types unavailable (${req.status})`);
  const data=await req.json() as {collection?:Array<{uri?:string;name?:string;duration?:number;booking_method?:string;is_paid?:boolean;custom_questions?:Array<{required?:boolean}>}>};
  return (data.collection||[]).filter(e=>eventUri.test(e.uri||"")&&e.booking_method==="instant"&&e.is_paid!==true&&!(e.custom_questions||[]).some(q=>q.required===true))
    .map(e=>({uri:e.uri!,name:(e.name||"Meeting").slice(0,100),duration:e.duration||null})).slice(0,100);
}
export async function GET(){
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner access required"},{status:403,headers});
  const {data:settings,error}=await ctx.supabase.from("intrigue_voice_booking_settings")
    .select("event_type_uri,booking_enabled").eq("workspace_id",ctx.workspaceId).maybeSingle();
  if(error)return NextResponse.json({error:"V15.6 SQL migration is required"},{status:503,headers});
  try{
    const tokens=await activeTokens(ctx,"calendly");
    if(!tokens)return NextResponse.json({connected:false,event_types:[],settings:settings||null},{headers});
    const types=await availableTypes(tokens.access_token);
    return NextResponse.json({connected:true,event_types:types,settings:settings||null},{headers});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Calendly API unavailable",settings:settings||null},{status:502,headers});}
}
export async function PUT(request:NextRequest){
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner access required"},{status:403,headers});
  if(request.headers.get("origin")!==siteOrigin())return NextResponse.json({error:"Cross-origin request denied"},{status:403,headers});
  let body:unknown;
  try{body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400,headers});}
  const input=body&&typeof body==="object"&&!Array.isArray(body)?body as Record<string,unknown>:{};
  const event_type_uri=typeof input.event_type_uri==="string"?input.event_type_uri:"";
  const enabled=input.enabled===true;
  if(!eventUri.test(event_type_uri)||typeof input.enabled!=="boolean")return NextResponse.json({error:"Select a valid Calendly meeting type"},{status:400,headers});
  try{
    const tokens=await activeTokens(ctx,"calendly");
    if(!tokens)return NextResponse.json({error:"Connect Calendly first"},{status:409,headers});
    const types=await availableTypes(tokens.access_token);
    if(!types.some(e=>e.uri===event_type_uri))return NextResponse.json({error:"Meeting type is not available to your connected Calendly account or requires custom booking questions"},{status:400,headers});
    const {error}=await ctx.supabase.from("intrigue_voice_booking_settings").upsert({
      workspace_id:ctx.workspaceId,event_type_uri,booking_enabled:enabled,updated_at:new Date().toISOString(),
    },{onConflict:"workspace_id"});
    if(error)throw Error("Could not save voice-booking preferences");
    return NextResponse.json({saved:true,enabled},{headers});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Calendar configuration failed"},{status:502,headers});}
}
