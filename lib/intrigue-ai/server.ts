import 'server-only';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {platformAuth,uuid,LifecycleError} from '@/lib/intrigue-platform';

export type Provider='openrouter'|'vapi';
export type ApiContext=Awaited<ReturnType<typeof platformAuth>>;
export const isProvider=(v:unknown):v is Provider=>v==='openrouter'||v==='vapi';
const month=()=>new Date().toISOString().slice(0,7)+'-01';
const asNumber=(v:unknown)=>typeof v==='number'?v:Number(v||0);
export const defaultPlan={text_mode:'managed',voice_mode:'managed',text_provider:'openrouter',voice_provider:'vapi',text_budget_usd:30,voice_seconds_limit:0};

function secretKey(){
 const key=Buffer.from(process.env.INTRIGUE_AI_CREDENTIAL_ENCRYPTION_KEY||'','base64');
 if(key.length!==32)throw new LifecycleError(503,'Company AI credential encryption is not configured.');
 return key;
}
export function encryptCredential(raw:string){
 const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',secretKey(),iv);
 const encrypted=Buffer.concat([c.update(raw,'utf8'),c.final()]);
 return 'v1.'+[iv.toString('base64url'),c.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptCredential(cipher:string){
 const parts=cipher.split('.');
 if(parts.length!==4||parts[0]!=='v1')throw new LifecycleError(409,'Provider connection requires reconnection.');
 try{
  const d=createDecipheriv('aes-256-gcm',secretKey(),Buffer.from(parts[1],'base64url'));
  d.setAuthTag(Buffer.from(parts[2],'base64url'));
  return Buffer.concat([d.update(Buffer.from(parts[3],'base64url')),d.final()]).toString('utf8');
 }catch{throw new LifecycleError(409,'Provider connection requires reconnection.');}
}
export async function requireCompanyOwner(ctx:ApiContext,workspace:unknown){
 if(!uuid(workspace))throw new LifecycleError(400,'Select a valid company workspace.');
 const [owners,open]=await Promise.all([
  ctx.service.from('workspaces').select('id,owner_id').eq('id',workspace).maybeSingle(),
  ctx.service.rpc('intrigue_platform_workspace_open',{p_tenant:workspace}),
 ]);
 if(owners.error||open.error)throw new LifecycleError(503,'Company authorization is unavailable.');
 if(!owners.data||open.data!==true)throw new LifecycleError(403,'Company is inactive or unavailable.');
 if(owners.data.owner_id!==ctx.user.id){
  const {data,error}=await ctx.service.from('workspace_memberships').select('role').eq('workspace_id',workspace).eq('user_id',ctx.user.id).maybeSingle();
  if(error)throw new LifecycleError(503,'Company ownership could not be verified.');
  if(data?.role!=='owner')throw new LifecycleError(403,'Only the company owner can change AI provider connections.');
 }
 return workspace;
}
export async function loadPlan(service:SupabaseClient,workspace:string){
 const {data,error}=await service.from('intrigue_ai_plans').select('text_mode,voice_mode,text_provider,voice_provider,text_budget_usd,voice_seconds_limit,updated_at')
  .eq('workspace_id',workspace).maybeSingle();
 if(error)throw new LifecycleError(503,'AI plan storage is unavailable. Apply the AI Governance migration.');
 return {...defaultPlan,...(data||{})};
}
export async function loadUsage(service:SupabaseClient,workspace:string){
 const {data,error}=await service.rpc('intrigue_ai_usage_summary',{p_workspace:workspace});
 if(error||!data||typeof data!=='object')throw new LifecycleError(503,'AI usage summary is unavailable.');
 const values=data as Record<string,unknown>;
 return {text_usd:asNumber(values.text_usd),voice_seconds:asNumber(values.voice_seconds),
  pending_jobs:asNumber(values.pending_jobs),text_requests:asNumber(values.text_requests),
  voice_calls:asNumber(values.voice_calls),byok_usd:asNumber(values.byok_usd)};
}
export async function loadStatus(service:SupabaseClient,workspace:string){
 const [plan,usage,connections]=await Promise.all([
  loadPlan(service,workspace),loadUsage(service,workspace),
  service.from('intrigue_ai_connections').select('provider,updated_at').eq('workspace_id',workspace)
 ]);
 if(connections.error)throw new LifecycleError(503,'AI connection status is unavailable.');
 return {plan,usage,connections:(connections.data||[]).map(x=>({provider:x.provider,connected:true,updated_at:x.updated_at})),
   runtime:{text_byok_active:process.env.INTRIGUE_AI_BYOK_ACTIVATION_ENABLED==='true',
            voice_byok_active:process.env.INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED==='true'},
   period_start:month()};
}
export async function storeCredential(ctx:ApiContext,workspace:string,provider:Provider,raw:string){
 if(raw.length<12||raw.length>5000||raw.includes('\n')||raw.includes('\r'))throw new LifecycleError(400,'Enter a valid provider API key.');
 // Fixed provider hosts only. Never accept a user-supplied endpoint or URL.
 const uri=provider==='openrouter'?'https://openrouter.ai/api/v1/key':'https://api.vapi.ai/assistant?limit=1';
 let resp:Response;
 try{resp=await fetch(uri,{headers:{Authorization:`Bearer ${raw}`},signal:AbortSignal.timeout(12000),cache:'no-store'});}
 catch{throw new LifecycleError(502,'Provider could not be reached. No key was saved.');}
 if(!resp.ok){throw new LifecycleError(resp.status===401||resp.status===403?400:502,
  resp.status===401||resp.status===403?'Provider rejected the supplied API key.':'Provider validation failed. Try again.');}
 if(provider==='openrouter'){
  const info:unknown=await resp.json().catch(()=>null);
  const data=info&&typeof info==='object'&&!Array.isArray(info)?(info as Record<string,unknown>).data:null;
  if(data&&typeof data==='object'&&!Array.isArray(data)&&(data as Record<string,unknown>).is_management_key===true)
   throw new LifecycleError(400,'Use an OpenRouter inference key, not a management key.');
 }
 const cipher=encryptCredential(raw);
 const {error}=await ctx.service.from('intrigue_ai_connections').upsert({workspace_id:workspace,provider,secret_cipher:cipher,
  created_by:ctx.user.id,updated_at:new Date().toISOString()},{onConflict:'workspace_id,provider'});
 if(error)throw new LifecycleError(503,'Provider connection could not be stored.');
}
export async function getCredential(service:SupabaseClient,workspace:string,provider:Provider){
 const {data,error}=await service.from('intrigue_ai_connections').select('secret_cipher').eq('workspace_id',workspace).eq('provider',provider).maybeSingle();
 if(error)throw new LifecycleError(503,'Provider connection cannot be read.');
 if(!data)throw new LifecycleError(409,'The company-owned provider has not been connected.');
 return decryptCredential(String(data.secret_cipher));
}
