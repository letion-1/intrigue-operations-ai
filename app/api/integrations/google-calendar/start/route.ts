import {randomBytes} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {googleOrigin,googleClient,owner} from "@/lib/intrigue-google-calendar";
export async function GET(request:NextRequest){
  const ctx=await owner();if(!ctx)return NextResponse.json({error:"Company owner login required"},{status:403});
  try{
    const origin=googleOrigin();if(request.nextUrl.origin!==origin)return NextResponse.json({error:"Use the permanent INTRIGUE domain"},{status:400});
    const config=googleClient();const state=randomBytes(32).toString("base64url");
    const params=new URLSearchParams({client_id:config.id,redirect_uri:config.redirect,response_type:"code",access_type:"offline",prompt:"consent",include_granted_scopes:"false",
      scope:"https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events",state});
    const res=NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    res.cookies.set("intrigue_google_oauth",JSON.stringify({state,userId:ctx.userId,workspace:ctx.workspace,createdAt:Date.now()}),
      {httpOnly:true,secure:origin.startsWith("https:"),sameSite:"lax",maxAge:600,path:"/api/integrations/google-calendar"});
    return res;
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Google authorization unavailable"},{status:503});}
}
