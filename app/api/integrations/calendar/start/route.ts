import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ownerContext,providerConfig,siteOrigin,validProvider } from "@/lib/intrigue-calendar-server";

export async function GET(request:NextRequest) {
  const provider=request.nextUrl.searchParams.get("provider");
  if(!validProvider(provider))return NextResponse.json({error:"Unknown calendar provider"},{status:400});
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner login required"},{status:403});
  try {
    const canonical=siteOrigin();
    if(request.nextUrl.origin !== canonical)return NextResponse.json({error:"Open the permanent INTRIGUE domain to connect a calendar"},{status:400});
    const config=providerConfig(provider);
    const state=randomBytes(32).toString("base64url");
    const verifier=randomBytes(32).toString("base64url");
    const params=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,state});
    let url:string;
    if(provider==="cal") {
      params.set("scope","BOOKING_READ");
      url=`https://app.cal.com/auth/oauth2/authorize?${params.toString()}`;
    } else {
      params.set("scope","users:read scheduled_events:read event_types:read availability:read scheduled_events:write");
      params.set("response_type","code");
      params.set("code_challenge_method","S256");
      params.set("code_challenge",createHash("sha256").update(verifier).digest("base64url"));
      url=`https://auth.calendly.com/oauth/authorize?${params.toString()}`;
    }
    const response=NextResponse.redirect(url);
    response.cookies.set("intrigue_calendar_oauth",JSON.stringify({state,provider,verifier,workspaceId:ctx.workspaceId,userId:ctx.userId,createdAt:Date.now()}),{
      httpOnly:true,secure:canonical.startsWith("https:"),sameSite:"lax",maxAge:600,path:"/api/integrations/calendar",
    });
    return response;
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"Calendar setup unavailable"},{status:503});
  }
}
