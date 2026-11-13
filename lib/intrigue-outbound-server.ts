import 'server-only';
import { voiceAccountKey, voiceService } from '@/lib/intrigue-ai/voice-gate';
import { validateOutboundEvidence } from '@/lib/intrigue-outbound-evidence';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Attempt = {id:string;workspace_id:string;phone_number_id:string;assistant_id:string;provider_mode:'managed'|'byok';recipient_e164:string;reservation_seconds:number;provider_call_id:string|null;status:string};
export async function reconcileOutboundAttempt(db:SupabaseClient,attempt:Attempt):Promise<{status:string;message:string}>{
  if(attempt.status==='settled')return {status:'settled',message:'Already reconciled.'};
  if(!attempt.provider_call_id)return {status:'review_required',message:'Provider call ID missing. Operator review required; do not retry.'};
  if(!['placed','review_required'].includes(attempt.status))return {status:attempt.status,message:'Call cannot be reconciled from this state.'};
  const apiKey=await voiceAccountKey(db,attempt.workspace_id,attempt.provider_mode);
  let response:Response;
  try {response=await fetch(`https://api.vapi.ai/call/${encodeURIComponent(attempt.provider_call_id)}`,{
    headers:{Authorization:`Bearer ${apiKey}`},cache:'no-store',signal:AbortSignal.timeout(9000),
  });}catch{return {status:'review_required',message:'Vapi call lookup failed. Retry reconciliation later; never place a second call.'};}
  if(!response.ok)return {status:'review_required',message:'Vapi verification unavailable. Do not retry the outbound call.'};
  const call:unknown=await response.json().catch(()=>null);
  const obj=call&&typeof call==='object'&&!Array.isArray(call)?call as Record<string,unknown>:{};
  if(obj.status==='queued'||obj.status==='ringing'||obj.status==='in-progress')return {status:'placed',message:'Call has not finished yet.'};
  try{
    const proof=validateOutboundEvidence(call,{callId:attempt.provider_call_id,phoneId:attempt.phone_number_id,
      assistantId:attempt.assistant_id,destination:attempt.recipient_e164,reservedSeconds:attempt.reservation_seconds});
    if(proof.exceededReservation)throw Error('Call exceeded its reservation. Operator review needed.');
    const {error:settleError}=await db.rpc('intrigue_ai_settle',{
      p_workspace:attempt.workspace_id,p_request_key:`outbound:${attempt.id}`,
      p_actual_usd:proof.costUsd,p_actual_seconds:proof.actualSeconds,
      p_input_tokens:null,p_output_tokens:null,p_provider_ref:attempt.provider_call_id,
    });
    if(settleError){
      const {data:ledger}=await db.from('intrigue_ai_usage_ledger').select('status').eq('workspace_id',attempt.workspace_id).eq('request_key',`outbound:${attempt.id}`).maybeSingle();
      if(ledger?.status!=='settled')throw Error('Ledger settlement failed.');
    }
    const {error:updateError}=await db.from('intrigue_receptionist_outbound_attempts')
      .update({status:'settled',updated_at:new Date().toISOString()}).eq('id',attempt.id).eq('workspace_id',attempt.workspace_id);
    if(updateError)return {status:'review_required',message:'Ledger settled but call state needs operator reconciliation.'};
    return {status:'settled',message:'Provider-verified duration and cost settled.'};
  }catch{
    await db.from('intrigue_receptionist_outbound_attempts').update({status:'review_required',updated_at:new Date().toISOString()})
      .eq('id',attempt.id).eq('workspace_id',attempt.workspace_id);
    return {status:'review_required',message:'Call evidence incomplete or inconsistent; operator review required. Reservation preserved.'};
  }
}

/** This is invoked only after the existing Vapi webhook has authenticated its workspace and assistant. */
export async function reconcileOutboundWebhook(args:{authorization:unknown;callId:string;assistantId:string}):Promise<{found:boolean}>{
  const a=args.authorization&&typeof args.authorization==='object'&&!Array.isArray(args.authorization)?args.authorization as Record<string,unknown>:{};
  const workspace=typeof a.workspace_id==='string'?a.workspace_id:typeof a.tenant_id==='string'?a.tenant_id:'';
  if(a.authorized!==true||!workspace||!args.callId)return {found:false};
  try{
    const db=voiceService();
    const {data,error}=await db.from('intrigue_receptionist_outbound_attempts').select('id,workspace_id,phone_number_id,assistant_id,provider_mode,recipient_e164,reservation_seconds,provider_call_id,status')
      .eq('workspace_id',workspace).eq('provider_call_id',args.callId).eq('assistant_id',args.assistantId).maybeSingle();
    if(error)return {found:true}; // fail closed: never write a second legacy charge
    if(!data)return {found:false};
    await reconcileOutboundAttempt(db,data as Attempt);
    return {found:true};
  }catch{return {found:true};}
}
