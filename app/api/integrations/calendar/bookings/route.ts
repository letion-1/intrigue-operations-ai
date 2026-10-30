import { NextRequest,NextResponse } from "next/server";
import { activeTokens,ownerContext,validProvider } from "@/lib/intrigue-calendar-server";

type Booking={id:string;title:string;start:string;end:string;status:string;provider:string};
export async function GET(request:NextRequest){
  const provider=request.nextUrl.searchParams.get("provider");
  if(!validProvider(provider))return NextResponse.json({error:"Choose Cal.com or Calendly"},{status:400});
  const ctx=await ownerContext();
  if(!ctx)return NextResponse.json({error:"Company-owner access required"},{status:403});
  try{
    const token=await activeTokens(ctx,provider);
    if(!token)return NextResponse.json({error:"Connect this provider first"},{status:409});
    const headers={Authorization:`Bearer ${token.access_token}`};
    let bookings:Booking[]=[];
    if(provider==="cal"){
      const response=await fetch("https://api.cal.com/v2/bookings?status=upcoming",{
        headers:{...headers,"cal-api-version":"2026-05-01"},cache:"no-store",signal:AbortSignal.timeout(12000),
      });
      if(!response.ok)throw new Error(`Cal.com bookings failed (${response.status})`);
      const result=await response.json() as {data?:Array<Record<string,unknown>>};
      bookings=(result.data||[]).slice(0,20).map(b=>({
        id:String(b.uid||b.id||""),title:String(b.title||"Meeting"),
        start:String(b.start||""),end:String(b.end||""),status:String(b.status||"upcoming"),provider,
      }));
    }else{
      const me=await fetch("https://api.calendly.com/users/me",{headers,cache:"no-store",signal:AbortSignal.timeout(12000)});
      if(!me.ok)throw new Error(`Calendly user lookup failed (${me.status})`);
      const user=await me.json() as {resource?:{uri?:string}};
      const uri=user.resource?.uri||"";
      if(!/^https:\/\/api\.calendly\.com\/users\/[A-Za-z0-9_-]+$/.test(uri))throw new Error("Invalid Calendly user identifier");
      const params=new URLSearchParams({user:uri,status:"active",min_start_time:new Date().toISOString(),count:"20"});
      const response=await fetch(`https://api.calendly.com/scheduled_events?${params}`,{
        headers,cache:"no-store",signal:AbortSignal.timeout(12000),
      });
      if(!response.ok)throw new Error(`Calendly events failed (${response.status})`);
      const result=await response.json() as {collection?:Array<Record<string,unknown>>};
      bookings=(result.collection||[]).slice(0,20).map(b=>({
        id:String(b.uri||""),title:String(b.name||"Meeting"),
        start:String(b.start_time||""),end:String(b.end_time||""),status:String(b.status||"active"),provider,
      }));
    }
    return NextResponse.json({bookings:bookings.filter(b=>b.start).sort((a,b)=>a.start.localeCompare(b.start)).slice(0,10)},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Could not fetch bookings"},{status:502});}
}
