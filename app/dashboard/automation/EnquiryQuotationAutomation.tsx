'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, FilePlus2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import './enquiry-quotation-automation.css';

type Enquiry = {id:string;customer_id:string;subject:string;created_at:string;status:string};
type Customer = {id:string;full_name:string};
type Item = {catalog_id:string;item_name:string;quantity:number;unit_price:string;line_total:string};
type Suggestion = {kind?:string;outcome?:string;catalog_items?:Item[];total?:string;currency?:string;warnings?:string[];note?:string};
type Run = {id:string;status:string;payload?:{enquiry_id?:string};approved_at:string|null;last_error:string|null;result:Suggestion|null;created_at:string};
type Snapshot = {runs:Run[];draftLinks:{run_id:string;quotation_id:string}[]};
const message=(error:unknown)=>error instanceof Error?error.message:'Request failed.';
const money=(value:string)=>new Intl.NumberFormat('en-DE',{style:'currency',currency:'EUR'}).format(Number(value));

export default function EnquiryQuotationAutomation({workspaceId,canManage}:{workspaceId:string;canManage:boolean}) {
  const supabase=useMemo(()=>createClient(),[]);
  const workspaceRef=useRef(workspaceId);
  workspaceRef.current=workspaceId;
  const [enquiries,setEnquiries]=useState<Enquiry[]>([]);
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [snapshot,setSnapshot]=useState<Snapshot>({runs:[],draftLinks:[]});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  const api=useCallback(async (operation?:string,more?:Record<string,unknown>)=>{
    const {data,error:authError}=await supabase.auth.getSession();
    if (authError || !data.session?.access_token) throw Error('Please sign in again.');
    const result=await fetch(operation?'/api/automation/v17':`/api/automation/v17?workspaceId=${encodeURIComponent(workspaceId)}`,{
      method:operation?'POST':'GET',cache:'no-store',headers:{
        Authorization:`Bearer ${data.session.access_token}`,...(operation?{'Content-Type':'application/json'}:{})
      },...(operation?{body:JSON.stringify({workspaceId,operation,...more})}:{})
    });
    const body=await result.json().catch(()=>null);
    if (!result.ok) throw Error(body?.error || `Request failed (${result.status}).`);
    return body;
  },[supabase,workspaceId]);

  const load=useCallback(async()=>{
    const [e,c,s]=await Promise.all([
      supabase.from('enquiries').select('id,customer_id,subject,status,created_at')
        .eq('workspace_id',workspaceId).order('created_at',{ascending:false}).limit(40),
      supabase.from('customers').select('id,full_name').eq('workspace_id',workspaceId).limit(200),
      api()
    ]);
    if(e.error || c.error || !Array.isArray(s.runs)) throw Error('Enquiry records are unavailable. Confirm workspace permissions.');
    if(workspaceRef.current!==workspaceId)return; // a prior workspace request may finish late
    setEnquiries((e.data||[]) as Enquiry[]);
    setCustomers((c.data||[]) as Customer[]);
    setSnapshot({runs:s.runs,draftLinks:Array.isArray(s.draftLinks)?s.draftLinks:[]});
  },[supabase,workspaceId,api]);
  useEffect(()=>{
    let live=true;
    setLoading(true);setEnquiries([]);setCustomers([]);setSnapshot({runs:[],draftLinks:[]});setNotice('');setError('');
    if (!workspaceId || !canManage) {setLoading(false);return;}
    void load().catch(e=>{if(live)setError(message(e));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[workspaceId,canManage,load]);

  const runByEnquiry=useMemo(()=>new Map(snapshot.runs.filter(r=>r.payload?.enquiry_id).map(r=>[r.payload!.enquiry_id!,r])),[snapshot.runs]);
  const customersById=useMemo(()=>new Map(customers.map(c=>[c.id,c.full_name])),[customers]);
  const linkByRun=useMemo(()=>new Map(snapshot.draftLinks.map(l=>[l.run_id,l.quotation_id])),[snapshot.draftLinks]);

  const act=async(operation:string,more:Record<string,unknown>,confirmation:string,success:string)=>{
    if(busy || !window.confirm(confirmation))return;
    setBusy(true);setError('');setNotice('');
    try {
      const result=await api(operation,more);
      await load();
      setNotice(operation==='commit_quote' ? `Saved existing quotation draft ${String(result.quotationId).slice(0,8)}. Open Quotations to review it. Nothing was sent.`:success);
    } catch(e) {setError(message(e));}
    finally {setBusy(false);}
  };
  if(!canManage)return null;
  return <section className="v172" aria-label="Enquiry-to-quotation drafting">
    <div className="v172-head"><div><span className="v172-eyebrow"><FilePlus2 size={14}/> V17.2A · INTERNAL QUOTATION DRAFTS</span>
      <h2>Turn enquiries into reviewable quotations</h2>
      <p>AI suggests existing catalog items. The worker runs only after approval. Prices come from Supabase, not AI. A second explicit confirmation is required to save a draft. Nothing is sent.</p>
    </div><button type="button" disabled={busy||loading} onClick={()=>void load().then(()=>setNotice('Quotation data refreshed.')).catch(e=>setError(message(e)))}><RefreshCw size={15}/> Refresh</button></div>
    <p className="v172-hint"><ShieldCheck size={15}/> Staging first · Human-controlled · Local worker · No automatic sending or customer-facing changes.</p>
    {error&&<div className="v172-error" role="alert">{error}</div>}
    {notice&&<div className="v172-notice" role="status">{notice}</div>}
    {loading?<p className="v172-empty">Loading enquiries…</p>:enquiries.length===0?<p className="v172-empty">No enquiries found. Add a sample enquiry in the CRM first.</p>:<div className="v172-list">
      {enquiries.map(enquiry=>{
        const run=runByEnquiry.get(enquiry.id);
        const suggestion=run?.result;
        const saved=run?linkByRun.get(run.id):undefined;
        const canCommit=run?.status==='succeeded'&&suggestion?.outcome==='matched'&&!saved;
        return <article className="v172-item" key={enquiry.id}>
          <div className="v172-row"><div><strong>{enquiry.subject}</strong><p>{customersById.get(enquiry.customer_id)||'Customer'} · {new Date(enquiry.created_at).toLocaleDateString()} · {enquiry.status}</p></div>
            <span className="v172-status">{saved?'Draft saved':run?run.status.replaceAll('_',' '):'Not queued'}</span></div>
          {run?.last_error&&<p className="v172-error">Worker: {run.last_error}</p>}
          {suggestion?.kind==='quotation_draft'&&<div className="v172-preview">
            <strong>{suggestion.outcome==='matched'?'Catalog match found':'Needs manual review'}</strong>
            {suggestion.catalog_items?.length?<table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Line</th></tr></thead>
              <tbody>{suggestion.catalog_items.map(item=><tr key={item.catalog_id}><td>{item.item_name}</td><td>{item.quantity}</td><td>{money(item.unit_price)}</td><td>{money(item.line_total)}</td></tr>)}</tbody>
              <tfoot><tr><th colSpan={3}>Subtotal (before tax)</th><th>{money(suggestion.total||'0')}</th></tr></tfoot></table>:null}
            {(suggestion.warnings||[]).map((warning,i)=><p key={i} className="v172-warning">{warning}</p>)}
            {saved&&<p className="v172-notice"><CheckCircle2 size={15}/> Quotation {saved.slice(0,8)} saved. Review it in Quotations.</p>}
          </div>}
          <div className="v172-actions">
            {!run&&<button disabled={busy} onClick={()=>void act('enqueue_quotation',{enquiryId:enquiry.id},'Queue an internal AI analysis request for this enquiry? Approval will still be required.','Queued for owner approval.')}><FilePlus2 size={14}/> Queue quotation analysis</button>}
            {run?.status==='awaiting_approval'&&<><button disabled={busy} onClick={()=>void act('approve',{runId:run.id},'Approve AI analysis of this enquiry using the local worker? No quotation will be saved or sent yet.','Approved. Run the local worker once.')}><ShieldCheck size={14}/> Approve analysis</button>
              <button disabled={busy} onClick={()=>void act('cancel',{runId:run.id},'Cancel this analysis request?','Run cancelled.')}><XCircle size={14}/> Cancel</button></>}
            {run&&['queued','retry_wait'].includes(run.status)&&<button disabled={busy} onClick={()=>void act('cancel',{runId:run.id},'Cancel this pending analysis?','Run cancelled.')}><XCircle size={14}/> Cancel</button>}
            {run?.status==='dead_letter'&&<button disabled={busy} onClick={()=>void act('retry',{runId:run.id},'Retry this already approved AI analysis? It may consume additional AI credits.','Run queued for retry.')}>Retry analysis</button>}
            {canCommit&&<button className="v172-save" disabled={busy} onClick={()=>void act('commit_quote',{runId:run!.id},`Create an INTERNAL draft quotation for ${customersById.get(enquiry.customer_id)||'this customer'} using the verified prices shown? No email will be sent.`, 'Draft saved.')}><CheckCircle2 size={14}/> Save quotation draft</button>}
            {run?.status==='succeeded'&&suggestion?.outcome==='needs_review'&&<span className="v172-muted">Resolve unmatched items in Quotations manually. Nothing has been saved.</span>}
          </div>
        </article>;
      })}
    </div>}
    <p className="v172-muted">Each enquiry can be queued only once in V17.2A. Reanalysis after catalog changes requires a later release. The local worker also needs OPENROUTER_API_KEY in its own private environment.</p>
  </section>;
}
