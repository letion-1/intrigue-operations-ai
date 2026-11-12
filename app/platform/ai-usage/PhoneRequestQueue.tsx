'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createPlatformClient} from '@/lib/intrigue-platform-auth-client';

type RequestRow={id:string;workspace_id:string;request_kind:string;provider_mode:string;phone_number_id:string|null;assistant_id:string|null;phone_hint:string|null;status:string;created_at:string;operator_note:string|null};
const btn='rounded-lg border border-[#b59c61] px-3 py-2 text-xs text-[#eac885] disabled:opacity-50';
const input='w-full rounded-lg border border-[#52687e] bg-[#0c1c2e] p-2 text-sm';
export default function PhoneRequestQueue(){
 const client=useMemo(()=>createPlatformClient(),[]);
 const [rows,setRows]=useState<RequestRow[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[note,setNote]=useState('');
 const [assign,setAssign]=useState<Record<string,{phone:string;assistant:string}>>({});
 const action=useCallback(async(method:'GET'|'POST',body?:object)=>{
  const {data:{session}}=await client.auth.getSession();
  if(!session?.access_token)throw Error('Private administrator login required');
  const res=await fetch('/api/platform/receptionist-requests',{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Operator request failed');return data;
 },[client]);
 const load=useCallback(async()=>{try{const j=await action('GET');setRows(j.requests||[]);setError('');}catch(e){setError(e instanceof Error?e.message:'Cannot load phone requests');}},[action]);
 useEffect(()=>{void load();},[load]);
 async function submit(r:RequestRow,type:'approve'|'reject'|'assign'){
  if(type==='approve'&&!window.confirm('Approve only if this exact workspace number + assistant route is verified and ACTIVE. Continue?'))return;
  if(type==='reject'&&!window.confirm('Reject this client phone request?'))return;
  setBusy(r.id);setError('');try{
   await action('POST',{request_id:r.id,action:type,operator_note:note,
    ...(type==='assign'?{phone_number_id:assign[r.id]?.phone,assistant_id:assign[r.id]?.assistant}:{})});
   await load();setNote('');
  }catch(e){setError(e instanceof Error?e.message:'Request was not updated');}finally{setBusy('');}
 }
 return <section className="rounded-2xl border border-[#45546a] bg-[#152639] p-5 text-[#f4efe5]" aria-label="Phone requests across company workspaces">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Client number requests</h2><p className="mt-1 text-xs text-[#b6c7d5]">One operator queue for new, imported and client-owned numbers. Never activate or purchase numbers automatically.</p></div><button className={btn} onClick={()=>void load()}>Refresh</button></div>
  {error&&<p role="alert" className="mt-3 text-red-300">{error}</p>}
  <label className="mt-3 block text-xs">Operator note (optional)<input className={`${input} mt-1`} maxLength={300} value={note} onChange={e=>setNote(e.target.value)} /></label>
  <div className="mt-3 space-y-3">{rows.filter(r=>r.status==='pending').length===0?<p className="text-sm text-[#aabbcd]">No pending requests.</p>:rows.filter(r=>r.status==='pending').map(r=><div key={r.id} className="rounded-lg border border-[#53657b] p-3 text-xs">
   <strong>{r.request_kind.replaceAll('_',' ')} / {r.provider_mode}</strong><p>Workspace: {r.workspace_id}</p><p>Phone: {r.phone_number_id||'Not provisioned'} · Assistant: {r.assistant_id||'Not provisioned'}</p>{r.phone_hint&&<p>Requested: {r.phone_hint}</p>}
   {!r.phone_number_id&&<div className="mt-2 grid gap-2 sm:grid-cols-2"><label>Assigned phone UUID<input className={`${input} mt-1`} value={assign[r.id]?.phone||''} onChange={e=>setAssign(v=>({...v,[r.id]:{phone:e.target.value,assistant:v[r.id]?.assistant||''}}))}/></label><label>Assigned assistant UUID<input className={`${input} mt-1`} value={assign[r.id]?.assistant||''} onChange={e=>setAssign(v=>({...v,[r.id]:{phone:v[r.id]?.phone||'',assistant:e.target.value}}))}/></label></div>}
   <div className="mt-3 flex flex-wrap gap-2"><a className={btn} href={'/platform/ai-usage?workspace_id='+encodeURIComponent(r.workspace_id)}>Verify in AI Usage</a>
    {!r.phone_number_id&&<button className={btn} disabled={!!busy} onClick={()=>void submit(r,'assign')}>Assign acquired number</button>}
    <button className={btn} disabled={!!busy} onClick={()=>void submit(r,'approve')}>Approve verified route</button>
    <button className={btn} disabled={!!busy} onClick={()=>void submit(r,'reject')}>Reject</button>
   </div>
  </div>)}</div>
 </section>;
}
