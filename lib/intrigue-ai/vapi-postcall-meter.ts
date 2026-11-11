/** Optional best-effort Vapi post-call usage recorder. No pre-call enforcement. */
import {createClient} from '@supabase/supabase-js';

type ObjectValue=Record<string,unknown>;
const obj=(v:unknown):ObjectValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as ObjectValue:{};
const validUuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
export type VoiceMeterInput={authorization:unknown;call:unknown;message:unknown};
export function parseTrustedVoiceUsage(value:VoiceMeterInput){
 const trusted=obj(value.authorization);
 if(trusted.authorized!==true)return null;
 // Only use the workspace from the validated database RPC, never the webhook payload.
 const workspace=typeof trusted.workspace_id==='string'?trusted.workspace_id:
   typeof trusted.tenant_id==='string'?trusted.tenant_id:'';
 const call=obj(value.call),message=obj(value.message);
 const id=typeof call.id==='string'?call.id:'';
 if(!validUuid(workspace)||!validUuid(id))return null;
 const cost=typeof message.cost==='number'?message.cost:
   typeof call.cost==='number'?call.cost:NaN;
 if(!Number.isFinite(cost)||cost<0||cost>100000)return null;
 const start=typeof message.startedAt==='string'?message.startedAt:
   typeof call.startedAt==='string'?call.startedAt:'';
 const end=typeof message.endedAt==='string'?message.endedAt:
   typeof call.endedAt==='string'?call.endedAt:'';
 const msStart=Date.parse(start),msEnd=Date.parse(end);
 const reportedDuration=typeof call.durationSeconds==='number'?call.durationSeconds:
   typeof message.durationSeconds==='number'?message.durationSeconds:NaN;
 const seconds=Number.isFinite(msStart)&&Number.isFinite(msEnd)&&msEnd>msStart
   ?Math.ceil((msEnd-msStart)/1000)
   :Number.isFinite(reportedDuration)&&reportedDuration>0?Math.ceil(reportedDuration):NaN;
 if(seconds<1||seconds>7200)return null;
 return {workspaceId:workspace,callId:id,costUsd:cost,seconds};
}
export async function recordVapiCall(input:VoiceMeterInput){
 if(process.env.INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED!=='true')return;
 const record=parseTrustedVoiceUsage(input);
 if(!record){console.warn('[VAPI_USAGE_NOT_RECONCILED] Trusted workspace, cost or duration unavailable.');return;}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key){console.warn('[VAPI_USAGE_NOT_RECONCILED] Service database connection unavailable.');return;}
 try{
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  // A call authorized by the pre-call gate already has a reserved vapi:<id> row.
  // Settle that reservation instead of creating a second or permanent pending row.
  const requestKey='vapi:'+record.callId;
  const {data:existing,error:lookupError}=await db.from('intrigue_ai_usage_ledger')
   .select('status,provider').eq('workspace_id',record.workspaceId).eq('request_key',requestKey).maybeSingle();
  if(lookupError){console.warn('[VAPI_USAGE_NOT_RECONCILED] Could not look up reserved call.');return;}
  if(existing?.status==='settled')return;
  if(existing?.status==='reserved'&&existing.provider==='vapi'){
   const {error}=await db.rpc('intrigue_ai_settle',{
    p_workspace:record.workspaceId,p_request_key:requestKey,
    p_actual_usd:record.costUsd,p_actual_seconds:record.seconds,
    p_input_tokens:null,p_output_tokens:null,p_provider_ref:record.callId
   });
   if(error)console.warn('[VAPI_USAGE_NOT_RECONCILED] Reserved call settlement failed.');
  }else if(!existing){
   // Legacy call without pre-admission: recorded for audit, not counted as gate-protected.
   const {error}=await db.rpc('intrigue_ai_record_voice',{
    p_workspace:record.workspaceId,p_call_id:record.callId,
    p_cost_usd:record.costUsd,p_seconds:record.seconds});
   if(error)console.warn('[VAPI_USAGE_NOT_RECONCILED] Legacy call record rejected.');
  }
 }catch{console.warn('[VAPI_USAGE_NOT_RECONCILED] Database unavailable.');}
}
