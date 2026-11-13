'use client';
import {useCallback,useEffect,useState} from 'react';
import {createClient} from '@/lib/supabase/client';

type Route={phone_number_id:string;assistant_id:string;provider_mode:string;reservation_seconds:number;verified_at:string|null};
type Attempt={id:string;created_at:string;purpose:string;status:string;recipient_e164:string;provider_call_id:string|null};
type State={enabled:boolean;allowed_prefixes:string[];routes:Route[];attempts:Attempt[]};
const cls='w-full rounded-lg border border-[#53657b] bg-[#112a40] p-3 text-sm text-[#f4e8cf]';
const button='rounded-lg border border-[#c7a35e] px-3 py-2 text-sm text-[#f2d08c] disabled:cursor-not-allowed disabled:opacity-40';
export default function OutboundDialPanel({workspaceId}:{workspaceId:string}){
 const [state,setState]=useState<State|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [route,setRoute]=useState(''),[number,setNumber]=useState(''),[purpose,setPurpose]=useState('requested_callback');
 const [reference,setReference]=useState(''),[attested,setAttested]=useState(false),[confirmation,setConfirmation]=useState('');
 const api=useCallback(async(method:'GET'|'POST',body?:Record<string,unknown>)=>{
  const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)throw Error('Sign in required.');
  const response=await fetch('/api/receptionist/outbound'+(method==='GET'?`?workspace_id=${encodeURIComponent(workspaceId)}`:''),{
   method,credentials:'same-origin',cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify({...body,workspace_id:workspaceId}):undefined,
  });const json=await response.json().catch(()=>({}));if(!response.ok)throw Error(json.error||'Outbound request failed.');return json;
 },[workspaceId]);
 const refresh=useCallback(async()=>{try{const value=await api('GET') as State;setState(value);setRoute(x=>x||value.routes[0]?.phone_number_id||'');setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to load outbound status.');}},[api]);
 useEffect(()=>{void refresh();},[refresh]);
 async function start(){
  setBusy(true);setError('');setNotice('');
  try{
   const value=await api('POST',{action:'start',phone_number_id:route,destination:number,purpose,consent_reference:reference,consent_attested:attested,confirmation});
   setNotice(value.message||'Call accepted.');setConfirmation('');setAttested(false);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Call could not be placed.');await refresh();}
  finally{setBusy(false);}
 }
 async function reconcile(id:string){setBusy(true);setError('');setNotice('');try{
  const value=await api('POST',{action:'reconcile',attempt_id:id});setNotice(value.message||value.status);await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Reconciliation unavailable.');}finally{setBusy(false);}}
 return <div className="max-w-3xl space-y-4" aria-label="Owner-controlled outbound calling">
  <div className="rounded-xl border border-[#455c74] bg-[#122b41] p-4">
   <h2 className="font-semibold text-[#e8c77e]">Owner-controlled outbound calls</h2>
   <p className="mt-2 text-sm text-[#bccbd7]">One approved callback, appointment reminder or service update at a time. Never use for cold outreach or bulk calls. A carrier may still refuse a destination.</p>
   <p className="mt-2 text-xs">{state?.enabled?'Pilot enabled by operator':'Pilot locked until operator enables INTRIGUE_VAPI_OUTBOUND_ENABLED after verification'} · Allowed prefixes: {state?.allowed_prefixes.join(', ')||'+49'}</p>
  </div>
  {error&&<p className="rounded-lg border border-red-500 p-3 text-sm text-red-200" role="alert">{error}</p>}
  {notice&&<p className="rounded-lg border border-[#c5a25b] p-3 text-sm" role="status">{notice}</p>}
  <label className="block text-sm">Verified company number<select className={`${cls} mt-1`} value={route} onChange={e=>setRoute(e.target.value)}>
    {state?.routes.length?state.routes.map(x=><option key={x.phone_number_id} value={x.phone_number_id}>{x.phone_number_id} · {x.provider_mode} · {x.reservation_seconds/60} min</option>):<option value="">No approved routes</option>}
   </select></label>
  <label className="block text-sm">Recipient phone (international E.164)<input className={`${cls} mt-1`} type="tel" autoComplete="off" placeholder="+49..." value={number} onChange={e=>{setNumber(e.target.value);setConfirmation('');}}/></label>
  <div className="grid max-w-xs grid-cols-3 gap-2" aria-label="Dial pad">{'123456789*0#'.split('').map(n=><button type="button" key={n} className={button} onClick={()=>{if(/[0-9]/.test(n))setNumber(s=>s+n);setConfirmation('');}}>{n}</button>)}</div>
  <button className={button} type="button" onClick={()=>{setNumber(n=>n.slice(0,-1));setConfirmation('');}}>Delete</button>
  <label className="block text-sm">Reason for this call<select className={`${cls} mt-1`} value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="requested_callback">Customer-requested callback</option><option value="appointment_reminder">Appointment reminder</option><option value="service_update">Existing customer service update</option></select></label>
  <label className="block text-sm">Consent / request record reference<input className={`${cls} mt-1`} placeholder="CRM contact + dated callback request reference" maxLength={250} value={reference} onChange={e=>setReference(e.target.value)}/></label>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={attested} onChange={e=>setAttested(e.target.checked)} className="mt-1"/><span>I confirm this individual call is permitted, requested or otherwise legally authorized, and the recipient has not opted out. It is not an unsolicited marketing call.</span></label>
  <label className="block text-sm">Final confirmation: type <strong>CALL {number||'+49...'}</strong><input className={`${cls} mt-1`} value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label>
  <button type="button" className="rounded-lg bg-[#c7a35e] px-5 py-3 font-semibold text-[#152136] disabled:opacity-40" disabled={busy||!state?.enabled||!route||!attested||reference.trim().length<8||confirmation!==`CALL ${number}`} onClick={()=>void start()}>{busy?'Processing...':'Place one call with Ava'}</button>
  <section className="space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Recent outbound attempts</h2><button type="button" className={button} disabled={busy} onClick={()=>void refresh()}>Refresh</button></div>
   {state?.attempts.length?state.attempts.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#455c74] p-3 text-sm"><div><strong>{a.recipient_e164}</strong><p className="text-xs opacity-75">{a.purpose.replaceAll('_',' ')} · {a.status} · {new Date(a.created_at).toLocaleString()}</p></div><button type="button" disabled={busy||!a.provider_call_id||!['placed','review_required'].includes(a.status)} className={button} onClick={()=>void reconcile(a.id)}>Verify & settle</button></div>):<p className="text-sm opacity-75">No outbound attempts yet.</p>}
   <p className="text-xs opacity-70">If a provider request times out, do not redial. Operator review is required. Call costs are verified against Vapi before final ledger settlement.</p>
  </section>
 </div>;
}
