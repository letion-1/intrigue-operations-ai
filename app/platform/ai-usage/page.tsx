'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createPlatformClient} from '@/lib/intrigue-platform-auth-client';
import {ShieldCheck,RefreshCcw} from 'lucide-react';
import VoiceGatePanel from './VoiceGatePanel';
const formatUsage=(cost:number)=>cost>0&&cost<0.01?'Less than $0.01':`$${cost.toFixed(2)}`;
type Workspace={id:string;name:string};
type Detail={workspace:Workspace;plan:{text_budget_usd:number;voice_seconds_limit:number;text_mode:string;voice_mode:string};usage:{text_usd:number;voice_seconds:number;text_requests:number;voice_calls:number;pending_jobs:number;byok_usd:number};connections:{provider:string}[]};
export default function PlatformAiUsage(){
 const db=useMemo(()=>createPlatformClient(),[]);
 const [companies,setCompanies]=useState<Workspace[]>([]),[current,setCurrent]=useState(''),[detail,setDetail]=useState<Detail|null>(null);
 const [budget,setBudget]=useState(''),[minutes,setMinutes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const ask=useCallback(async(method:'GET'|'POST',query='',payload?:object)=>{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw Error('Private administrator sign-in required.');
  const res=await fetch('/api/platform/ai-control'+query,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
  const body=await res.json().catch(()=>({}));if(!res.ok)throw Error(body.error||'Usage administration failed.');return body;
 },[db]);
 const loadCompanies=useCallback(async()=>{
  setBusy(true);setError('');try{const j=await ask('GET');setCompanies(j.workspaces||[]);setCurrent(v=>v||(j.workspaces?.[0]?.id||''));}
  catch(e){setError(e instanceof Error?e.message:'Unable to load companies.');}finally{setBusy(false);}
 },[ask]);
 const loadDetail=useCallback(async()=>{
  if(!current)return;setBusy(true);setError('');try{
   const j:Detail=await ask('GET','?workspace_id='+encodeURIComponent(current));setDetail(j);setBudget(String(j.plan.text_budget_usd));setMinutes(String(Math.floor(j.plan.voice_seconds_limit/60)));
  }catch(e){setDetail(null);setError(e instanceof Error?e.message:'Unable to load allowances.');}finally{setBusy(false);}
 },[ask,current]);
 useEffect(()=>{
  const workspaceId=new URLSearchParams(window.location.search).get('workspace_id');
  if(workspaceId&&/^[0-9a-f-]{36}$/i.test(workspaceId))setCurrent(workspaceId);
 },[]);
 useEffect(()=>{void loadCompanies();},[loadCompanies]);
 useEffect(()=>{void loadDetail();},[loadDetail]);
 async function save(){
  if(!current)return;const b=Number(budget),m=Number(minutes);
  if(!Number.isFinite(b)||b<0||b>100000||Math.abs(b*100-Math.round(b*100))>1e-7||!Number.isInteger(m)||m<0||m>600000){setError('Enter a nonnegative dollar allowance with at most two decimals, and whole call minutes.');return;}
  setBusy(true);setError('');setNotice('');try{
   await ask('POST','',{workspace_id:current,action:'set_allowance',text_budget_usd:b,voice_minutes:m});setNotice('Company allowances updated.');await loadDetail();
  }catch(e){setError(e instanceof Error?e.message:'Unable to update allowances.');}finally{setBusy(false);}
 }
 return <main className="min-h-screen bg-[#091725] px-4 py-8 text-[#f4efe5] sm:px-8"><div className="mx-auto max-w-5xl space-y-6">
  <header className="flex flex-wrap justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-[#cba95f]">Private administration</p><h1 className="mt-2 text-3xl font-semibold">AI Usage Management</h1><p className="mt-2 text-sm text-[#bac6d4]">Workspace allowances and provider billing modes. Client keys are never visible to operators.</p></div><a href="/platform" className="h-fit rounded-xl border border-[#816f4a] px-4 py-2 text-sm">Back to Control Center</a></header>
  {error&&<p role="alert" className="rounded-xl border border-red-500/60 p-3 text-red-300">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-emerald-500/60 p-3 text-emerald-300">{notice}</p>}
  <section className="rounded-2xl border border-[#45546a] bg-[#152639] p-5">
   <label htmlFor="company" className="block text-sm font-medium">Company workspace</label>
   <div className="mt-2 flex flex-wrap gap-3"><select id="company" value={current} onChange={e=>setCurrent(e.target.value)} className="min-w-60 flex-1 rounded-xl border border-[#607084] bg-[#0c1c2e] px-3 py-2.5">
    {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select><button type="button" disabled={busy} onClick={()=>void loadDetail()} className="rounded-xl border border-[#816f4a] px-4 py-2"><RefreshCcw size={16} className="mr-2 inline"/>Refresh</button></div>
   {detail&&<div className="mt-6 space-y-5">
    <div className="grid gap-3 sm:grid-cols-3">
     <div className="rounded-xl border border-[#485c72] p-4"><p className="text-xs text-[#bbcad7]">Managed AI used this month</p><strong className="mt-2 block text-xl">{formatUsage(detail.usage.text_usd)}</strong><p className="text-xs opacity-70">{detail.usage.text_requests} requests</p></div>
     <div className="rounded-xl border border-[#485c72] p-4"><p className="text-xs text-[#bbcad7]">Voice usage recorded</p><strong className="mt-2 block text-xl">{Math.ceil(detail.usage.voice_seconds/60)} min</strong><p className="text-xs opacity-70">{detail.usage.voice_calls} call records</p></div>
     <div className="rounded-xl border border-[#485c72] p-4"><p className="text-xs text-[#bbcad7]">Pending reconciliation</p><strong className="mt-2 block text-xl">{detail.usage.pending_jobs}</strong><p className="text-xs opacity-70">Investigate unknown provider costs</p></div>
    </div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Monthly managed AI allowance (USD)
      <input type="number" min="0" max="100000" step="0.01" value={budget} onChange={e=>setBudget(e.target.value)} className="mt-2 w-full rounded-xl border border-[#607084] bg-[#0c1c2e] px-3 py-2.5"/></label>
     <label className="block text-sm">Monthly managed receptionist minutes
      <input type="number" min="0" max="600000" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)} className="mt-2 w-full rounded-xl border border-[#607084] bg-[#0c1c2e] px-3 py-2.5"/></label></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[#c9d4de]"><ShieldCheck size={16} className="mr-2 inline"/>Text: {detail.plan.text_mode} · Voice: {detail.plan.voice_mode} · Keys stored for {detail.connections.map(c=>c.provider).join(', ')||'none'}</p><button type="button" disabled={busy} onClick={()=>void save()} className="rounded-xl bg-[#d0ad64] px-4 py-2.5 font-semibold text-[#102132]">{busy?'Saving…':'Save allowances'}</button></div>
   </div>}
   {busy&&!detail&&<p className="mt-5 text-sm">Loading verified company usage…</p>}
  </section>
  {current&&<VoiceGatePanel key={current} workspaceId={current}/>}
  <p className="text-xs text-[#b5c0d0]">Billing amounts are in USD because providers report USD costs. Existing automations and inbound calls are not metered until their verified execution paths use this ledger. Never enable client-owned billing solely because a key was saved.</p>
 </div></main>;
}
