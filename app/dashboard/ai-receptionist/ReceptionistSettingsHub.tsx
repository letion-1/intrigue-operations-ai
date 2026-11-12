'use client';
import {useCallback,useEffect,useState} from 'react';
import VapiReceptionist from '../vapi-receptionist';
import {createClient} from '@/lib/supabase/client';

type Provider='google'|'calendly'|'cal'|'none';
type Mode='disabled'|'link'|'direct';
type PhoneRequest={id:string;request_kind:string;provider_mode:string;phone_number_id:string|null;assistant_id:string|null;status:string;created_at:string;operator_note?:string|null};
type PhoneRoute={phone_number_id:string;assistant_id:string;provider_mode:string;active:boolean;verified_at:string|null;reservation_seconds:number};
type Setup={settings:{calendar_provider:Provider;booking_mode:Mode};connections:{google:boolean;cal:boolean;calendly:boolean};routes:PhoneRoute[];requests:PhoneRequest[]};
const box='rounded-xl border border-[#41556b] bg-[#0d1e30] p-4';
const field='w-full rounded-lg border border-[#657085] bg-[#102438] px-3 py-2 text-sm text-[#fff5df]';
const btn='rounded-lg border border-[#bf9e5e] px-3 py-2 text-sm text-[#f3d18b] disabled:opacity-50';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ReceptionistSettingsHub({workspaceId}:{workspaceId:string}){
 const [setup,setSetup]=useState<Setup|null>(null);
 const [provider,setProvider]=useState<Provider>('google');
 const [mode,setMode]=useState<Mode>('disabled');
 const [requestKind,setRequestKind]=useState<'new_number'|'existing_number'|'client_owned_vapi'>('new_number');
 const [payer,setPayer]=useState<'managed'|'byok'>('managed');
 const [phoneId,setPhoneId]=useState(''),[assistantId,setAssistantId]=useState(''),[hint,setHint]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const auth=useCallback(async()=>{
  const db=createClient();const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw Error('Sign in to manage this workspace.');
  return session.access_token;
 },[]);
 const api=useCallback(async(method:'GET'|'PATCH'|'POST',payload?:object)=>{
  const token=await auth();
  const url='/api/receptionist/setup'+(method==='GET'?'?workspace_id='+encodeURIComponent(workspaceId):'');
  const r=await fetch(url,{method,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify({...payload,workspace_id:workspaceId}):undefined});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Receptionist setup unavailable');return j;
 },[auth,workspaceId]);
 const refresh=useCallback(async()=>{
  setError('');try{
   const j:Setup=await api('GET');setSetup(j);setProvider(j.settings.calendar_provider);setMode(j.settings.booking_mode);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load setup');}
 },[api]);
 useEffect(()=>{void refresh();},[refresh]);
 const save=async()=>{setBusy(true);setError('');setNotice('');try{await api('PATCH',{calendar_provider:provider,booking_mode:mode});setNotice('Calendar preference saved for this workspace. Provider and Vapi tool compatibility must be verified before live booking.');await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not save');}finally{setBusy(false);}};
 const request=async()=>{setBusy(true);setError('');setNotice('');try{
  if(requestKind!=='new_number'&&(!uuid.test(phoneId.trim())||!uuid.test(assistantId.trim())))throw Error('Enter valid phone number and assistant UUIDs.');
  await api('POST',{request_kind:requestKind,provider_mode:requestKind==='client_owned_vapi'?'byok':payer,
   phone_number_id:requestKind==='new_number'?null:phoneId.trim(),assistant_id:requestKind==='new_number'?null:assistantId.trim(),phone_hint:hint.trim()});
  setNotice('Phone request submitted. Operator review, provider verification and call-gate activation are required. No number was purchased or rerouted.');
  setPhoneId('');setAssistantId('');setHint('');await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Could not submit request');}finally{setBusy(false);}};
 const choices:[Provider,string][]=[['google','Google Calendar'],['calendly','Calendly'],['cal','Cal.com'],['none','None']];
 return <div className="space-y-5" aria-label="Workspace receptionist and provider management">
  <div className={box}><h2 className="text-lg font-semibold text-[#f3d18b]">Receptionist setup for this company</h2>
   <p className="mt-1 text-sm text-[#b8c7d4]">Each workspace has its own calendar authorization, assistant credential and phone routes. No client can activate another company's number.</p></div>
  {error&&<p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-300">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-emerald-500 p-3 text-sm text-emerald-300">{notice}</p>}
  <section className={box}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-[#f4e4c0]">Calendar connections</h2><button className={btn} onClick={()=>void refresh()}>Refresh connections</button></div>
   <p className="mt-2 text-sm text-[#b8c7d4]">Connect and configure provider accounts in the existing Calendar page. We keep one canonical page for OAuth permissions, booking hours and live-booking settings.</p>
   <div className="mt-3 grid gap-2 sm:grid-cols-3">{(['google','calendly','cal'] as const).map(p=><div className="rounded-lg border border-[#53657b] p-3" key={p}><strong>{choices.find(v=>v[0]===p)?.[1]}</strong><p className={'mt-1 text-xs '+(setup?.connections[p]?'text-emerald-300':'text-[#aab9c9]')}>{setup?.connections[p]?'Connected':'Not connected'}</p></div>)}</div>
   <a href="/dashboard?section=calendar" className={`${btn} mt-3 inline-block`}>Open Calendar connections and booking rules</a>
   <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm">Preferred provider<select className={`${field} mt-1`} value={provider} onChange={e=>{setProvider(e.target.value as Provider);setMode('disabled');}}>{choices.map(([p,name])=><option key={p} value={p}>{name}</option>)}</select></label>
    <label className="text-sm">Booking mode<select className={`${field} mt-1`} value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="disabled">Disabled until verified</option><option value="link">Booking link / request only</option><option value="direct" disabled={provider==='cal'||provider==='none'}>Direct booking (Google / Calendly)</option></select></label></div>
   <p className="mt-2 text-xs text-[#bdcbd7]">Selection is workspace-scoped. Google uses google_check_availability/google_book_appointment; Calendly uses check_availability/book_appointment. Cal.com voice direct booking is not yet approved, so use its booking link. Booking still requires valid Vapi webhook credentials.</p>
   <button className={`${btn} mt-3`} disabled={busy} onClick={()=>void save()}>Save calendar preference</button>
  </section>
  <section className={box}><h2 className="font-semibold text-[#f4e4c0]">Company phone numbers</h2><p className="mt-2 text-sm text-[#b8c7d4]">Request a new dedicated number, attach an existing Vapi number or connect a company-owned Vapi account. Provider charges, number purchasing and routing need verified operator approval.</p>
   {setup?.routes.length?<div className="mt-3 space-y-2">{setup.routes.map(r=><div key={r.phone_number_id} className="rounded-lg border border-[#53657b] p-3 text-xs"><strong className="break-all">{r.phone_number_id}</strong><p>Assistant: {r.assistant_id}</p><p>{r.provider_mode} · {r.active?'Verified and active':'Not active'} · {Math.ceil(r.reservation_seconds/60)} min max reservation</p></div>)}</div>:<p className="mt-2 text-sm text-[#b8c7d4]">No verified phone routes found for this workspace.</p>}
   <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm">Request type<select className={`${field} mt-1`} value={requestKind} onChange={e=>{const k=e.target.value as typeof requestKind;setRequestKind(k);if(k==='client_owned_vapi')setPayer('byok');}}><option value="new_number">Request new number</option><option value="existing_number">Connect existing Vapi number</option><option value="client_owned_vapi">Connect client-owned Vapi account/number</option></select></label>
    <label className="text-sm">Who pays Vapi?<select className={`${field} mt-1`} value={requestKind==='client_owned_vapi'?'byok':payer} disabled={requestKind==='client_owned_vapi'} onChange={e=>setPayer(e.target.value as 'managed'|'byok')}><option value="managed">INTRIGUE managed</option><option value="byok">Client-owned Vapi</option></select></label></div>
   {requestKind!=='new_number'&&<div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Vapi phone-number UUID<input className={`${field} mt-1`} value={phoneId} onChange={e=>setPhoneId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label><label className="text-sm">Vapi assistant UUID<input className={`${field} mt-1`} value={assistantId} onChange={e=>setAssistantId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"/></label></div>}
   <label className="mt-3 block text-sm">Business number / region hint (optional)<input className={`${field} mt-1`} maxLength={40} value={hint} onChange={e=>setHint(e.target.value)} placeholder="Germany +49 / current business line"/></label>
   <button className={`${btn} mt-3`} disabled={busy} onClick={()=>void request()}>Submit phone request</button>
   <div className="mt-4 space-y-2">{setup?.requests.map(r=><div key={r.id} className="rounded-lg border border-[#42566b] p-3 text-xs"><span className="font-semibold">{r.request_kind.replaceAll('_',' ')} · {r.status}</span><span className="ml-2 opacity-70">{new Date(r.created_at).toLocaleString()}</span>{r.operator_note&&<p className="mt-1">Operator note: {r.operator_note}</p>}</div>)}</div>
  </section>
  <section className={box}><h2 className="font-semibold text-[#f4e4c0]">Client-owned provider billing</h2><p className="mt-2 text-sm text-[#b8c7d4]">Company owners connect and verify their Vapi/OpenRouter keys in the existing Integrations screen. A saved key alone does not activate client-owned billing; the platform operator must verify the phone and assistant account.</p><a className={`${btn} mt-3 inline-block`} href="/dashboard?section=integrations">Open Integrations</a></section>
  <VapiReceptionist workspaceId={workspaceId}/>
 </div>;
}
