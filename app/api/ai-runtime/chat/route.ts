import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import type {NextRequest} from 'next/server';
import {json} from '@/lib/intrigue-platform';
import {getCredential,loadPlan} from '@/lib/intrigue-ai/server';

export const maxDuration=60;
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestKey=/^[A-Za-z0-9_.:-]{8,128}$/;
function safeEquals(a:string,b:string){
 const aa=Buffer.from(a),bb=Buffer.from(b);
 return aa.length===bb.length&&aa.length>0&&timingSafeEqual(aa,bb);
}
function db(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key)throw Error('Server database credentials missing.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
const error=(message:string,status=503)=>json({error:message},status);
function validMessages(v:unknown):v is Array<Record<string,unknown>>{
 if(!Array.isArray(v)||v.length===0||v.length>30)return false;
 return v.every(m=>!!m&&typeof m==='object'&&!Array.isArray(m)&&
   ['system','developer','user','assistant','tool'].includes(m.role)&&
   // Tool-calling assistant messages may have null content.
   (m.content===null||typeof m.content==='string'||Array.isArray(m.content)));
}
async function generationCost(key:string,idValue:string):Promise<number|null>{
 try{
  const r=await fetch('https://openrouter.ai/api/v1/generation?id='+encodeURIComponent(idValue),{
   headers:{Authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(9000)});
  if(!r.ok)return null;
  const j=await r.json() as {data?:{total_cost?:number;usage?:number}};
  return typeof j.data?.total_cost==='number'?j.data.total_cost:
    typeof j.data?.usage==='number'?j.data.usage:null;
 }catch{return null;}
}
export async function POST(req:NextRequest){
 const configured=process.env.INTRIGUE_AI_WORKER_TOKEN||'';
 const provided=req.headers.get('x-intrigue-worker-token')||'';
 if(configured.length<32||!safeEquals(provided,configured))return error('Unauthorized internal automation request.',401);
 let body:Record<string,unknown>;
 try{
  const raw=await req.text();
  if(raw.length>65536)return error('Automation request exceeds the supported size.',413);
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return error('Invalid automation request.',400);
  body=parsed as Record<string,unknown>;
 }catch{return error('Invalid automation request.',400);}
 const {workspace_id,request_key,messages}=body;
 const purpose=body.purpose===undefined?null:body.purpose;
 if(purpose!==null&&purpose!=='quotation_intent')
  return error('Unsupported automation request purpose.',400);
 if(typeof workspace_id!=='string'||!id.test(workspace_id)||typeof request_key!=='string'||!requestKey.test(request_key)||!validMessages(messages))
  return error('Invalid workspace, request ID or messages.',400);
 if(!Number.isInteger(body.max_tokens)||Number(body.max_tokens)<1||Number(body.max_tokens)>2000)
  return error('Set a maximum output length between 1 and 2000 tokens.',400);
 // Callers cannot select arbitrary expensive models or arbitrary URLs.
 const maxTokens=Number(body.max_tokens);
 const model=(process.env.INTRIGUE_AI_APPROVED_MODEL||'').trim();
 if(!model||model.length>100)return error('An approved AI model has not been configured.');
 const estimate=Number(process.env.INTRIGUE_AI_RESERVATION_USD||'1.00');
 if(!Number.isFinite(estimate)||estimate<0.01||estimate>100)return error('AI reservation policy is unavailable.');
 try{
  const service=db();
  const plan=await loadPlan(service,workspace_id);
  if(plan.text_provider!=='openrouter')return error('Selected provider is not supported by this runtime.',409);
  if(plan.text_mode==='byok'&&process.env.INTRIGUE_AI_BYOK_ACTIVATION_ENABLED!=='true')
   return error('Company-owned model routing has not been activated.',409);
  const key=plan.text_mode==='byok'?await getCredential(service,workspace_id,'openrouter'):(process.env.OPENROUTER_API_KEY||'');
  if(!key)return error('Selected AI provider credentials are unavailable.',503);
  const {data:reserved,error:reserveError}=await service.rpc('intrigue_ai_reserve',{
   p_workspace:workspace_id,p_request_key:request_key,p_kind:'text',p_estimated_usd:estimate,p_seconds:0});
  if(reserveError)return error('Usage could not be reserved. Company may be frozen or unavailable.',403);
  if(reserved?.approved!==true)return error(reserved?.duplicate?'Request already submitted; do not replay it.':
    'The company has reached its included AI allowance.',reserved?.duplicate?409:429);
  // Past this point, provider status may be uncertain. Do not cancel the reservation on timeout.
  let response:Response;
  try{
   response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
    method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',
      'HTTP-Referer':process.env.INTRIGUE_APP_URL||'https://intriguestudios.de',
      'X-Title':'INTRIGUE Operations AI'},
    body:JSON.stringify({model,messages,max_tokens:maxTokens,
      ...(Array.isArray(body.tools)?{tools:body.tools}:{}),
      ...(typeof body.tool_choice==='string'?{tool_choice:body.tool_choice}:{}),
      ...(purpose==='quotation_intent'?{temperature:0.1,response_format:{type:'json_object'}}:{}),
      stream:false}),signal:AbortSignal.timeout(45000),cache:'no-store'});
  }catch{return error('AI provider timed out. The request remains reserved for cost reconciliation.',504);}
  if(!response.ok)return error('AI provider request failed; the reservation remains pending review.',502);
  const result:unknown=await response.json().catch(()=>null);
  if(!result||typeof result!=='object'||Array.isArray(result))
   return error('Provider returned an invalid response; cost reconciliation is required.',502);
  const r=result as Record<string,unknown>;
  const u=r.usage&&typeof r.usage==='object'&&!Array.isArray(r.usage)?r.usage as Record<string,unknown>:{};
  let cost=typeof u.cost==='number'?u.cost:null;
  if(cost===null&&typeof r.id==='string')cost=await generationCost(key,r.id);
  const validCost=typeof cost==='number'&&Number.isFinite(cost)&&cost>=0&&cost<=100000;
  let reconciled=false;
  if(validCost){
   const {data,error:settleError}=await service.rpc('intrigue_ai_settle',{
    p_workspace:workspace_id,p_request_key:request_key,p_actual_usd:cost,p_actual_seconds:0,
    p_input_tokens:Number.isInteger(u.prompt_tokens)?u.prompt_tokens:null,
    p_output_tokens:Number.isInteger(u.completion_tokens)?u.completion_tokens:null,
    p_provider_ref:typeof r.id==='string'?r.id:null});
   reconciled=!settleError&&data===true;
  }
  return json({completion:result,usage:{reconciled,payer:plan.text_mode,
    note:reconciled?'Provider cost recorded.':'Provider cost not yet confirmed; reservation held.'}});
 }catch{
  // Do not leak provider secrets or internal database errors in responses.
  return error('AI runtime is not configured or the provider connection requires attention.');
 }
}
