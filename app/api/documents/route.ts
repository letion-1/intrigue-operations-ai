import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractText, getDocumentProxy } from "unpdf";

// V6 intentionally persists extracted TEXT only, not the uploaded PDF/TXT binary.
// Local-first MVP limits protect the server from large or expensive documents.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 15;
const MAX_CHARS = 45000;
const MAX_CHUNKS = 36;
const CHUNK_SIZE = 2200;
const OVERLAP = 100;
const respond = (body: object, status=200) => NextResponse.json(body, {status, headers:{"Cache-Control":"no-store"}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getWorkspace() {
  const supabase = await createClient();
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user) return {supabase, workspace:null};
  const result=await supabase.from("workspaces").select("id").eq("owner_id",user.id).maybeSingle();
  return {supabase, workspace:result.data, lookupError:result.error};
}

function chunkPages(pages: string[]) {
  const chunks: {chunk_index:number;page_no:number;content:string}[]=[];
  let characters=0;
  for (let index=0; index<pages.length; index++) {
    const page=pages[index].replace(/\r/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
    characters+=page.length;
    if (characters>MAX_CHARS) throw new Error("Too much extracted text. Use a shorter document (up to 45,000 characters).");
    for (let start=0; start<page.length; start+=CHUNK_SIZE-OVERLAP) {
      const text=page.slice(start,start+CHUNK_SIZE).trim();
      if (text.length>=10) chunks.push({chunk_index:chunks.length,page_no:index+1,content:text});
      if (chunks.length>MAX_CHUNKS) throw new Error("Too much document text for this demo. Split it into smaller files.");
    }
  }
  return {chunks,characters};
}

export async function POST(request:Request) {
  const {supabase,workspace,lookupError}=await getWorkspace();
  if (lookupError) return respond({error:"Cannot load workspace."},500);
  if (!workspace) return respond({error:"Please sign in and create your workspace first."},401);
  const sizeHeader=Number(request.headers.get("content-length") || 0);
  if (sizeHeader>MAX_BYTES+100000) return respond({error:"File limit is 2 MB."},413);
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) return respond({error:"Expected a file upload."},415);

  let uploaded:FormDataEntryValue|null;
  try {
    const form=await request.formData();
    uploaded=form.get("file");
  } catch {return respond({error:"Could not read uploaded file."},400);}
  if (!(uploaded instanceof File)) return respond({error:"Choose a PDF, TXT or Markdown file."},400);
  const filename=uploaded.name.split(/[\\/]/).pop()?.trim() || "document";
  const ext=filename.toLowerCase().split(".").pop();
  if (!ext || !["pdf","txt","md"].includes(ext)) return respond({error:"Allowed types: .pdf, .txt, .md"},415);
  if (!uploaded.size || uploaded.size>MAX_BYTES) return respond({error:"File must be 1 byte to 2 MB."},413);
  if (filename.length>160) return respond({error:"Filename is too long (maximum 160 characters)."},400);

  let pages:string[];
  try {
    const bytes=new Uint8Array(await uploaded.arrayBuffer());
    if (ext==="pdf") {
      if (new TextDecoder("ascii").decode(bytes.slice(0,5))!=="%PDF-") return respond({error:"This doesn't look like a valid PDF file."},400);
      // unpdf uses PDF.js with a serverless worker. Scanned PDFs without a text layer cannot be read here.
      const pdf=await getDocumentProxy(bytes,{maxImageSize:16_777_216});
      if (pdf.numPages>MAX_PAGES) return respond({error:`This demo supports PDFs up to ${MAX_PAGES} pages.`},413);
      const extracted=await extractText(pdf,{mergePages:false});
      pages=Array.isArray(extracted.text) ? extracted.text : [extracted.text];
    } else {
      const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
      if (text.includes("\u0000")) return respond({error:"Text file appears to contain binary data."},400);
      pages=[text];
    }
  } catch {return respond({error:"Could not extract readable text. Try a text-based PDF, TXT or Markdown file."},422);}
  const allText=pages.join(" ").trim();
  if (allText.length<40) return respond({error:"No readable text detected. Scanned PDFs need OCR, which is not included yet."},422);
  let parsed:ReturnType<typeof chunkPages>;
  try {parsed=chunkPages(pages);} catch(err) {return respond({error:err instanceof Error ? err.message : "Document is too large."},413);}
  if (!parsed.chunks.length) return respond({error:"No usable text chunks could be extracted."},422);

  const {data:document,error:docError}=await supabase.from("knowledge_documents").insert({
    workspace_id:workspace.id, filename, file_type:ext, byte_size:uploaded.size,
    page_count:pages.length, characters:parsed.characters,
  }).select("id,filename,page_count,characters").single();
  if (docError || !document) return respond({error:`Unable to save document metadata. Run V6 SQL first. ${docError?.message||""}`},500);
  const {error:chunkError}=await supabase.from("knowledge_document_chunks").insert(parsed.chunks.map(c=>({
    ...c,document_id:document.id,workspace_id:workspace.id,
  })));
  if (chunkError) {
    await supabase.from("knowledge_documents").delete().eq("id",document.id).eq("workspace_id",workspace.id);
    return respond({error:`Unable to store document text: ${chunkError.message}`},500);
  }
  return respond({document,chunks:parsed.chunks.length},201);
}

export async function DELETE(request:Request) {
  const {supabase,workspace,lookupError}=await getWorkspace();
  if (lookupError) return respond({error:"Cannot load workspace."},500);
  if (!workspace) return respond({error:"Sign in again."},401);
  let id:string|undefined;
  try {id=(await request.json())?.id;} catch {return respond({error:"Expected JSON."},400);}
  if (typeof id!=="string" || !uuid.test(id)) return respond({error:"Invalid document ID."},400);
  const result=await supabase.from("knowledge_documents").delete().eq("id",id).eq("workspace_id",workspace.id).select("id");
  if (result.error) return respond({error:"Could not delete document."},500);
  if (!result.data?.length) return respond({error:"Document not found."},404);
  return respond({deleted:true});
}
