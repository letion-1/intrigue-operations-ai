import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { platformAuth, checkOrigin, uuid, json, apiError, LifecycleError } from '@/lib/intrigue-platform';
import { requireCompanyOwner, loadPlan } from '@/lib/intrigue-ai/server';
import { voiceAccountKey } from '@/lib/intrigue-ai/voice-gate';
import { allowedDestination, redactNumber, uuidPattern } from '@/lib/intrigue-outbound-evidence';
import { reconcileOutboundAttempt, type Attempt } from '@/lib/intrigue-outbound-server';

type Obj = Record<string,unknown>;
const obj=(v:unknown):Obj => v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const str=(v:unknown):string => typeof v==='string'?v.trim():'';
const purposes=['requested_callback','appointment_reminder','service_update'] as const;
const enabledFor=(workspace:string)=>process.env.INTRIGUE_VAPI_OUTBOUND_ENABLED==='true' && (process.env.INTRIGUE_VAPI_OUTBOUND_PILOT_WORKSPACES||'').split(',').map(x=>x.trim()).includes(workspace);
const prefixes=()=> (process.env.INTRIGUE_OUTBOUND_ALLOWED_PREFIXES||'+49').split(',').map(x=>x.trim()).filter(x=>/^\+[1-9][0-9]{0,3}$/.test(x));

