'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {ShieldCheck,PlugZap,RefreshCcw,KeyRound} from 'lucide-react';

type Provider='openrouter'|'vapi';
type Plan={text_mode:'managed'|'byok';voice_mode:'managed'|'byok';text_budget_usd:number;voice_seconds_limit:number};
type Status={plan:Plan;usage:{text_usd:number;voice_seconds:number;pending_jobs:number;text_requests:number;voice_calls:number;byok_usd:number};connections:{provider:Provider;connected:boolean}[];runtime:{text_byok_active:boolean;voice_byok_active:boolean};period_start:string};
const usd=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const percentage=(part:number,full:number)=>full>0?Math.min(100,Math.round(part/full*100)):0;
const card='rounded-2xl border border-[#9b8351]/45 bg-[#142539] p-5 text-[#f4efe5]';
export default function AiConnectionsPanel({workspaceId}:{workspaceId:string}){
 const db=useMemo(()=>createClient(),[]);
 const [state,setState]=useState<Status|null>(null),[pending,setPending]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [keys,setKeys]=useState<Record<Provider,string>>({openrouter:'',vapi:''});
 const ask=useCallback(async(method:'GET'|'POST',payload?:object)=>{
  const {data,error:sessionError}=await db.auth.getSession();
  if(sessionError||!data.session?.access_token)throw Error('Please sign in again.');
  const url='/api/ai-control'+(method==='GET'?'?workspace_id='+encodeURIComponent(workspaceId):'');
  const r=await fetch(url,{method,cache:'no-store',headers:{Authorization:'Bearer '+data.session.access_token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify({workspace_id:workspaceId,...payload}):undefined});
  const body=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(body.error||'AI connection request failed.');
  return body;
 },[db,workspaceId]);
 const load=useCallback(async()=>{setPending(true);try{setState(await ask('GET'));setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to load AI settings.');}finally{setPending(false);}},[ask]);
 useEffect(()=>{void load();},[load]);
 async function connect(provider:Provider){
  if(!keys[provider].trim())return setError('Enter a provider API key.');
  setPending(true);setError('');setNotice('');
  try{
   const value=keys[provider].trim();
   const out=await ask('POST',{action:'connect',provider,api_key:value});
   setKeys(s=>({...s,[provider]:''}));
   setNotice(out.message||'Key verified and saved securely.');await load();
  }catch(e){setError(e instanceof Error?e.message:'Unable to connect provider.');}
  finally{setPending(false);}
 }
 async function disconnect(provider:Provider){
  if(!window.confirm(`Disconnect your ${provider==='vapi'?'Vapi':'OpenRouter'} account? INTRIGUE will revert its mode to managed.`))return;
  setPending(true);setError('');setNotice('');
  try{await ask('POST',{action:'disconnect',provider,confirmation:`DISCONNECT ${provider.toUpperCase()}`});setKeys(s=>({...s,[provider]:''}));setNotice('Provider disconnected.');await load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to disconnect provider.');}finally{setPending(false);}
 }
 async function choose(kind:'text'|'voice',value:'managed'|'byok'){
  if(!state)return;
  setPending(true);setError('');setNotice('');
  try{await ask('POST',{action:'mode',text_mode:kind==='text'?value:state.plan.text_mode,voice_mode:kind==='voice'?value:state.plan.voice_mode});setNotice('Company AI mode updated.');await load();}
  catch(e){setError(e instanceof Error?e.message:'Unable to update AI mode.');}finally{setPending(false);}
 }
 const connected=(provider:Provider)=>state?.connections.some(c=>c.provider===provider);
 return <section aria-label="AI providers and monthly allowances" className="space-y-4">
  <header className="flex flex-wrap items-start justify-between gap-3">
   <div><h2 className="text-xl font-semibold">AI providers & usage</h2><p className="mt-1 text-sm opacity-80">Use INTRIGUE-managed AI or connect approved accounts owned by your company.</p></div>
   <button type="button" disabled={pending} onClick={()=>void load()} className="rounded-lg border border-[#9b8351]/60 px-3 py-2 text-sm"><RefreshCcw size={15} className="mr-2 inline"/>Refresh</button>
  </header>
  {error&&<p role="alert" className="rounded-lg border border-red-400/50 px-3 py-2 text-sm text-red-300">{error}</p>}
  {notice&&<p role="status" className="rounded-lg border border-emerald-400/40 px-3 py-2 text-sm text-emerald-300">{notice}</p>}
  {!state&&<p className="text-sm opacity-70">{pending?'Loading allowances…':'Usage details unavailable.'}</p>}
  {state&&<>
   <div className="grid gap-3 md:grid-cols-2">
    <article className={card}><p className="text-xs uppercase tracking-wide text-[#ceb478]">AI assistant</p>
     <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-xl">{usd(state.usage.text_usd)}</strong><span className="text-xs opacity-75">of {usd(Number(state.plan.text_budget_usd))} included</span></div>
     <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#324255]"><div className="h-full rounded-full bg-[#d3b36d]" style={{width:percentage(state.usage.text_usd,Number(state.plan.text_budget_usd))+'%'}}/></div>
     <p className="mt-2 text-xs opacity-75">{state.usage.text_requests} requests this month · {state.usage.pending_jobs} pending cost reconciliations</p>
    </article>
    <article className={card}><p className="text-xs uppercase tracking-wide text-[#ceb478]">AI receptionist</p>
     <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-xl">{Math.ceil(state.usage.voice_seconds/60)} min</strong><span className="text-xs opacity-75">of {Math.floor(state.plan.voice_seconds_limit/60)} min included</span></div>
     <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#324255]"><div className="h-full rounded-full bg-[#d3b36d]" style={{width:percentage(state.usage.voice_seconds,state.plan.voice_seconds_limit)+'%'}}/></div>
     <p className="mt-2 text-xs opacity-75">Usage is only complete after authenticated Vapi call records are connected to this ledger.</p>
    </article>
   </div>
   <div className="grid gap-3 lg:grid-cols-2">
    {([['openrouter','Text AI','text'],['vapi','AI Receptionist','voice']] as const).map(([provider,label,kind])=>{
     const active=kind==='text'?state.plan.text_mode:state.plan.voice_mode;
     const enabled=kind==='text'?state.runtime.text_byok_active:state.runtime.voice_byok_active;
     return <article key={provider} className={card}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold"><PlugZap size={16} className="mr-2 inline"/>{label}</h3><span className="text-xs opacity-80">{connected(provider)?'Key verified & stored':'No company key'}</span></div>
      <p className="mt-2 text-xs opacity-75">{provider==='openrouter'?'OpenRouter API key for your company’s AI models.':'Vapi private key for company-owned receptionist services.'}</p>
      <label className="mt-4 block text-sm" htmlFor={'intrigue-ai-'+provider}>Provider API key</label>
      <input id={'intrigue-ai-'+provider} type="password" autoComplete="off" spellCheck={false} placeholder="Paste API key to verify and store" value={keys[provider]} onChange={e=>setKeys(s=>({...s,[provider]:e.target.value}))}
       className="mt-2 w-full rounded-xl border border-[#526278] bg-[#0b1c2c] px-3 py-2.5 text-sm text-white"/>
      <div className="mt-3 flex flex-wrap gap-2">
       <button type="button" disabled={pending||!keys[provider].trim()} onClick={()=>void connect(provider)} className="rounded-xl bg-[#d0ad64] px-3 py-2 text-sm font-semibold text-[#0f2031]"><KeyRound size={14} className="mr-2 inline"/>{connected(provider)?'Replace key':'Verify & save key'}</button>
       {connected(provider)&&<button type="button" disabled={pending} onClick={()=>void disconnect(provider)} className="rounded-xl border border-[#9b8351]/60 px-3 py-2 text-sm">Disconnect</button>}
      </div>
      <div className="mt-5 rounded-xl border border-[#45556b] p-3">
       <p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck size={17}/>Billing mode: {active==='managed'?'INTRIGUE Managed':'Company-owned provider'}</p>
       <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending||active==='managed'} onClick={()=>void choose(kind,'managed')} className="rounded-lg border border-[#9b8351] px-3 py-1.5 text-xs">Use Managed AI</button>
        <button type="button" disabled={pending||!enabled||!connected(provider)||active==='byok'} onClick={()=>void choose(kind,'byok')} className="rounded-lg border border-[#9b8351] px-3 py-1.5 text-xs">Use my account</button>
       </div>
       {!enabled&&<p className="mt-3 text-xs text-[#ddc18a]">Company-owned billing is not active until INTRIGUE verifies the full runtime connection. Saving a key alone does not switch billing.</p>}
      </div>
     </article>;
    })}
   </div>
   <p className="rounded-xl border border-[#9b8351]/40 p-3 text-xs opacity-75">The usage figures cover only operations reported to the new governance ledger, not the existing worker or phone system until they are integrated. OpenAI, Claude and Retell adapters are planned but not enabled. API keys never appear here after saving. Model and receptionist integrations require end-to-end testing before activation.</p>
  </>}
 </section>;
}
