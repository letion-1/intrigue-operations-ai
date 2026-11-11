import 'server-only';
import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {getCredential,loadPlan} from '@/lib/intrigue-ai/server';

export const voiceUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const tokenDigest=(secret:string)=>createHash('sha256').update(secret,'utf8').digest('hex');
export function voiceService(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 if(!url||!key)throw Error('Voice service database not configured.');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export type VoiceMode='managed'|'byok';
export async function voiceAccountKey(db:ReturnType<typeof voiceService>,workspace:string,mode:VoiceMode){
 if(mode==='byok')return getCredential(db,workspace,'vapi');
 const key=process.env.INTRIGUE_VAPI_MANAGED_API_KEY||process.env.VAPI_API_KEY||'';
 if(!key)throw Error('Managed Vapi API credential not configured.');
 return key;
}
async function fromVapi(key:string,kind:'phone-number'|'assistant',id:string):Promise<Record<string,unknown>>{
 const response=await fetch(`https://api.vapi.ai/${kind}/${encodeURIComponent(id)}`,{
  headers:{Authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(3500)});
 if(!response.ok)throw Error(`Vapi ${kind} verification failed. Confirm the connected account owns the resource.`);
 const payload:unknown=await response.json().catch(()=>null);
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Vapi verification response invalid.');
 return payload as Record<string,unknown>;
}
const asObject=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const safeUrl=(v:unknown)=>typeof v==='string'?v.replace(/\/$/,''):'';
export async function verifyVapiRoute(db:ReturnType<typeof voiceService>,args:{workspace:string;phoneId:string;assistantId:string;mode:VoiceMode;gateUrl:string;webhookUrl:string}){
 const plan=await loadPlan(db,args.workspace);
 if(plan.voice_provider!=='vapi')throw Error('Only Vapi voice routing is approved for this release.');
 const key=await voiceAccountKey(db,args.workspace,args.mode);
 const [phone,assistant]=await Promise.all([
  fromVapi(key,'phone-number',args.phoneId),fromVapi(key,'assistant',args.assistantId)
 ]);
 if(String(phone.id||'')!==args.phoneId||String(assistant.id||'')!==args.assistantId)
  throw Error('Phone number and assistant did not match the configured resource IDs.');
 // A fixed assistant ID bypasses Vapi assistant-request entirely.
 if(phone.assistantId||phone.squadId||phone.workflowId||phone.assistant||phone.squad)
  throw Error('Phone number has a fixed assistant, squad or workflow. Remove it before enabling the call gate.');
 const pserver=asObject(phone.server),aserver=asObject(assistant.server);
 if(safeUrl(pserver.url||phone.serverUrl)!==safeUrl(args.gateUrl))
  throw Error('Phone number must point to the INTRIGUE call-gate URL.');
 if(typeof pserver.credentialId!=='string'||pserver.credentialId.length<6)
  throw Error('Phone number must use a saved Vapi bearer authorization credential.');
 if(safeUrl(aserver.url||assistant.serverUrl)!==safeUrl(args.webhookUrl))
  throw Error('Assistant must continue using the existing INTRIGUE Vapi tool/call-history webhook.');
 if(typeof aserver.credentialId!=='string'||aserver.credentialId.length<6)
  throw Error('Assistant webhook requires its existing saved authorization credential.');
 const duration=assistant.maxDurationSeconds===undefined?600:Number(assistant.maxDurationSeconds);
 if(!Number.isInteger(duration)||duration<60||duration>1800)
  throw Error('Set the assistant maximum call duration to 1–30 minutes and publish it before activation.');
 return {maxDurationSeconds:duration};
}
