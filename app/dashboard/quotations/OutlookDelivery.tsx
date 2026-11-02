'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Eye, FileDown, FileCheck2, Loader2, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import './outlook-delivery.css';

type Preview={recipient:string;subject:string;body:string};
type Attempt={id:string;status:string;recipient?:string;created_at:string};
type Status={connected:boolean;sender:string|null;delivery:Attempt[];gmailAttempts:Attempt[]};
type Pdf={url:string;snapshotHash:string;size:number};
function message(e:unknown){return e instanceof Error?e.message:'Outlook action failed.';}
export default function OutlookDelivery({workspaceId,quotationId,preview,pendingChanges}:{
  workspaceId:string;quotationId:string;preview:Preview;pendingChanges:boolean;
}) {
  const supabase=useMemo(()=>createClient(),[]);
  const [status,setStatus]=useState<Status|null>(null);
  const [pdf,setPdf]=useState<Pdf|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [confirmation,setConfirmation]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [rendering,setRendering]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const urlRef=useRef<string|null>(null);
  const isDemo=/\.(example|test|invalid)$/i.test(preview.recipient.split('@')[1]||'');
  const priorAttempt=!!(status?.delivery?.length||status?.gmailAttempts?.length);
  const api=useCallback(async (path:string,method:'GET'|'POST',data?:Record<string,unknown>)=>{
    const {data:auth,error:authError}=await supabase.auth.getSession();
    if(authError||!auth.session?.access_token)throw new Error('Sign in again to send with Outlook.');
    const endpoint=method==='GET'?`${path}?workspaceId=${encodeURIComponent(workspaceId)}&quotationId=${encodeURIComponent(quotationId)}`:path;
    const response=await fetch(endpoint,{method,cache:'no-store',
      headers:{Authorization:`Bearer ${auth.session.access_token}`,...(data?{'Content-Type':'application/json'}:{})},
      ...(data?{body:JSON.stringify(data)}:{})});
    const contentType=response.headers.get('content-type')||'';
    if(contentType.includes('application/pdf'))return response;
    const payload:unknown=await response.json().catch(()=>null);
    const result=payload&&typeof payload==='object' ? payload as Record<string,unknown> : {};
    if(!response.ok)throw new Error(typeof result.error==='string'?result.error:`Outlook action failed (${response.status}).`);
    return result;
  },[supabase,workspaceId,quotationId]);
  const refresh=useCallback(async()=>{
    const payload=await api('/api/mail/outlook/status','GET');
    if(payload instanceof Response)throw new Error('Unexpected status response.');
    setStatus({connected:payload.connected===true,sender:typeof payload.sender==='string'?payload.sender:null,
      delivery:Array.isArray(payload.delivery)?payload.delivery as Attempt[]:[],
      gmailAttempts:Array.isArray(payload.gmailAttempts)?payload.gmailAttempts as Attempt[]:[]});
  },[api]);
  useEffect(()=>{
    let active=true;setLoading(true);setStatus(null);setError('');setNotice('');
    refresh().catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[refresh]);
  useEffect(()=>{
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);
    urlRef.current=null;setPdf(null);setReviewed(false);setConfirmation('');
  },[workspaceId,quotationId,preview.recipient,preview.subject,preview.body,pendingChanges]);
  useEffect(()=>()=>{if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  async function generate(){
    if(rendering||busy||pendingChanges)return;
    setRendering(true);setError('');setNotice('');setReviewed(false);setConfirmation('');
    try{
      const {data:auth}=await supabase.auth.getSession();
      if(!auth.session?.access_token)throw new Error('Sign in again.');
      const res=await fetch('/api/mail/approved-pdf',{method:'POST',cache:'no-store',
        headers:{Authorization:`Bearer ${auth.session.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify({workspaceId,quotationId})});
      if(!res.ok){const data:unknown=await res.json().catch(()=>null);
        const errorText=data&&typeof data==='object'?(data as {error?:string}).error:null;
        throw new Error(errorText||'Could not generate an approved PDF.');}
      if(!res.headers.get('content-type')?.includes('application/pdf'))throw new Error('Server did not return a PDF.');
      const snapshotHash=res.headers.get('x-intrigue-snapshot-sha256')||'';
      if(!/^[a-f0-9]{64}$/.test(snapshotHash))throw new Error('PDF approval fingerprint missing.');
      const blob=await res.blob();
      if(blob.size<200||blob.size>1_500_000)throw new Error('Approved PDF size invalid.');
      const url=URL.createObjectURL(blob);
      if(urlRef.current)URL.revokeObjectURL(urlRef.current);
      urlRef.current=url;setPdf({url,snapshotHash,size:blob.size});
      setNotice('Open and review this server-generated PDF, then confirm the final Outlook submission.');
    }catch(e){setError(message(e));setPdf(null);}finally{setRendering(false);}
  }
  async function send(){
    if(!status?.connected||priorAttempt||!pdf||!reviewed||confirmation!=='SEND'||busy||rendering||pendingChanges||isDemo)return;
    if(!window.confirm(`SEND APPROVED PROPOSAL VIA OUTLOOK?\n\nFrom: ${status.sender}\nTo: ${preview.recipient}\nSubject: ${preview.subject}\nPDF: server-generated and reviewed\n\nMicrosoft Graph may submit this once. Do not retry on a timeout.`))return;
    setBusy(true);setError('');setNotice('');
    try{
      const response=await api('/api/mail/outlook/send','POST',{
        workspaceId,quotationId,previewSnapshotHash:pdf.snapshotHash,confirmation:'SEND APPROVED PROPOSAL'});
      if(response instanceof Response||response.submitted!==true)throw new Error('Outlook submission was not confirmed.');
      setNotice('Microsoft Graph accepted this message (202). Inbox delivery has not been confirmed.');
      await refresh();
      window.dispatchEvent(new CustomEvent('intrigue:proposal-approval-updated',{detail:{workspaceId}}));
    }catch(e){setError(message(e));await refresh().catch(()=>{});}finally{setBusy(false);}
  }
  return <section className="od-panel" aria-label="Outlook approved proposal delivery">
    <div className="od-heading"><h4><ShieldCheck size={17}/> Outlook delivery</h4><span>Owner/Admin only</span></div>
    <p>Send an approved proposal through the company Outlook/Microsoft 365 account connected in Integrations.</p>
    {loading?<p><Loader2 size={14}/> Checking Outlook connection…</p>:
      status?.connected?<p className="od-connection"><strong>Connected sender:</strong> {status.sender} <button type="button" onClick={()=>void refresh().catch(e=>setError(message(e)))} disabled={busy}><RefreshCw size={13}/> Refresh</button></p>
      :<p>Outlook not connected. Go to Integrations → Business email to authorize Microsoft.</p>}
    {status?.connected&&<div className="od-body">
      <p><strong>Recipient:</strong> {preview.recipient}</p>
      {isDemo&&<p className="od-warning">Fictional .example recipients are blocked.</p>}
      {priorAttempt&&<p className="od-warning">A Gmail or Outlook attempt already exists for this quotation. Never resend an uncertain attempt without manual reconciliation.</p>}
      <button className="od-primary" type="button" onClick={()=>void generate()} disabled={busy||rendering||pendingChanges}><FileCheck2 size={15}/> {rendering?'Generating…':pdf?'Regenerate approved PDF':'Generate approved PDF'}</button>
      {pdf&&<div className="od-actions"><a href={pdf.url} target="_blank" rel="noopener noreferrer"><Eye size={15}/> Preview PDF</a><a href={pdf.url} download={`INTRIGUE-Proposal-${quotationId.slice(0,8)}.pdf`}><FileDown size={15}/> Download copy</a><small>{Math.ceil(pdf.size/1024)} KB</small></div>}
      <label className="od-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={!pdf||busy||priorAttempt}/> I reviewed the PDF, recipient, prices, VAT and approval.</label>
      <label className="od-confirm">Type <strong>SEND</strong> for final confirmation<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="SEND" autoComplete="off" disabled={busy||priorAttempt}/></label>
      <button type="button" className="od-primary" onClick={()=>void send()} disabled={busy||rendering||!pdf||!reviewed||confirmation!=='SEND'||priorAttempt||pendingChanges||isDemo}><Send size={15}/> {busy?'Submitting to Microsoft…':priorAttempt?'Already attempted':'Send approved proposal through Outlook'}</button>
      <small>202 Accepted means Graph took the request. It does not confirm receipt or a read.</small>
    </div>}
    {error&&<p className="od-error" role="alert">{error}</p>}{notice&&<p className="od-success" role="status">{notice}</p>}
    {!!status?.delivery?.length&&<details><summary>Recent Outlook attempts ({status.delivery.length})</summary>
      <ul>{status.delivery.map(x=><li key={x.id}>{x.status} · {new Date(x.created_at).toLocaleString()}</li>)}</ul></details>}
  </section>;
}
