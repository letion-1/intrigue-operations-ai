import {timingSafeEqual} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {googleOrigin,owner,googleTokenExchange,saveOwnerBlob} from "@/lib/intrigue-google-calendar";
type Flow={state:string;userId:string;workspace:string;createdAt:number};
export async function GET(request:NextRequest){
  let origin:string;try{origin=googleOrigin();}catch{return NextResponse.json({error:"Google OAuth origin unavailable"},{status:503});}
  const finish=(ok:boolean)=>{const r=NextResponse.redirect(new URL(`/dashboard?google_calendar=${ok?"connected":"failed"}`,origin));
    r.cookies.set("intrigue_google_oauth","",{httpOnly:true,secure:origin.startsWith("https:"),sameSite:"lax",maxAge:0,path:"/api/integrations/google-calendar"});return r;};
  if(request.nextUrl.origin!==origin)return NextResponse.json({error:"OAuth origin mismatch"},{status:400});
  const raw=request.cookies.get("intrigue_google_oauth")?.value;
  let flow:Flow;try{flow=JSON.parse(raw||"") as Flow;}catch{return finish(false);}
  const code=request.nextUrl.searchParams.get("code"),state=request.nextUrl.searchParams.get("state");
  const expected=Buffer.from(flow.state||""),received=Buffer.from(state||"");
  if(!code||!state||expected.length<20||received.length!==expected.length||!timingSafeEqual(expected,received)||Date.now()-flow.createdAt>600000||Date.now()<flow.createdAt)return finish(false);
  const ctx=await owner();if(!ctx||ctx.userId!==flow.userId||ctx.workspace!==flow.workspace)return finish(false);
  try{const tokens=await googleTokenExchange({code});await saveOwnerBlob(ctx,tokens);return finish(true);}catch{return finish(false);}
}
