import { NextRequest,NextResponse } from "next/server";
import { getStored,ownerContext,siteOrigin,validProvider } from "@/lib/intrigue-calendar-server";

export async function GET(){
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner access required"},{status:403});
  try {
    const [cal,calendly]=await Promise.all([getStored(ctx,"cal"),getStored(ctx,"calendly")]);
    return NextResponse.json({cal:{connected:!!cal,connected_at:cal?.connected_at||null},calendly:{connected:!!calendly,connected_at:calendly?.connected_at||null}},{headers:{"Cache-Control":"no-store"}});
  } catch {return NextResponse.json({error:"Calendar connection status unavailable"},{status:503});}
}
export async function DELETE(request:NextRequest){
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner access required"},{status:403});
  try {
    const origin=request.headers.get("origin");
    if(origin!==siteOrigin())return NextResponse.json({error:"Cross-origin requests denied"},{status:403});
    const body=await request.json() as {provider?:string};
    if(!validProvider(body.provider||null))return NextResponse.json({error:"Unsupported provider"},{status:400});
    const {error}=await ctx.supabase.rpc("intrigue_calendar_connection",{
      p_workspace_id:ctx.workspaceId,p_provider:body.provider,p_operation:"delete",
    });
    if(error)throw new Error(error.message);
    return NextResponse.json({connected:false},{headers:{"Cache-Control":"no-store"}});
  } catch{return NextResponse.json({error:"Could not disconnect calendar"},{status:400});}
}
