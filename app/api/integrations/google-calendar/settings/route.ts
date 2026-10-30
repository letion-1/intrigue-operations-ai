import {NextRequest,NextResponse} from "next/server";
import {owner,googleOrigin,ownerBlob,ownerAccess,googleEvents,defaultSettings,validateZone} from "@/lib/intrigue-google-calendar";
const json=(v:unknown,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"no-store"}});
export async function GET(){const ctx=await owner();if(!ctx)return json({error:"Company owner required"},403);
  try{const [blob,lookup]=await Promise.all([ownerBlob(ctx),ctx.db.from("intrigue_google_booking_settings").select("time_zone,start_hour,end_hour,duration_minutes,booking_enabled").eq("workspace_id",ctx.workspace).maybeSingle()]);
    if(lookup.error)throw Error("Run V15.7 SQL migration first");
    const settings=lookup.data||defaultSettings;
    if(!blob)return json({connected:false,settings,events:[]});
    let events:Array<{id:string;title:string;start:string}>=[],warning="";
    try{const access=await ownerAccess(ctx);if(access)events=await googleEvents(access);}catch(e){warning=e instanceof Error?e.message:"Could not load calendar";}
    return json({connected:true,settings,events,warning});
  }catch(e){return json({error:e instanceof Error?e.message:"Calendar settings unavailable"},503);}}
export async function PUT(request:NextRequest){const ctx=await owner();if(!ctx)return json({error:"Company owner required"},403);
  if(request.headers.get("origin")!==googleOrigin())return json({error:"Cross-origin request denied"},403);
  let body:Record<string,unknown>;try{body=await request.json();}catch{return json({error:"Invalid JSON"},400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Invalid settings"},400);
  const zone=body.time_zone,begin=body.start_hour,end=body.end_hour,duration=body.duration_minutes,enabled=body.booking_enabled;
  if(typeof zone!=="string"||!validateZone(zone)||!Number.isInteger(begin)||!Number.isInteger(end)||!Number.isInteger(duration)||
    (begin as number)<0||(begin as number)>22||(end as number)<1||(end as number)>23||(end as number)<=(begin as number)||
    ![30,60].includes(duration as number)||typeof enabled!=="boolean")return json({error:"Check timezone, hours, duration and enabled state"},400);
  try{if(!await ownerBlob(ctx))return json({error:"Connect Google Calendar first"},409);
    const {error}=await ctx.db.from("intrigue_google_booking_settings").upsert({workspace_id:ctx.workspace,time_zone:zone,start_hour:begin,end_hour:end,duration_minutes:duration,booking_enabled:enabled,updated_at:new Date().toISOString()},{onConflict:"workspace_id"});
    if(error)throw Error("Could not save Google Calendar booking settings");return json({saved:true,enabled});
  }catch(e){return json({error:e instanceof Error?e.message:"Could not save preferences"},502);}}
export async function DELETE(request:NextRequest){const ctx=await owner();if(!ctx)return json({error:"Company owner required"},403);
  if(request.headers.get("origin")!==googleOrigin())return json({error:"Cross-origin request denied"},403);
  const {error}=await ctx.db.rpc("intrigue_v157_google_owner_connection",{p_workspace_id:ctx.workspace,p_action:"delete"});
  return error?json({error:"Could not disconnect Google Calendar"},502):json({disconnected:true});}
