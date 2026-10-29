import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {crossOrigin} from "@/lib/ai-security";

export async function POST(request: Request) {
  if (crossOrigin(request)) return NextResponse.json({error:"Cross-origin request refused."},{status:403,headers:{"Cache-Control":"no-store"}});
  if (Number(request.headers.get("content-length") || 0) > 1500) return NextResponse.json({error:"Request too large."},{status:413});
  if (!request.headers.get("content-type")?.includes("application/json")) return NextResponse.json({error:"Expected JSON."},{status:415});
  const supabase = await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({error:"Sign in first."},{status:401});
  let body: {id?:unknown;decision?:unknown};
  try {body=await request.json();} catch {return NextResponse.json({error:"Invalid JSON."},{status:400});}
  if (typeof body.id!=="string" || !/^[0-9a-fA-F-]{36}$/.test(body.id) ||
      (body.decision!=="approve" && body.decision!=="reject")) {
    return NextResponse.json({error:"Invalid proposal ID or decision."},{status:400});
  }
  const {data,error}=await supabase.rpc("decide_operations_proposal",{
    p_proposal_id:body.id,p_decision:body.decision,
  });
  if (error) return NextResponse.json({error:error.message},{status:409});
  return NextResponse.json({result:data},{headers:{"Cache-Control":"no-store"}});
}
