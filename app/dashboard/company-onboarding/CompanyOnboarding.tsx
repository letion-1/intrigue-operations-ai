'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Database, FileArchive, FileUp, PenLine, RotateCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import './company-onboarding.css';

type Kind='files'|'write';
type Counts=Record<string,{added:number;skipped:number}>;
type Success={source:string;extracted_counts:Record<string,number>;summary:{company?:string;counts:Counts;already_imported?:boolean;message?:string}};
type Order={id:string;external_id:string;kind:'order'|'work_order';description:string;status:string;amount:number;currency:string};
const categories:[string,string][]=[
  ['customers','Customers & CRM'],['workspace_services','Service Catalog'],['knowledge_entries','Knowledge Base'],
  ['enquiries','Enquiries'],['quotations','Quotations'],['follow_ups','Follow-ups'],
  ['orders','Orders'],['work_orders','Work orders'],
];
export default function CompanyOnboarding({workspaceId,workspaceName,onImported}:{workspaceId:string;workspaceName:string;onImported:()=>void}){
  const supabase=useMemo(()=>createClient(),[]);
  const [mode,setMode]=useState<Kind>('files');
  const [files,setFiles]=useState<File[]>([]);
  const [notes,setNotes]=useState('');
  const [working,setWorking]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState<Success|null>(null);
  const [orders,setOrders]=useState<Order[]>([]);
  const [ordersError,setOrdersError]=useState('');
  const loadOrders=useCallback(async()=>{
    const {data,error:loadError}=await supabase.from('intrigue_imported_orders')
      .select('id,external_id,kind,description,status,amount,currency')
      .eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(100);
    if(loadError){setOrdersError(loadError.message);return;}
    setOrders((data||[]) as Order[]);setOrdersError('');
  },[supabase,workspaceId]);
  useEffect(()=>{void loadOrders();},[loadOrders]);
  function chooseFiles(event:ChangeEvent<HTMLInputElement>){setFiles(Array.from(event.currentTarget.files||[]));setDone(null);setError('');}
  function selectMode(next:Kind){if(working)return;setMode(next);setError('');setDone(null);}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(working)return;
    setError('');setDone(null);
    if(mode==='files'&&!files.length){setError('Choose a company ZIP, JSON, CSV, TXT or Markdown file.');return;}
    if(mode==='write'&&notes.trim().length<20){setError('Enter at least 20 characters of company information.');return;}
    setWorking(true);
    try{
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||!session?.access_token)throw new Error('Sign in again before importing.');
      const form=new FormData();form.set('workspace_id',workspaceId);
      if(mode==='files')for(const f of files)form.append('files',f);
      else form.set('notes',notes.trim());
      const response=await fetch('/api/company-onboarding',{
        method:'POST',headers:{Authorization:`Bearer ${session.access_token}`},body:form,cache:'no-store',
      });
      let result:Success&{error?:string};
      try{result=await response.json();}catch{throw new Error('Server returned no readable import result.');}
      if(!response.ok)throw new Error(result.error||'Import failed. No records were saved.');
      setDone(result);
      await loadOrders();
      onImported();
    }catch(e){setError(e instanceof Error?e.message:'Upload could not be completed.');}
    finally{setWorking(false);}
  }
  return <div className="intrigue-onboard" aria-label="Automatic company onboarding">
    <div className="io-card">
      <div className="io-heading"><Database size={22}/><div>
        <h2>Company Knowledge & Data Onboarding</h2>
        <p>Both methods automatically extract business information and save supported records into your company workspace.</p>
      </div></div>
      <div className="io-active">Import destination: <strong>{workspaceName}</strong>. A document naming a different company will be blocked.</div>
      <div className="io-options" role="group" aria-label="Choose onboarding method">
        <button type="button" aria-pressed={mode==='files'} className={mode==='files'?'io-option io-selected':'io-option'} onClick={()=>selectMode('files')}>
          <FileUp size={21}/><strong>1. Upload company files</strong><span>Read a complete company dataset or multiple documents.</span>
        </button>
        <button type="button" aria-pressed={mode==='write'} className={mode==='write'?'io-option io-selected':'io-option'} onClick={()=>selectMode('write')}>
          <PenLine size={21}/><strong>2. Write company details</strong><span>Type business information for AI to structure and save.</span>
        </button>
      </div>
      <form onSubmit={e=>{void save(e);}} className="io-form">
        {mode==='files'? <>
          <label className="io-label" htmlFor="io-upload">Company data files</label>
          <input id="io-upload" type="file" multiple accept=".zip,.json,.csv,.txt,.md" onChange={chooseFiles} disabled={working}/>
          {files.length>0&&<p className="io-subtle"><FileArchive size={14}/> {files.map(f=>f.name).join(', ')}</p>}
          <p className="io-subtle">ZIP, JSON and CSV are mapped directly. TXT and Markdown are analyzed with your AI provider. Maximum 5 MB total. Text-based PDF extraction requires a later integration.</p>
        </> : <>
          <label className="io-label" htmlFor="io-notes">Company profile, customers, catalog, policies and existing work</label>
          <textarea id="io-notes" rows={12} maxLength={15000} disabled={working} value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder={'Company name: '+workspaceName+'\nIndustry:\nWhat we sell / do:\nVerified products and prices:\nCustomer details (only if explicitly provided):\nCurrent enquiries, orders or work orders:\nShipping, returns and support policies:\nBusiness hours and contacts:'}/>
          <p className="io-subtle">Only information explicitly present in your text may be saved. The AI should not invent customers, transactions or prices.</p>
        </>}
        <button type="submit" className="io-submit" disabled={working||(mode==='files'?!files.length:notes.trim().length<20)}>
          {working?<><RotateCw className="io-spinner" size={17}/> Extracting and saving…</>:<><Database size={17}/> Analyze & automatically save to INTRIGUE</>}
        </button>
        <p className="io-subtle">Save happens in one database transaction. Existing records are merged, not erased. Quotes remain unsent drafts; no messages, payments or bookings are triggered.</p>
      </form>
      {error&&<div className="io-error" role="alert"><AlertTriangle size={18}/><span>{error}</span></div>}
      {done&&<div className="io-success" role="status"><div className="io-heading"><CheckCircle2 size={21}/><div><h3>{done.summary?.already_imported?'Already imported':'Company data saved successfully'}</h3><p>{done.summary?.message||'The workspace records have been updated.'}</p></div></div>
        <p className="io-subtle">Source: {done.source}</p>
        <div className="io-stats">{categories.map(([key,label])=><div key={key} className="io-stat"><span>{label}</span><strong>{done.summary?.counts?.[key]?.added??0} added</strong><small>{done.summary?.counts?.[key]?.skipped??0} skipped / existing</small></div>)}</div>
        <p className="io-subtle">Skipped records may be duplicates, missing customer references, or unsupported fields. No external action is taken.</p>
      </div>}
    </div>
    <div className="io-card">
      <div className="io-heading"><FileArchive size={19}/><div><h3>Imported orders & work orders ({orders.length})</h3><p>Saved for internal review. Not connected to payment, shop fulfillment or workshop dispatch.</p></div></div>
      {ordersError&&<p className="io-error" role="alert">{ordersError}. Run the V16.4 Supabase SQL migration.</p>}
      {!orders.length&&!ordersError&&<p className="io-subtle">No imported orders yet. A complete company database ZIP can populate this list.</p>}
      {orders.length>0&&<div className="io-order-scroll"><table className="io-table"><thead><tr><th>Reference</th><th>Kind</th><th>Item / job</th><th>Status</th><th>Value</th></tr></thead><tbody>
        {orders.map(o=><tr key={o.id}><td>{o.external_id}</td><td>{o.kind.replace('_',' ')}</td><td>{o.description}</td><td>{o.status}</td><td>{Number(o.amount).toLocaleString(undefined,{maximumFractionDigits:2})} {o.currency}</td></tr>)}
      </tbody></table></div>}
    </div>
  </div>;
}
