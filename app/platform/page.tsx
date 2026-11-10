'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {ArrowLeft,Building2,Headphones,RefreshCcw,ShieldAlert,ShieldCheck,LockKeyhole} from 'lucide-react';
import '../platform-ui.css';

type Company={id:string;name:string;created_at:string;intrigue_erasure_state:string;frozen:boolean;freeze_updated_at:string|null;customers:number;enquiries:number;quotations:number;open_tickets:number};
type Message={id:string;speaker:'client'|'operator';body:string;created_at:string};
type Ticket={id:string;workspace_id:string;workspace_name:string;subject:string;category:string;status:string;created_at:string;updated_at:string;messages:Message[]};
const statuses=['open','in_progress','waiting_client','resolved','closed'];

export default function PlatformConsole(){
 const db=useMemo(()=>createClient(),[]);
 const [companies,setCompanies]=useState<Company[]>([]),[tickets,setTickets]=useState<Ticket[]>([]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reason,setReason]=useState<Record<string,string>>({}),[responses,setResponses]=useState<Record<string,string>>({});
 const [activeTicket,setActiveTicket]=useState(''),[tab,setTab]=useState<'companies'|'support'>('companies');
 const request=useCallback(async (method:'GET'|'POST',body?:object)=>{
  const {data:{session}}=await db.auth.getSession();
  if(!session?.access_token)throw Error('Please sign in using your platform account.');
  const r=await fetch('/api/platform/console',{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const j=await r.json();if(!r.ok)throw Error(j.error||`Server returned ${r.status}`);return j;
 },[db]);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{const j=await request('GET');setCompanies(j.companies||[]);setTickets(j.tickets||[]);}
  catch(e){setError(e instanceof Error?e.message:'Cannot load platform console');}
  finally{setLoading(false);}
 },[request]);
 useEffect(()=>{void load();},[load]);
 async function freeze(c:Company){
  const note=(reason[c.id]||'').trim();
  if(note.length<8){setError('Enter a reason of at least 8 characters before changing a company’s access.');return;}
  const next=!c.frozen;
  if(!window.confirm(`${next?'Freeze':'Reactivate'} ${c.name}? ${next?'Signed-in business access and guarded background writes will be restricted.':'Business access will be restored.'}`))return;
  setSaving(c.id);setError('');setNotice('');
  try{await request('POST',{action:'freeze',workspace_id:c.id,frozen:next,reason:note});setNotice(`${c.name} ${next?'frozen':'reactivated'}.`);await load();}
  catch(e){setError(e instanceof Error?e.message:'Cannot update company access');}
  finally{setSaving('');}
 }
 async function sendReply(t:Ticket){
  const message=(responses[t.id]||'').trim();if(!message)return;
  setSaving(t.id);setError('');
  try{await request('POST',{action:'reply',ticket_id:t.id,message});setResponses(p=>({...p,[t.id]:''}));await load();setActiveTicket(t.id);}
  catch(e){setError(e instanceof Error?e.message:'Unable to reply');}finally{setSaving('');}
 }
 async function setStatus(t:Ticket,status:string){
  setSaving(t.id);setError('');
  try{await request('POST',{action:'status',ticket_id:t.id,status});await load();setActiveTicket(t.id);}
  catch(e){setError(e instanceof Error?e.message:'Unable to change status');}finally{setSaving('');}
 }
 const frozen=companies.filter(c=>c.frozen).length,open=tickets.filter(t=>!['closed','resolved'].includes(t.status)).length;
 return <main className="intrigue-portal min-h-screen bg-[#091725] px-4 py-7 text-[#f4efe4] sm:px-8 lg:px-12">
  <div className="mx-auto max-w-7xl">
   <header className="ip-header">
    <div><a href="/dashboard" className="ip-muted inline-flex items-center gap-2 text-sm"><ArrowLeft size={16}/> Client workspace</a>
     <div className="flex items-center gap-3 mt-6"><img src="/intrigue-mark.png" alt="INTRIGUE emblem" className="h-14 w-10 object-contain" /><p className="ip-overline">INTRIGUE STUDIOS / PRIVATE OPERATIONS</p></div>
     <h1 className="ip-heading">Admin Control Center</h1><p className="ip-muted mt-2">Workspace monitoring, controlled access and client support. Billing is managed separately.</p>
    </div>
    <button type="button" onClick={()=>void load()} disabled={loading} className="ip-button ip-secondary"><RefreshCcw size={16}/> Refresh</button>
   </header>
   {error&&<div role="alert" className="ip-error">{error}</div>}
   {notice&&<div role="status" className="ip-success">{notice}</div>}
   <div className="ip-stats">
    <article className="ip-stat"><Building2/><span>Company workspaces</span><strong>{companies.length}</strong></article>
    <article className="ip-stat"><LockKeyhole/><span>Frozen workspaces</span><strong>{frozen}</strong></article>
    <article className="ip-stat"><Headphones/><span>Open support tickets</span><strong>{open}</strong></article>
   </div>
   <div className="ip-tabs" role="tablist" aria-label="Platform view">
    <button type="button" role="tab" aria-selected={tab==='companies'} onClick={()=>setTab('companies')}>Companies</button>
    <button type="button" role="tab" aria-selected={tab==='support'} onClick={()=>setTab('support')}>Support tickets ({tickets.length})</button>
   </div>
   {loading&&<p className="ip-muted py-7">Loading authorized platform data…</p>}
   {!loading&&tab==='companies'&&<section className="ip-card-grid">
    {companies.map(c=><article key={c.id} className="ip-card">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="ip-overline">COMPANY</div><h2 className="ip-card-title">{c.name}</h2></div>
      <span className={`ip-pill ${c.frozen?'ip-pill-warn':''}`}>{c.frozen?'Frozen':c.intrigue_erasure_state==='closing'?'Closing':'Active'}</span></div>
      <div className="ip-metrics"><span><strong>{c.customers}</strong> customers</span><span><strong>{c.enquiries}</strong> enquiries</span><span><strong>{c.quotations}</strong> quotations</span><span><strong>{c.open_tickets}</strong> open tickets</span></div>
      <label className="ip-label" htmlFor={`reason-${c.id}`}>Reason for {c.frozen?'reactivating':'freezing'} this company</label>
      <textarea id={`reason-${c.id}`} className="ip-input min-h-[70px]" maxLength={500} value={reason[c.id]||''} onChange={e=>setReason(p=>({...p,[c.id]:e.target.value}))} placeholder="Describe the operational reason (logged to the audit trail)"/>
      <button type="button" className={`ip-button mt-3 ${c.frozen?'ip-primary':'ip-danger'}`} disabled={saving!==''||c.intrigue_erasure_state==='closing'} onClick={()=>void freeze(c)}>
       {c.frozen?<ShieldCheck size={16}/>:<ShieldAlert size={16}/>} {saving===c.id?'Saving…':c.frozen?'Reactivate company':'Freeze company'}
      </button>
      <p className="ip-muted mt-3 text-xs">A freeze restricts direct signed-in database access and guarded operational writes. Independently hosted integrations must also be reviewed.</p>
    </article>)}
    {companies.length===0&&<p className="ip-muted">No company workspaces found.</p>}
   </section>}
   {!loading&&tab==='support'&&<section className="space-y-3">
    {tickets.map(t=><article key={t.id} className="ip-card">
     <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={()=>setActiveTicket(activeTicket===t.id?'':t.id)} aria-expanded={activeTicket===t.id}>
      <div><p className="ip-overline">{t.workspace_name} · {t.category}</p><h2 className="ip-card-title">{t.subject}</h2></div><span className="ip-pill">{t.status.replace('_',' ')}</span>
     </button>
     {activeTicket===t.id&&<div className="mt-5 border-t border-[#405069] pt-4">
       <div className="space-y-3">{(t.messages||[]).map(m=><div key={m.id} className="ip-message"><strong>{m.speaker==='operator'?'INTRIGUE Support':'Client'}</strong><p className="whitespace-pre-wrap break-words">{m.body}</p></div>)}</div>
       <label className="ip-label" htmlFor={`status-${t.id}`}>Ticket status</label>
       <select id={`status-${t.id}`} className="ip-input" disabled={saving!==''} value={t.status} onChange={e=>void setStatus(t,e.target.value)}>
        {statuses.map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}
       </select>
       <label className="ip-label" htmlFor={`reply-${t.id}`}>Reply to customer</label>
       <textarea id={`reply-${t.id}`} className="ip-input min-h-[110px]" maxLength={4000} value={responses[t.id]||''} onChange={e=>setResponses(p=>({...p,[t.id]:e.target.value}))}/>
       <button type="button" className="ip-button ip-primary mt-3" disabled={saving!==''||!(responses[t.id]||'').trim()||t.status==='closed'} onClick={()=>void sendReply(t)}>{saving===t.id?'Sending…':'Send in-app reply'}</button>
       <p className="ip-muted mt-2 text-xs">Replies are available inside the Help Center. No email is sent automatically.</p>
     </div>}
    </article>)}
    {tickets.length===0&&<p className="ip-muted">No support tickets yet.</p>}
   </section>}
   <footer className="ip-muted mt-10 border-t border-[#405069] py-6 text-xs">Private operator access is verified server-side using your Supabase login. Company Owners do not automatically receive platform access.</footer>
  </div>
 </main>;
}
