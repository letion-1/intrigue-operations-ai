import { timingSafeEqual } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { exchangeTokens,ownerContext,putStored,siteOrigin,validProvider } from "@/lib/intrigue-calendar-server";

type Flow={state:string;provider:string;verifier:string;workspaceId:string;userId:string;createdAt:number};
const same=(a:string,b:string)=>{
  const first=Buffer.from(a),second=Buffer.from(b);
  return first.length===second.length && timingSafeEqual(first,second);
};
export async function GET(request:NextRequest) {
  let origin:string;
  try { origin=siteOrigin(); } catch {return NextResponse.json({error:"OAuth site origin missing"},{status:503});}
  const result=(outcome:"connected"|"failed")=>{
    const response=NextResponse.redirect(new URL(`/dashboard?integration=${outcome}`,origin));
    response.cookies.set("intrigue_calendar_oauth","",{path:"/api/integrations/calendar",maxAge:0,httpOnly:true,secure:origin.startsWith("https:"),sameSite:"lax"});
    return response;
  };
  if(request.nextUrl.origin!==origin)return NextResponse.json({error:"OAuth callback domain mismatch"},{status:400});
  const raw=request.cookies.get("intrigue_calendar_oauth")?.value;
  let flow:Flow;
  try {flow=JSON.parse(raw||"") as Flow;}catch{return result("failed");}
  const code=request.nextUrl.searchParams.get("code");
  const state=request.nextUrl.searchParams.get("state");
  if(!code || !state || !flow.state || !same(state,flow.state) || Date.now()-flow.createdAt>600_000 || !validProvider(flow.provider))return result("failed");
  const ctx=await ownerContext();
  if(!ctx || ctx.workspaceId!==flow.workspaceId || ctx.userId!==flow.userId)return result("failed");
  try {
    const tokens=await exchangeTokens(flow.provider,"authorization_code",code,flow.verifier);
    await putStored(ctx,flow.provider,tokens);
    return result("connected");
  } catch {return result("failed");}
}
