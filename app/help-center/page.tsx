'use client';
import {useCallback,useEffect,useMemo,useState,type FormEvent} from 'react';
import {createClient} from '@/lib/supabase/client';
import {ArrowLeft,BookOpen,Headphones,MessageCircle,RefreshCcw,Send} from 'lucide-react';
import '../platform-ui.css';

type Company={id:string;name:string};
type Message={id:string;speaker:'client'|'operator';body:string;created_at:string};
type Ticket={id:string;workspace_id:string;subject:string;category:string;status:string;updated_at:string;messages:Message[]};
const faq=[
 {q:'How do I invite a colleague?',a:'As a company Owner, open Team in your workspace, choose a role and create a secure invitation link.'},
 {q:'How do quotation approvals work?',a:'Review quotations and proposed actions in Quotations & Proposals. Sending messages and external actions require appropriate permissions.'},
 {q:'Can I export or delete company data?',a:'Company Owners can open Settings → Company data deletion. Export first and review the permanent-erasure confirmation. Historical backups and external providers have separate retention schedules.'},
 {q:'What if our workspace is frozen?',a:'Your company’s business operations may be restricted, but you can still submit and review a Help Center ticket. Contact INTRIGUE Support for reactivation.'},
];
export default function HelpCenter(){
 const db=useMemo(()=>createClient(),[]);
 const [companies,setCompanies]=useState<Company[]>([]),[workspace,setWorkspace]=useState(''),[tickets,setTickets]=useState<Ticket[]>([]);
 const [subject,setSubject]=useState(''),[category,setCategory]=useState('technical'),[message,setMessage]=useState('');
 const [responses,setResponses]=useState<Record<string,string>>({}),[openTicket,setOpenTicket]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const request=useCallback(async(method:'GET'|'POST',url:string,body?:object)=>{
  const {data:{session}}=await db.auth.getSession();if(!session?.access_token)throw Error('Sign in to your company account first.');
  const r=await fetch(url,{method,cache:'no-store',headers:{Authorization:`Bearer ${session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const j=await r.json();if(!r.ok)throw Error(j.error||`Server returned ${r.status}`);return j;
 },[db]);
 const load=useCallback(async(selected:string)=>{
  setLoading(true);setError('');
  try{const url='/api/help-center'+(selected?`?workspace_id=${encodeURIComponent(selected)}`:'');
   const j=await request('GET',url);setCompanies(j.workspaces||[]);setTickets(j.tickets||[]);
   if(!selected&&j.workspaces?.length){setWorkspace(j.workspaces[0].id);}else if(selected){setWorkspace(selected);}
  }catch(e){setError(e instanceof Error?e.message:'Unable to load support');}finally{setLoading(false);}
 },[request]);
 useEffect(()=>{void load(workspace);},[workspace,load]);
 async function create(e:FormEvent){e.preventDefault();if(!workspace||saving)return;
  setSaving(true);setError('');setNotice('');
  try{await request('POST','/api/help-center',{action:'create',workspace_id:workspace,subject,category,message});
   setSubject('');setMessage('');setNotice('Your support ticket was created. INTRIGUE Support can respond here.');await load(workspace);
  }catch(err){setError(err instanceof Error?err.message:'Unable to create ticket');}finally{setSaving(false);}
 }
 async function reply(t:Ticket){const msg=(responses[t.id]||'').trim();if(!msg)return;
  setSaving(true);setError('');
  try{await request('POST','/api/help-center',{action:'reply',ticket_id:t.id,message:msg});
   setResponses(p=>({...p,[t.id]:''}));await load(workspace);setOpenTicket(t.id);
  }catch(err){setError(err instanceof Error?err.message:'Unable to reply');}finally{setSaving(false);}
 }
 return <main className="intrigue-portal min-h-screen bg-[#091725] px-4 py-7 text-[#f4efe4] sm:px-8 lg:px-12">
  <div className="mx-auto max-w-5xl">
   <header className="ip-header"><div><a href="/dashboard" className="ip-muted inline-flex items-center gap-2 text-sm"><ArrowLeft size={16}/> Back to workspace</a>
    <div className="flex items-center gap-3 mt-6"><img src="/intrigue-mark.png" alt="INTRIGUE emblem" className="h-14 w-10 object-contain" /><p className="ip-overline">INTRIGUE STUDIOS / CLIENT SUPPORT</p></div><h1 className="ip-heading">Help Center</h1><p className="ip-muted mt-2">Find answers, request help and follow responses in one place.</p></div>
    <button type="button" className="ip-button ip-secondary" onClick={()=>void load(workspace)}><RefreshCcw size={16}/> Refresh</button>
   </header>
   {error&&<div className="ip-error" role="alert">{error}</div>}
   {notice&&<div className="ip-success" role="status">{notice}</div>}
   <section className="ip-card"><div className="flex items-center gap-2"><BookOpen size={20} className="text-[#d6b778]"/><h2 className="ip-card-title">Quick answers</h2></div>
    <div className="mt-4 space-y-2">{faq.map(f=><details key={f.q} className="ip-faq"><summary>{f.q}</summary><p className="ip-muted pt-3 text-sm leading-7">{f.a}</p></details>)}</div>
   </section>
   <div className="ip-help-grid mt-5">
    <section className="ip-card"><div className="flex items-center gap-2"><Headphones className="text-[#d6b778]" size={20}/><h2 className="ip-card-title">Request support</h2></div>
     <form onSubmit={create} className="mt-5 space-y-3">
      <label className="ip-label" htmlFor="workspace">Company workspace</label>
      <select id="workspace" className="ip-input" value={workspace} onChange={e=>setWorkspace(e.target.value)} disabled={saving}>
       {companies.length===0&&<option value="">No workspaces available</option>}
       {companies.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <label className="ip-label" htmlFor="category">Topic</label>
      <select id="category" className="ip-input" value={category} onChange={e=>setCategory(e.target.value)}>
       {['technical','integration','general','billing','privacy'].map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      <label className="ip-label" htmlFor="subject">Subject</label>
      <input id="subject" className="ip-input" value={subject} onChange={e=>setSubject(e.target.value)} minLength={5} maxLength={160} required placeholder="What's happening?"/>
      <label className="ip-label" htmlFor="message">Details</label>
      <textarea id="message" className="ip-input min-h-[130px]" value={message} onChange={e=>setMessage(e.target.value)} required maxLength={4000} placeholder="Describe the issue. Don't include passwords or API keys."/>
      <button type="submit" className="ip-button ip-primary" disabled={!workspace||saving||subject.trim().length<5||!message.trim()}><Send size={15}/>{saving?'Submitting…':'Submit ticket'}</button>
     </form><p className="ip-muted mt-4 text-xs">Support messages stay inside INTRIGUE. The platform doesn't send notification emails or promise a response time.</p>
    </section>
    <section className="ip-card"><div className="flex items-center gap-2"><MessageCircle className="text-[#d6b778]" size={20}/><h2 className="ip-card-title">Your conversations ({tickets.length})</h2></div>
     {loading&&<p className="ip-muted mt-4">Loading tickets…</p>}
     {!loading&&tickets.length===0&&<p className="ip-muted mt-4">No tickets for this workspace yet.</p>}
     <div className="mt-4 space-y-3">{tickets.map(t=><article key={t.id} className="ip-faq">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={()=>setOpenTicket(openTicket===t.id?'':t.id)} aria-expanded={openTicket===t.id}>
       <strong>{t.subject}</strong><span className="ip-pill">{t.status.replace('_',' ')}</span></button>
      {openTicket===t.id&&<div className="mt-4 space-y-3 border-t border-[#3c4d61] pt-4">
       {(t.messages||[]).map(m=><div key={m.id} className="ip-message"><strong>{m.speaker==='operator'?'INTRIGUE Support':'Your company'}</strong><p className="whitespace-pre-wrap break-words">{m.body}</p></div>)}
       <label className="ip-label" htmlFor={`reply-${t.id}`}>Add message</label>
       <textarea id={`reply-${t.id}`} className="ip-input min-h-[90px]" maxLength={4000} value={responses[t.id]||''} onChange={e=>setResponses(p=>({...p,[t.id]:e.target.value}))}/>
       <button className="ip-button ip-secondary" type="button" disabled={saving||!responses[t.id]?.trim()||t.status==='closed'} onClick={()=>void reply(t)}>Send reply</button>
      </div>}
     </article>)}</div>
    </section>
   </div>
  </div>
 </main>;
}
