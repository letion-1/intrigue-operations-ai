'use client';

import {useCallback,useEffect,useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {RefreshCcw} from 'lucide-react';

type UsageStatus={
 plan:{text_budget_usd:number;voice_seconds_limit:number;text_mode:'managed'|'byok';voice_mode:'managed'|'byok'};
 usage:{text_usd:number;voice_seconds:number;pending_jobs:number;text_requests:number;voice_calls:number;byok_usd:number};
 period_start:string;
};
const usd=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
const pct=(used:number,limit:number)=>limit>0?Math.max(0,Math.min(100,(used/limit)*100)):0;
const panel='rounded-2xl border border-[#997b45]/50 bg-[#142539] p-5 text-[#f4efe5]';

/** Read-only snapshot of the SAME owner-scoped /api/ai-control ledger as Integrations previously used. */
export default function AiUsagePanel({workspaceId}:{workspaceId:string}){
 const db=useMemo(()=>createClient(),[]);
 const [status,setStatus]=useState<UsageStatus|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[updated,setUpdated]=useState('');
 const load=useCallback(async()=>{
  setBusy(true);
  try{
   const {data,error:sessionError}=await db.auth.getSession();
   if(sessionError||!data.session?.access_token)throw Error('Please sign in again.');
   const res=await fetch('/api/ai-control?workspace_id='+encodeURIComponent(workspaceId),{
    method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token},
   });
   const body:unknown=await res.json().catch(()=>null);
   if(!res.ok){
    const message=body&&typeof body==='object'&&'error' in body?String(body.error):'Unable to retrieve usage.';
    throw Error(message);
   }
   if(!body||typeof body!=='object'||!('usage' in body)||!('plan' in body))throw Error('Unexpected usage response.');
   setStatus(body as UsageStatus);setUpdated(new Date().toLocaleTimeString());setError('');
  }catch(e){setStatus(null);setError(e instanceof Error?e.message:'Usage request failed.');}
  finally{setBusy(false);}
 },[db,workspaceId]);
 useEffect(()=>{
  void load();
  const onFocus=()=>{if(document.visibilityState==='visible')void load();};
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60_000);
  window.addEventListener('focus',onFocus);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus);};
 },[load]);
 const u=status?.usage, p=status?.plan;
 return <section aria-label="Monthly AI and receptionist usage" className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-lg font-semibold">AI spending &amp; receptionist minutes</h2>
    <p className="mt-1 text-xs opacity-75">Workspace-scoped provider ledger. Separate from daily chat and indexing limits below.</p></div>
   <button type="button" disabled={busy} onClick={()=>void load()} className="rounded-lg border border-[#9b8351]/60 px-3 py-2 text-xs disabled:opacity-50"><RefreshCcw size={14} className="mr-2 inline"/>{busy?'Refreshing…':'Refresh provider usage'}</button>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-400/50 px-3 py-2 text-sm text-red-300">{error}</p>}
  {!status&&!error&&<p className="text-sm opacity-75">Loading provider usage…</p>}
  {u&&p&&<div className="grid gap-3 md:grid-cols-2">
   <article className={panel}>
    <p className="text-xs uppercase tracking-wider text-[#dfbf7c]">AI Assistant · {p.text_mode==='managed'?'INTRIGUE Managed':'Company-owned'}</p>
    <div className="mt-2 flex items-end justify-between gap-2"><strong className="text-2xl">{usd(u.text_usd)}</strong><span className="text-xs opacity-75">of {usd(p.text_budget_usd)} included</span></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#34485c]"><div className="h-full bg-[#d3b36d]" style={{width:pct(u.text_usd,p.text_budget_usd)+'%'}}/></div>
    <p className="mt-2 text-xs opacity-75">{u.text_requests} recorded requests · {u.pending_jobs} pending cost reconciliations</p>
   </article>
   <article className={panel}>
    <p className="text-xs uppercase tracking-wider text-[#dfbf7c]">AI Receptionist · {p.voice_mode==='managed'?'INTRIGUE Managed':'Company-owned'}</p>
    <div className="mt-2 flex items-end justify-between gap-2"><strong className="text-2xl">{Math.ceil(u.voice_seconds/60)} min</strong><span className="text-xs opacity-75">of {Math.floor(p.voice_seconds_limit/60)} min included</span></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#34485c]"><div className="h-full bg-[#d3b36d]" style={{width:pct(u.voice_seconds,p.voice_seconds_limit)+'%'}}/></div>
    <p className="mt-2 text-xs opacity-75">{u.voice_calls} recorded calls · usage may update after Vapi settlement</p>
   </article>
  </div>}
  {status&&<p className="text-xs opacity-70">Source: the existing protected AI governance ledger · Period starts {status.period_start} · Last refreshed {updated}. Auto-refreshes about every 60 seconds while visible and when the window regains focus. Figures exclude provider activity not yet reported to the ledger. No billing or quota changes are made here.</p>}
 </section>;
}