export async function GET(req:NextRequest){
 try{
  const ctx=await platformAuth(req);
  const workspace=await requireCompanyOwner(ctx,req.nextUrl.searchParams.get('workspace_id'));
  const [routes,attempts]=await Promise.all([
   ctx.service.from('intrigue_ai_voice_routes').select('phone_number_id,assistant_id,provider_mode,reservation_seconds,active,verified_at').eq('workspace_id',workspace).eq('active',true),
   ctx.service.from('intrigue_receptionist_outbound_attempts').select('id,created_at,purpose,status,recipient_e164,provider_call_id').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(15),
  ]);
  if(routes.error||attempts.error)throw new LifecycleError(503,'Outbound database migration is not available.');
  return json({enabled:enabledFor(workspace),allowed_prefixes:prefixes(),routes:routes.data||[],
   attempts:(attempts.data||[]).map(a=>({...a,recipient_e164:redactNumber(a.recipient_e164)}))});
 }catch(e){return apiError(e);}
}
export async function POST(req:NextRequest){
 try{
  checkOrigin(req);
  const ctx=await platformAuth(req);
  const body=obj(await req.json().catch(()=>null));
  const workspace=await requireCompanyOwner(ctx,body.workspace_id);
  if(body.action==='reconcile'){
   if(!uuid(body.attempt_id))throw new LifecycleError(400,'Select an outbound call.');
   const {data,error}=await ctx.service.from('intrigue_receptionist_outbound_attempts')
    .select('id,workspace_id,phone_number_id,assistant_id,provider_mode,recipient_e164,reservation_seconds,provider_call_id,status')
    .eq('workspace_id',workspace).eq('id',body.attempt_id).maybeSingle();
   if(error||!data)throw new LifecycleError(404,'Call not found for this workspace.');
   return json(await reconcileOutboundAttempt(ctx.service,data as Attempt));
  }
  if(body.action!=='start')throw new LifecycleError(400,'Unknown outbound operation.');
  if(!enabledFor(workspace))throw new LifecycleError(409,'Outbound calling is not enabled for this pilot workspace.');
  const dest=str(body.destination),phoneId=str(body.phone_number_id),purpose=str(body.purpose),evidence=str(body.consent_reference);
  if(!uuidPattern.test(phoneId)||!allowedDestination(dest,prefixes()))throw new LifecycleError(400,'Select an approved phone route and an allowed E.164 destination.');
  if(!purposes.includes(purpose as typeof purposes[number]))throw new LifecycleError(400,'Only individual callbacks, reminders and service updates are allowed.');
  if(body.consent_attested!==true||evidence.length<8||evidence.length>250||/\r|\n/.test(evidence))
   throw new LifecycleError(400,'Document recipient authorization and confirm this specific call.');
  if(body.confirmation!==`CALL ${dest}`)throw new LifecycleError(400,'Explicit CALL confirmation did not match the destination.');
  const {data:route,error:routeError}=await ctx.service.from('intrigue_ai_voice_routes')
   .select('workspace_id,phone_number_id,assistant_id,provider_mode,reservation_seconds,active,verified_at')
   .eq('workspace_id',workspace).eq('phone_number_id',phoneId).eq('active',true).maybeSingle();
  if(routeError||!route||!route.verified_at)throw new LifecycleError(409,'Phone number has not been verified and activated for this company.');
  const plan=await loadPlan(ctx.service,workspace);
  if(plan.voice_mode!==route.provider_mode||plan.voice_provider!=='vapi')throw new LifecycleError(409,'Company Vapi billing mode does not match the verified route.');
  const [credential,latest]=await Promise.all([
   voiceAccountKey(ctx.service,workspace,route.provider_mode as 'managed'|'byok'),
   ctx.service.from('intrigue_receptionist_outbound_attempts').select('created_at').eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(1),
  ]);
  if(latest.error)throw new LifecycleError(503,'Unable to check call rate limits.');
  if(latest.data?.[0]&&Date.now()-Date.parse(latest.data[0].created_at)<60_000)throw new LifecycleError(429,'Wait at least one minute between outbound attempts.');
  // Read-only check: Vapi account must own both resources and carrier must be imported Twilio.
  let phone:Obj,assistant:Obj;
  try{
   const reqs=await Promise.all(['phone-number/'+phoneId,'assistant/'+route.assistant_id].map(x=>
    fetch(`https://api.vapi.ai/${x}`,{headers:{Authorization:`Bearer ${credential}`},cache:'no-store',signal:AbortSignal.timeout(7000)})));
   if(reqs.some(r=>!r.ok))throw Error('Provider ownership check failed.');
   [phone,assistant]=await Promise.all(reqs.map(async r=>obj(await r.json())));
  }catch{throw new LifecycleError(409,'Vapi ownership or outbound-capability verification failed. No call was placed.');}
  if(phone.id!==phoneId||assistant.id!==route.assistant_id||str(phone.provider).toLowerCase()!=='twilio')
   throw new LifecycleError(409,'Pilot outbound calls require the exact approved assistant and a Twilio-imported Vapi number.');
  const duration=typeof assistant.maxDurationSeconds==='number'?assistant.maxDurationSeconds:600;
  if(!Number.isInteger(duration)||duration>route.reservation_seconds||duration<60)
   throw new LifecycleError(409,'Set the published assistant max duration within the reserved voice allowance.');
  const attemptId=randomUUID();
  const attempt={id:attemptId,workspace_id:workspace,initiated_by:ctx.user.id,phone_number_id:phoneId,
   assistant_id:route.assistant_id,provider_mode:route.provider_mode,recipient_e164:dest,purpose,
   consent_reference:evidence,consent_attested_at:new Date().toISOString(),reservation_seconds:route.reservation_seconds,status:'starting'};
  const {error:createError}=await ctx.service.from('intrigue_receptionist_outbound_attempts').insert(attempt);
  if(createError)throw new LifecycleError(409,'Another outbound attempt is active or the audit record is unavailable. Do not retry until reviewed.');
  const requestKey=`outbound:${attemptId}`;
  const {data:reservation,error:reserveError}=await ctx.service.rpc('intrigue_ai_reserve',{
   p_workspace:workspace,p_request_key:requestKey,p_kind:'voice',p_estimated_usd:0,p_seconds:route.reservation_seconds,
  });
  if(reserveError||obj(reservation).approved!==true){
   await ctx.service.from('intrigue_receptionist_outbound_attempts').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
   throw new LifecycleError(409,'Voice allowance reservation was denied. No call was placed.');
  }
  // Exactly ONE provider create attempt. Any uncertain response preserves the reservation.
  let response:Response;
  try{
   response=await fetch('https://api.vapi.ai/call',{
    method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},
    body:JSON.stringify({assistantId:route.assistant_id,phoneNumberId:phoneId,customer:{number:dest}}),
    signal:AbortSignal.timeout(12000),cache:'no-store',
   });
  }catch{
   await ctx.service.from('intrigue_receptionist_outbound_attempts').update({status:'review_required',updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
   throw new LifecycleError(503,`Provider response uncertain. Do not retry. Review attempt ${attemptId}.`);
  }
  if(!response.ok){
   const definitive=[400,401,403,404,422].includes(response.status);
   if(definitive){
    const {data:cancelled,error:cancelError}=await ctx.service.rpc('intrigue_ai_cancel',{p_workspace:workspace,p_request_key:requestKey});
    if(!cancelError&&cancelled===true){
     await ctx.service.from('intrigue_receptionist_outbound_attempts').update({status:'failed',updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
     throw new LifecycleError(409,'Vapi rejected this outbound call. No new call was started.');
    }
   }
   await ctx.service.from('intrigue_receptionist_outbound_attempts').update({status:'review_required',updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
   throw new LifecycleError(503,`Vapi outcome uncertain. Do not retry. Review attempt ${attemptId}.`);
  }
  const result=obj(await response.json().catch(()=>null));
  if(!uuidPattern.test(str(result.id))){
   await ctx.service.from('intrigue_receptionist_outbound_attempts').update({status:'review_required',updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
   throw new LifecycleError(503,`Vapi response lacked a trusted call ID. Do not retry. Review attempt ${attemptId}.`);
  }
  const {error:saveError}=await ctx.service.from('intrigue_receptionist_outbound_attempts')
   .update({status:'placed',provider_call_id:result.id,updated_at:new Date().toISOString()}).eq('id',attemptId).eq('workspace_id',workspace);
  if(saveError)throw new LifecycleError(503,`Provider accepted the call but storage failed. Do not retry. Review attempt ${attemptId}.`);
  return json({status:'placed',attempt_id:attemptId,message:'Vapi accepted one outbound call. Reconcile after the call ends.'});
 }catch(e){return apiError(e);}
}
