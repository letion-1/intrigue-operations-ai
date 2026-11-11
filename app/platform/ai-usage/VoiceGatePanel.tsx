'use client';
import {useCallback,useMemo,useState} from 'react';
import {createPlatformClient} from '@/lib/intrigue-platform-auth-client';

type Route={phone_number_id:string;assistant_id:string;provider_mode:'managed'|'byok';reservation_seconds:number;active:boolean;verified_at:string|null};
type Payload={routes:Route[];pending?:{pending_voice:number;pending_seconds:number;oldest_pending?:string;unreconciled_over_36h:number}};
const input='w-full rounded-xl border border-[#66798c] bg-[#091827] px-3 py-2.5 text-[#f5f0e8]';
const btn='rounded-xl border border-[#af9865] px-3 py-2 text-sm disabled:opacity-45';
export default function VoiceGatePanel({workspaceId}:{workspaceId:string}){
 const db=useMemo(()=>createPlatformClient(),[]);
 const [phoneId,setPhoneId]=useState(''),[assistantId,setAssistantId]=useState(''),[mode,setMode]=useState<'managed'|'byok'>('managed');
 const [result,setResult]=useState<Payload|null>(null),[oneTimeToken,setOneTimeToken]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useCallback(async(action:string,fields:object={})=>{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw Error('Private administrator session required.');
  const res=await fetch('/api/platform/ai-voice'+(action==='list'?'?workspace_id='+encodeURIComponent(workspaceId):''),{
   method:action==='list'?'GET':'POST',cache:'no-store',
   headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
   body:action==='list'?undefined:JSON.stringify({action,workspace_id:workspaceId,phone_number_id:phoneId,assistant_id:assistantId,provider_mode:mode,...fields})
  });
  const j=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(j.error||'Voice configuration request failed.');
  return j;
 },[db,workspaceId,phoneId,assistantId,mode]);
 async function execute(action:'list'|'provision'|'verify_activate'|'disable',id?:string){
  setBusy(true);setError('');setNotice('');
  if(action!=='list')setOneTimeToken('');
  try{
   const j=await request(action,id?{phone_number_id:id}:{});
   if(action==='list')setResult(j as Payload);
   else{
    if(j.one_time_token)setOneTimeToken(j.one_time_token);
    setNotice(j.message||'Voice setup updated.');
    const latest=await request('list');setResult(latest as Payload);
   }
  }catch(e){setError(e instanceof Error?e.message:'Request failed.');}
  finally{setBusy(false);}
 }
 return <section className="mt-6 rounded-2xl border border-[#52657b] bg-[#152639] p-5 text-[#f2ecdf]" aria-label="Inbound receptionist call gate">
  <h2 className="text-xl font-semibold">Inbound receptionist protections</h2>
  <p className="mt-2 text-sm text-[#c2d0de]">One phone number at a time. The call gate remains off until the Vapi number, assistant and authentication are verified. Existing bookings and call history stay on the existing assistant webhook.</p>
  {error&&<p role="alert" className="mt-3 rounded-lg border border-red-400/60 p-3 text-sm text-red-200">{error}</p>}
  {notice&&<p role="status" className="mt-3 rounded-lg border border-emerald-400/60 p-3 text-sm text-emerald-200">{notice}</p>}
  <div className="mt-4 grid gap-3 sm:grid-cols-2">
   <label className="text-sm">Vapi phone-number ID <input className={'mt-2 '+input} value={phoneId} onChange={e=>setPhoneId(e.target.value.trim())} placeholder="UUID of inbound phone number"/></label>
   <label className="text-sm">Existing assistant ID <input className={'mt-2 '+input} value={assistantId} onChange={e=>setAssistantId(e.target.value.trim())} placeholder="UUID of assistant with booking tools"/></label>
   <label className="text-sm">Who pays Vapi?
    <select className={'mt-2 '+input} value={mode} onChange={e=>setMode(e.target.value as 'managed'|'byok')}><option value="managed">INTRIGUE Managed</option><option value="byok">Client-owned Vapi</option></select>
   </label>
  </div>
  <div className="mt-4 flex flex-wrap gap-2">
   <button type="button" className={btn} disabled={busy||!phoneId||!assistantId} onClick={()=>void execute('provision')}>1. Generate webhook credential</button>
   <button type="button" className={btn} disabled={busy||!phoneId} onClick={()=>void execute('verify_activate')}>2. Verify Vapi and activate</button>
   <button type="button" className={btn} disabled={busy} onClick={()=>void execute('list')}>Refresh voice status</button>
  </div>
  {oneTimeToken&&<div className="mt-4 rounded-xl border border-amber-400/60 p-3">
   <p className="text-sm font-semibold">One-time phone webhook token. Copy into Vapi Custom Credentials, then clear this page. Never share it in chat.</p>
   <code className="mt-2 block break-all text-xs">{oneTimeToken}</code>
   <button type="button" className={'mt-2 '+btn} onClick={()=>void navigator.clipboard.writeText(oneTimeToken)}>Copy token</button>
   <p className="mt-2 text-xs opacity-80">Phone Server URL: /api/integrations/vapi/call-gate. Remove the phone's fixed assistant. Leave the saved assistant's Server URL on /api/integrations/vapi/webhook.</p>
  </div>}
  <div className="mt-4 space-y-2">
   {result?.routes.map(r=><div key={r.phone_number_id} className="rounded-xl border border-[#506277] p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all">{r.phone_number_id}</span><strong>{r.active?'Verified / active':'Not active'}</strong></div>
    <p className="mt-1 text-xs opacity-75">{r.provider_mode} · {r.reservation_seconds/60} minutes reserved per inbound call · Assistant {r.assistant_id}</p>
    <button type="button" className={'mt-2 '+btn} disabled={busy||!r.active} onClick={()=>void execute('disable',r.phone_number_id)}>Disable this route</button>
   </div>)}
   {result?.pending&&<p className="rounded-lg border border-[#506277] p-3 text-sm">Pending voice reconciliation: {result.pending.pending_voice} calls, {Math.ceil((result.pending.pending_seconds||0)/60)} reserved minutes. Over 36 hours: {result.pending.unreconciled_over_36h}. Investigate these before raising allowances.</p>}
  </div>
  <p className="mt-3 text-xs text-[#ccd6de]">Activation verifies Vapi provider ownership and dynamic assistant routing. It does not change the number's external configuration automatically. Calls placed outside this gate remain outside this limit.</p>
 </section>;
}
