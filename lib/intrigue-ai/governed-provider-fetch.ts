/**
 * Workspace budget gate for trusted, authenticated INTRIGUE server routes.
 * Never call from browser code or from a request body containing user-chosen workspace ID.
 * Controlled rollout: no change to existing provider paths until browser metering flag is enabled.
 */
import 'server-only';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {getCredential,loadPlan} from '@/lib/intrigue-ai/server';

export type MeteredEndpoint='chat'|'embedding';
const HOST='https://openrouter.ai/api/v1/';
const errorResponse=(reason:string,status:number)=>new Response(JSON.stringify({error:reason}),
  {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:null;
const isObj=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function service(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key)throw Error('Missing database connection');
 return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
}
async function lookupCost(key:string,id:string):Promise<number|null>{
 if(!id||id.length>250)return null;
 try{
  const r=await fetch(HOST+'generation?id='+encodeURIComponent(id),{
   headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(3000),cache:'no-store'});
  if(!r.ok)return null;
  const result:unknown=await r.json();
  if(!isObj(result)||!isObj(result.data))return null;
  return number(result.data.total_cost)??number(result.data.usage);
 }catch{return null;}
}

export async function governedOpenRouterFetch(workspaceId:string,endpoint:MeteredEndpoint,init:RequestInit):Promise<Response>{
 const url=HOST+(endpoint==='chat'?'chat/completions':'embeddings');
 if(process.env.INTRIGUE_AI_BROWSER_METERING_ENABLED!=='true')return fetch(url,init);
 // Strict route-level workspace provenance. Callers must derive it from auth / RLS,
 // never from a client-supplied workspace_id.
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId))return errorResponse('Invalid company context.',403);
 if(init.method!=='POST'||typeof init.body!=='string'||init.body.length>262144)
  return errorResponse('Invalid AI request.',400);
 let payload:Record<string,unknown>;
 try{const parsed:unknown=JSON.parse(init.body);if(!isObj(parsed))throw Error('invalid');payload=parsed;}
 catch{return errorResponse('Invalid AI request payload.',400);}
 const model=payload.model;
 if(typeof model!=='string'||model.length>120||!model.trim())return errorResponse('AI model not configured.',503);
 // Approved-model policy can pin both server-side chat routes to one model.
 const approved=(process.env.INTRIGUE_AI_APPROVED_MODEL||'').trim();
 if(approved&&endpoint==='chat'&&model!==approved)return errorResponse('AI model is not approved for this workspace.',409);
 if(endpoint==='chat'){
  if(!Array.isArray(payload.messages)||payload.messages.length>32||
      !Number.isInteger(payload.max_tokens)||Number(payload.max_tokens)<1||Number(payload.max_tokens)>2000)
    return errorResponse('AI request is outside the supported limits.',400);
 }else if(!Array.isArray(payload.input)||payload.input.length<1||payload.input.length>24)
  return errorResponse('Invalid embedding request.',400);
 const estimate=Number(process.env.INTRIGUE_AI_RESERVATION_USD||'1.00');
 if(!Number.isFinite(estimate)||estimate<0.01||estimate>100)
  return errorResponse('AI cost reservation policy is unavailable.',503);
 const requestKey=`${endpoint}:${randomUUID()}`;
 let providerKey:string;
 let db:ReturnType<typeof service>;
 try{
  db=service();
  const plan=await loadPlan(db,workspaceId);
  if(plan.text_provider!=='openrouter')return errorResponse('Unsupported AI provider.',409);
  if(plan.text_mode==='byok'){
   if(process.env.INTRIGUE_AI_BYOK_ACTIVATION_ENABLED!=='true')return errorResponse('Company-owned routing is not active.',409);
   providerKey=await getCredential(db,workspaceId,'openrouter');
  }else providerKey=process.env.OPENROUTER_API_KEY||'';
  if(!providerKey)return errorResponse('AI provider credentials are unavailable.',503);
  const {data,error}=await db.rpc('intrigue_ai_reserve',{
   p_workspace:workspaceId,p_request_key:requestKey,p_kind:'text',p_estimated_usd:estimate,p_seconds:0});
  if(error)return errorResponse('Usage authorization failed. Company may be frozen or unavailable.',403);
  if(data?.approved!==true)return errorResponse(data?.reason==='text_allowance_exhausted'
   ?'The company has reached its included AI allowance.':'AI request could not be reserved.',429);
 }catch{return errorResponse('AI usage service is temporarily unavailable.',503);}
 // Do not put provider credentials or arbitrary remote endpoints in client-controlled inputs.
 // Preserve the original request's deadline and server-defined payload, but replace its credentials.
 let response:Response;
 try{
  response=await fetch(url,{method:'POST',body:init.body,signal:init.signal,cache:'no-store',
   headers:{Authorization:`Bearer ${providerKey}`,'Content-Type':'application/json',
    'HTTP-Referer':process.env.INTRIGUE_APP_URL||'https://intriguestudios.de',
    'X-Title':'INTRIGUE Operations AI'}});
 }catch{return errorResponse('AI provider did not respond. Usage is awaiting reconciliation.',504);}
 if(!response.ok)return errorResponse('AI provider returned an error. Usage is awaiting reconciliation.',502);
 let content:unknown;
 try{content=await response.json();}catch{
  return errorResponse('AI provider returned an invalid response. Usage is awaiting reconciliation.',502);
 }
 if(!isObj(content))return errorResponse('AI provider returned an invalid response.',502);
 const usage=isObj(content.usage)?content.usage:{};
 let cost=number(usage.cost);
 if(cost===null&&typeof content.id==='string')cost=await lookupCost(providerKey,content.id);
 // Unknown costs remain reserved. Never cancel once a provider call was attempted.
 if(cost!==null&&cost>=0&&cost<=100000){
  try{
   const {error}=await db.rpc('intrigue_ai_settle',{
    p_workspace:workspaceId,p_request_key:requestKey,p_actual_usd:cost,p_actual_seconds:0,
    p_input_tokens:Number.isInteger(usage.prompt_tokens)?usage.prompt_tokens:null,
    p_output_tokens:Number.isInteger(usage.completion_tokens)?usage.completion_tokens:null,
    p_provider_ref:typeof content.id==='string'?content.id:null});
   if(error)console.error('[AI_USAGE_SETTLEMENT_FAILED]',endpoint);
  }catch{console.error('[AI_USAGE_SETTLEMENT_FAILED]',endpoint);}
 }else console.warn('[AI_USAGE_COST_UNKNOWN]',endpoint);
 return new Response(JSON.stringify(content),{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
