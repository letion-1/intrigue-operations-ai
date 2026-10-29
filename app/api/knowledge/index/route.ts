import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { embedTexts } from "@/lib/semantic-embeddings";
import { crossOrigin, quotaErrorResponse } from "@/lib/ai-security";

const respond = (body: object, status = 200) => NextResponse.json(body, {status, headers:{"Cache-Control":"no-store"}});

type Chunk = {id:string;content:string};
type Note = {id:string;title:string;content:string};

export async function POST(request: Request) {
  if (crossOrigin(request)) return respond({error:"Cross-origin request refused."},403);
  const supabase = await createClient();
  const {data:{user},error:authError} = await supabase.auth.getUser();
  if (authError || !user) return respond({error:"Sign in first."},401);

  const {data:workspace,error:wsError} = await supabase.from("workspaces")
    .select("id").eq("owner_id",user.id).maybeSingle();
  if (wsError || !workspace) return respond({error:"Workspace unavailable."},409);

  // Index at most 12 passages per explicit button click, to cap API cost.
  // Separate from document uploads so billing is never triggered by uploading.
  const [chunksRes, notesRes] = await Promise.all([
    supabase.from("knowledge_document_chunks").select("id,content")
      .eq("workspace_id",workspace.id).is("embedding",null).order("created_at").limit(8),
    supabase.from("knowledge_entries").select("id,title,content")
      .eq("workspace_id",workspace.id).is("embedding",null).order("created_at").limit(4),
  ]);
  if (chunksRes.error || notesRes.error) return respond({error:"Run the V7 SQL migration in Supabase first."},503);
  const chunks=(chunksRes.data || []) as Chunk[];
  const notes=(notesRes.data || []) as Note[];
  const items = [
    ...chunks.map(c => ({kind:"document" as const,id:c.id,text:c.content.slice(0,2500)})),
    ...notes.map(n => ({kind:"note" as const,id:n.id,text:`${n.title}: ${n.content}`.slice(0,4500)})),
  ];
  if (!items.length) return respond({indexed:0,message:"All available knowledge is already indexed."});
  const { error: quotaError } = await supabase.rpc("consume_intrigue_ai_quota", { p_kind: "index" });
  if (quotaError) return quotaErrorResponse(quotaError);

  let vectors:number[][];
  try { vectors=await embedTexts(items.map(i=>i.text)); }
  catch(err) { return respond({error:err instanceof Error ? err.message : "Embedding failed."},502); }

  let indexed=0;
  for (let index=0; index<items.length; index++) {
    const item=items[index];
    const table=item.kind==="document" ? "knowledge_document_chunks" : "knowledge_entries";
    const {error}=await supabase.from(table).update({embedding:vectors[index]})
      .eq("id",item.id).eq("workspace_id",workspace.id);
    if (error) return respond({error:`Indexed ${indexed} records, but a database write failed. Please verify RLS and try again.`},500);
    indexed++;
  }
  return respond({indexed,message:`Indexed ${indexed} knowledge sections. Run again if you have more unindexed files.`});
}
