'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FileCheck2, FileDown, Eye, Loader2, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import './gmail-delivery.css';
import './automatic-pdf.css';
import {EmailDeliveryPreferencesSummary,useDeliveryPreferences} from './EmailDeliveryPreferences'; // INTRIGUE_V169_EMAIL

type Preview = { recipient: string; subject: string; body: string };
type Delivery = { id: string; quotation_id: string; recipient: string; status: string; submitted_at: string | null; created_at: string };
type Status = { connected: boolean; sender: string | null; delivery: Delivery[] };
type PdfPreview = { url: string; snapshotHash: string; sha256: string; bytes: number };
function formatError(value: unknown) { return value instanceof Error ? value.message : String(value || 'Something went wrong'); }
async function pdfAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content = '';
  for (let i = 0; i < bytes.length; i += 8192) content += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(content);
}
export default function GmailDelivery({ workspaceId, quotationId, preview, pendingChanges }: {
  workspaceId: string; quotationId: string; preview: Preview; pendingChanges: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualPdf, setManualPdf] = useState<File | null>(null);
  const [generatedPdf, setGeneratedPdf] = useState<PdfPreview | null>(null);
  const urlRef = useRef<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const {prefs:mailPrefs,error:mailPrefsError,loading:mailPrefsLoading}=useDeliveryPreferences(workspaceId);
  const isDemo = /\.(example|test|invalid)$/i.test((preview.recipient.split('@')[1] || '').trim());
  const priorAttempt = !!status?.delivery?.length;
  const auth = useCallback(async () => {
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.access_token) throw new Error('Please sign in again to use Gmail.');
    return session.access_token;
  }, [supabase]);
  const api = useCallback(async (path: string, method: 'GET' | 'POST', data?: Record<string, unknown>) => {
    const token = await auth();
    const endpoint = path === '/api/mail/status'
      ? `${path}?workspaceId=${encodeURIComponent(workspaceId)}&quotationId=${encodeURIComponent(quotationId)}` : path;
    const response = await fetch(endpoint, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const result: unknown = await response.json().catch(() => null);
    const object = result && typeof result === 'object' ? result as Record<string, unknown> : null;
    if (!response.ok) throw new Error(typeof object?.error === 'string' ? object.error : 'Email action failed.');
    return object || {};
  }, [auth, workspaceId, quotationId]);
  const refresh = useCallback(async () => {
    const data = await api('/api/mail/status', 'GET');
    setStatus({ connected: data.connected === true,
      sender: typeof data.sender === 'string' ? data.sender : null,
      delivery: Array.isArray(data.delivery) ? data.delivery as Delivery[] : [] });
  }, [api]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    refresh().catch(e => { if (current) setError(formatError(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refresh]);
  // A changed proposal, recipient or active workspace always invalidates the preview.
  // Do not let the browser reuse an obsolete generated attachment.
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current=null;
    setGeneratedPdf(null); setManualPdf(null); setReviewed(false); setConfirmation('');
  }, [workspaceId, quotationId, preview.recipient, preview.subject, preview.body, pendingChanges]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  useEffect(()=>{setReviewed(false);setConfirmation('');},[mailPrefs?.revision]);
  async function generatePdf() {
    if (busy || rendering || pendingChanges) return;
    setRendering(true);setError('');setNotice('');
    setReviewed(false);setConfirmation('');
    try {
      const token=await auth();
      const res=await fetch('/api/mail/approved-pdf',{
        method:'POST',cache:'no-store',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({workspaceId,quotationId}),
      });
      if(!res.ok) {
        const body:unknown=await res.json().catch(()=>null);
        const info=body && typeof body==='object' ? body as {error?:string} : null;
        throw new Error(info?.error||'Could not generate the currently approved PDF.');
      }
      if(!res.headers.get('content-type')?.includes('application/pdf')) throw new Error('The server did not provide a PDF.');
      const snapshotHash=res.headers.get('x-intrigue-snapshot-sha256')||'';
      const pdfSha=res.headers.get('x-intrigue-pdf-sha256')||'';
      if(!/^[a-f0-9]{64}$/.test(snapshotHash)||!/^[a-f0-9]{64}$/.test(pdfSha)) throw new Error('The PDF could not be verified against the approved proposal.');
      const blob=await res.blob();
      if(blob.size < 200 || blob.size > 1_500_000) throw new Error('The PDF was empty or exceeded 1.5 MB.');
      const url=URL.createObjectURL(blob);
      if(urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current=url;
      setGeneratedPdf({url,snapshotHash,sha256:pdfSha,bytes:blob.size});
      setNotice('Approved PDF generated. Open it and review the recipient, line items, total, VAT, text and logo before sending.');
    } catch(e) {setGeneratedPdf(null);setError(formatError(e));}
    finally {setRendering(false);}
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError('');setManualPdf(null);setReviewed(false);setConfirmation('');
    const selected=event.target.files?.[0];
    if(!selected) return;
    if(selected.size>1_500_000||selected.size<100||!/\.pdf$/i.test(selected.name)) {
      setError('Choose a reviewed PDF between 100 bytes and 1.5 MB.');return;
    }
    setManualPdf(selected);
  }
  async function send() {
    const hasAttachment=manualMode ? !!manualPdf : !!generatedPdf;
    if (!hasAttachment || !reviewed || pendingChanges || !status?.connected || confirmation !== 'SEND' || submitted || priorAttempt || isDemo || busy || rendering || !mailPrefs || !!mailPrefsError || mailPrefsLoading) return;
    const attachmentDescription=manualMode ? manualPdf?.name || 'manual PDF' : 'server-generated approved PDF';
    if (!window.confirm(`FINAL CONFIRMATION\n\nFrom: ${status.sender}\nTo: ${preview.recipient}\nSubject: ${preview.subject}\nReply-to: ${mailPrefs?.replyTo || status.sender}\nSignature: ${mailPrefs?.signature || '(none)'}\nPDF: ${attachmentDescription}\n\nSend this approved proposal through Gmail now?`)) return;
    setBusy(true);setError('');setNotice('');
    try {
      const payload:Record<string,unknown>={workspaceId,quotationId,confirmation:'SEND APPROVED PROPOSAL',preferencesRevision:mailPrefs!.revision};
      if(manualMode) payload.pdfBase64=await pdfAsBase64(manualPdf!);
      else {payload.attachmentMode='generated';payload.previewSnapshotHash=generatedPdf!.snapshotHash;}
      const result=await api('/api/mail/send','POST',payload);
      setSubmitted(result.submitted===true);
      setNotice(typeof result.warning==='string' ? result.warning : 'Gmail accepted the approved proposal and PDF attachment. Inbox delivery is not confirmed.');
      await refresh();
      window.dispatchEvent(new CustomEvent('intrigue:proposal-approval-updated',{detail:{workspaceId}}));
    } catch(e) {setError(formatError(e));await refresh().catch(()=>{});}
    finally {setBusy(false);}
  }
  return <section className="gd-panel" aria-label="Gmail approved proposal delivery">
    <div className="gd-head"><h4><ShieldCheck size={17}/> Gmail delivery</h4><span className="gd-pill">Owner/Admin only</span></div>
    <p className="gd-hint">Attach the approved PDF automatically from INTRIGUE. Sending still requires your final review and confirmation.</p>
    {loading ? <p className="gd-hint"><Loader2 size={14}/> Checking sender…</p> :
      status?.connected ? <div className="gd-connection">
        <div><strong>Sender connected in Integrations</strong><p>{status.sender}</p></div>
        <button type="button" className="gd-btn" disabled={busy} onClick={()=>void refresh().catch(e=>setError(formatError(e)))}><RefreshCw size={14}/> Refresh status</button>
      </div> : <div className="gd-connection"><div><strong>Gmail is not connected</strong><p>Connect Gmail from Integrations → Business email. This page handles delivery only.</p></div></div>
    }
    {status?.connected && <div className="gd-send">
      {priorAttempt && <p className="gd-warning">A Gmail attempt already exists for this approved revision. Check Gmail Sent and the delivery history. Duplicate submissions remain blocked.</p>}
      <p><strong>Recipient:</strong> {preview.recipient}</p>
      {isDemo ? <p className="gd-warning">This is a fictional demonstration address. Sending is disabled, but PDF preview remains available.</p> : null}
      <div className="gd-auto-pdf">
        <div className="gd-auto-heading"><FileCheck2 size={18}/><div><strong>Automatic approved PDF</strong><p>The PDF is built from saved and approved company records. No download/re-upload needed.</p></div></div>
        <button className="gd-btn gd-primary" type="button" onClick={()=>void generatePdf()} disabled={rendering||busy||pendingChanges}>
          {rendering ? <Loader2 size={15}/> : <FileDown size={15}/>} {rendering?'Generating PDF…':generatedPdf?'Regenerate approved PDF':'Generate approved PDF'}
        </button>
        {generatedPdf && <div className="gd-preview-actions">
          <a className="gd-btn" href={generatedPdf.url} target="_blank" rel="noopener noreferrer"><Eye size={15}/> Preview PDF</a>
          <a className="gd-btn" href={generatedPdf.url} download={`INTRIGUE-Proposal-${quotationId.slice(0,8)}.pdf`}><FileDown size={15}/> Download copy</a>
          <span>{Math.ceil(generatedPdf.bytes/1024)} KB · Server verified</span>
        </div>}
      </div>
      <details className="gd-manual"><summary>Alternative: use a manually reviewed PDF</summary>
        <label className="gd-check"><input type="checkbox" checked={manualMode} onChange={e=>{setManualMode(e.target.checked);setReviewed(false);setConfirmation('');}} disabled={busy||submitted||priorAttempt}/> Use manual attachment instead of automatic PDF</label>
        {manualMode && <label className="gd-file">Attach the reviewed PDF<input type="file" accept=".pdf,application/pdf" onChange={chooseFile} disabled={busy||submitted||priorAttempt}/></label>}
        {manualMode && manualPdf && <p className="gd-filename">Selected: {manualPdf.name} ({Math.ceil(manualPdf.size/1024)} KB)</p>}
      </details>
      <EmailDeliveryPreferencesSummary prefs={mailPrefs} loading={mailPrefsLoading} error={mailPrefsError}/>
      <label className="gd-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy||submitted||priorAttempt||!(manualMode?manualPdf:generatedPdf)}/>
        I have opened and reviewed the final PDF, recipient, total, VAT and approved proposal.</label>
      <label className="gd-confirm">Type <strong>SEND</strong> to confirm delivery
        <input value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off" placeholder="SEND" disabled={busy||submitted||priorAttempt}/>
      </label>
      <button className="gd-btn gd-primary" type="button" onClick={()=>void send()}
        disabled={busy||rendering||!reviewed||confirmation!=='SEND'||pendingChanges||submitted||priorAttempt||isDemo||!(manualMode?manualPdf:generatedPdf)||!mailPrefs||mailPrefsLoading||!!mailPrefsError}>
        <Send size={15}/> {busy?'Submitting to Gmail…':submitted?'Already submitted':'Send approved proposal with PDF'}
      </button>
    </div>}
    {error && <p className="gd-error" role="alert">{error}</p>}
    {notice && <p className="gd-success" role="status">{notice}</p>}
    {!!status?.delivery?.length && <details className="gd-history"><summary>Recent Gmail delivery attempts ({status!.delivery.length})</summary>
      <ul>{status!.delivery.map(d=><li key={d.id}><strong>{d.status}</strong> · {d.recipient} · {new Date(d.created_at).toLocaleString()}</li>)}</ul>
      <p className="gd-hint">Submitted means Gmail accepted the message. It does not prove delivery or a read receipt. Never automatically resend uncertain attempts.</p>
    </details>}
  </section>;
}
