import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
const json=(data:object,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(request:Request) {
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin) return json({error:"Cross-origin request refused."},403);
  if(!request.headers.get("content-type")?.includes("application/json")) return json({error:"Expected JSON."},415);
  if(Number(request.headers.get("content-length")||0)>1500) return json({error:"Request too large."},413);
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError || !user) return json({error:"Sign in first."},401);
  let body:{id?:unknown;title?:unknown;date?:unknown};
  try {body=await request.json();} catch {return json({error:"Invalid JSON."},400);}
  if(typeof body.id!=="string" || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(body.id) ||
     typeof body.title!=="string" || body.title.trim().length<3 || body.title.trim().length>300 ||
     typeof body.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
     Number.isNaN(Date.parse(`${body.date}T12:00:00Z`))) {
    return json({error:"A valid proposal ID, task title, and YYYY-MM-DD date are required."},400);
  }
  const {data,error}=await supabase.rpc("edit_operations_proposal",{
    p_proposal_id:body.id,p_title:body.title.trim(),p_date:body.date,
  });
  if(error) return json({error:error.message},409);
  return json({result:data});
}
