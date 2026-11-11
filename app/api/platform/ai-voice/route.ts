import type {NextRequest} from 'next/server';
import {randomBytes} from 'node:crypto';
import {platformAuth,mustBeOperator,checkOrigin,uuid,json,apiError,LifecycleError} from '@/lib/intrigue-platform';
import {tokenDigest,voiceService,verifyVapiRoute} from '@/lib/intrigue-ai/voice-gate';

type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
export async function GET(req:NextRequest){
 try{
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const ws=req.nextUrl.searchParams.get('workspace_id');
  if(!uuid(ws))throw new LifecycleError(400,'Select a valid company.');
  const [routes,pending]=await Promise.all([
   ctx.service.from('intrigue_ai_voice_routes')
    .select('phone_number_id,assistant_id,provider_mode,reservation_seconds,active,verified_at,updated_at')
    .eq('workspace_id',ws).order('updated_at',{ascending:false}),
   ctx.service.rpc('intrigue_ai_voice_pending',{p_workspace:ws})
  ]);
  if(routes.error||pending.error)throw new LifecycleError(503,'Voice monitoring is unavailable.');
  return json({routes:routes.data||[],pending:pending.data});
 }catch(error){return apiError(error);}
}
export async function POST(req:NextRequest){
 try{
  checkOrigin(req);
  const ctx=await platformAuth(req);await mustBeOperator(ctx);
  const b=obj(await req.json().catch(()=>null));
  if(!uuid(b.workspace_id)||!uuid(b.phone_number_id))
   throw new LifecycleError(400,'Select a company and a valid Vapi phone-number ID.');
  const workspace=String(b.workspace_id),phoneId=String(b.phone_number_id);
  const action=b.action;
  const {data:open,error:openError}=await ctx.service.rpc('intrigue_platform_workspace_open',{p_tenant:workspace});
  if(openError||open!==true)throw new LifecycleError(403,'Company is frozen or unavailable.');
  if(action==='provision'){
   if(!uuid(b.assistant_id)||(b.provider_mode!=='managed'&&b.provider_mode!=='byok'))
    throw new LifecycleError(400,'Select a valid assistant and provider mode.');
   // Generated once. Stored as a SHA-256 digest, never readable from the DB or GET.
   const token=randomBytes(32).toString('hex');
   const {error}=await ctx.service.from('intrigue_ai_voice_routes').upsert({
    workspace_id:workspace,phone_number_id:phoneId,assistant_id:String(b.assistant_id),
    provider_mode:b.provider_mode,token_sha256:tokenDigest(token),active:false,
    verified_at:null,updated_at:new Date().toISOString()
   },{onConflict:'workspace_id,phone_number_id'});
   if(error)throw new LifecycleError(409,'Cannot provision this phone number. It may already belong to another company.');
   return json({saved:true,active:false,one_time_token:token,
    call_gate_url:`${req.nextUrl.origin}/api/integrations/vapi/call-gate`,
    existing_assistant_webhook_url:`${req.nextUrl.origin}/api/integrations/vapi/webhook`,
    message:'Save this one-time token securely as a Vapi custom bearer credential on the phone number. Do not assign a fixed assistant to the phone.'});
  }
  if(action==='disable'){
   const {error}=await ctx.service.from('intrigue_ai_voice_routes').update({active:false,updated_at:new Date().toISOString()})
    .eq('workspace_id',workspace).eq('phone_number_id',phoneId);
   if(error)throw new LifecycleError(503,'Unable to disable the voice route.');
   return json({active:false,message:'Call gate disabled. Existing provider routing must be checked separately.'});
  }
  if(action==='verify_activate'){
   const {data:route,error:routeError}=await ctx.service.from('intrigue_ai_voice_routes')
    .select('assistant_id,provider_mode,phone_number_id').eq('workspace_id',workspace)
    .eq('phone_number_id',phoneId).maybeSingle();
   if(routeError||!route)throw new LifecycleError(404,'Provision a route before activating it.');
   // Read-only provider API checks verify phone/assistant ownership and actual routing.
   let verified;
   try{verified=await verifyVapiRoute(voiceService(),{
    workspace,phoneId,assistantId:route.assistant_id,mode:route.provider_mode,
    gateUrl:`${req.nextUrl.origin}/api/integrations/vapi/call-gate`,
    webhookUrl:`${req.nextUrl.origin}/api/integrations/vapi/webhook`
   });}catch(e){throw new LifecycleError(409,e instanceof Error?e.message:'Vapi configuration could not be verified.');}
   const {error}=await ctx.service.from('intrigue_ai_voice_routes').update({
    active:true,reservation_seconds:verified.maxDurationSeconds,
    verified_at:new Date().toISOString(),updated_at:new Date().toISOString()
   }).eq('workspace_id',workspace).eq('phone_number_id',phoneId);
   if(error)throw new LifecycleError(503,'Unable to activate verified voice route.');
   return json({active:true,reservation_seconds:verified.maxDurationSeconds,
    message:'Inbound gate activated for this phone. Make one fictional test call, then verify reconciliation and fallback.'});
  }
  throw new LifecycleError(400,'Unknown voice setup action.');
 }catch(error){return apiError(error);}
}
