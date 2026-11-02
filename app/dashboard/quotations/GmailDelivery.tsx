'use client';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Send, ShieldCheck, RefreshCw } from 'lucide-react';
import './gmail-delivery.css';

type Preview = { recipient: string; subject: string; body: string };
type Delivery = { id: string; quotation_id: string; recipient: string; status: string; submitted_at: string | null; created_at: string };
type Status = { connected: boolean; sender: string | null; delivery: Delivery[] };
function formatError(value: unknown) { return value instanceof Error ? value.message : String(value || 'Something went wrong'); }
async function pdfAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    content += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(content);
}
export default function GmailDelivery({ workspaceId, quotationId, preview, pendingChanges }: {
  workspaceId: string;
  quotationId: string;
  preview: Preview;
  pendingChanges: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [submitted, setSubmitted] = useState(false);
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
    setStatus({
      connected: data.connected === true,
      sender: typeof data.sender === 'string' ? data.sender : null,
      delivery: Array.isArray(data.delivery) ? data.delivery as Delivery[] : [],
    });
  }, [api]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    refresh().catch(e => { if (current) setError(formatError(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refresh]);
  // INTRIGUE_V1657: Manage provider OAuth exclusively in Integrations.
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError(''); setFile(null); setReviewed(false); setConfirmation('');
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 1_500_000 || selected.size < 100 || !/\.pdf$/i.test(selected.name)) {
      setError('Choose the approved PDF from Print → Save as PDF (100 bytes–1.5 MB).');
      return;
    }
    setFile(selected);
  }
  async function send() {
    if (!file || !reviewed || pendingChanges || !status?.connected || confirmation !== 'SEND' || submitted || priorAttempt || isDemo || busy) return;
    if (!window.confirm(`FINAL CONFIRMATION\n\nFrom: ${status.sender}\nTo: ${preview.recipient}\nSubject: ${preview.subject}\nPDF: ${file.name}\n\nSend this approved proposal through Gmail now?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const pdfBase64 = await pdfAsBase64(file);
      const result = await api('/api/mail/send', 'POST', {
        workspaceId, quotationId, pdfBase64, confirmation: 'SEND APPROVED PROPOSAL',
      });
      setSubmitted(result.submitted === true);
      setNotice(typeof result.warning === 'string' ? result.warning : 'Gmail accepted the message and attached PDF. Inbox delivery is not confirmed.');
      await refresh();
      window.dispatchEvent(new CustomEvent("intrigue:proposal-approval-updated", { detail: { workspaceId } }));
    } catch (e) { setError(formatError(e)); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  return <section className="gd-panel" aria-label="Gmail approved proposal delivery">
    <div className="gd-head"><h4><ShieldCheck size={17}/> Gmail delivery</h4><span className="gd-pill">Owner/Admin only</span></div>
    <p className="gd-hint">Send only after proposal approval. Gmail sends the email and your reviewed PDF attachment; no automated resend occurs.</p>
    {loading ? <p className="gd-hint"><Loader2 size={14}/> Checking connection…</p> : <>
      {status?.connected ? <div className="gd-connection">
        <div><strong>Sender connected in Integrations</strong><p>{status.sender}</p></div>
        <div className="gd-controls"><button type="button" className="gd-btn" disabled={busy} onClick={() => void refresh().catch(e => setError(formatError(e)))}><RefreshCw size={14}/> Refresh status</button></div>
      </div> : <div className="gd-connection">
        <div><strong>No Gmail sender connected</strong><p>Open INTRIGUE → Integrations → Business email to connect Gmail. Then return to this approved proposal to deliver it.</p></div>
      </div>}
    </>}
    {status?.connected && <div className="gd-send">
      {priorAttempt && <p className="gd-warning">This quotation already has a Gmail delivery attempt. Check its status below and Gmail Sent before taking further action. Automatic resend is blocked.</p>}
      <p><strong>Recipient:</strong> {preview.recipient}</p>
      {isDemo ? <p className="gd-warning">This is a fictional demonstration address. Sending is disabled.</p> : <>
        <label className="gd-file">Attach the approved proposal PDF
          <input type="file" accept=".pdf,application/pdf" onChange={chooseFile} disabled={busy || submitted || priorAttempt}/>
        </label>
        <p className="gd-hint">Use the quotation's <strong>Print / Save as PDF</strong> first, then select that reviewed file (maximum 1.5 MB). INTRIGUE does not generate the attachment automatically in this release.</p>
        {file && <p className="gd-filename">Selected: {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
        <label className="gd-check"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy || submitted || priorAttempt}/>
          I have reviewed this PDF, recipient, total, VAT and approved proposal.</label>
        <label className="gd-confirm">Type <strong>SEND</strong> to enable delivery
          <input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" placeholder="SEND" disabled={busy || submitted || priorAttempt}/>
        </label>
        <button type="button" className="gd-btn gd-primary" onClick={() => void send()}
          disabled={busy || !file || !reviewed || confirmation !== 'SEND' || pendingChanges || submitted || priorAttempt}>
          <Send size={15}/> {busy ? 'Submitting to Gmail…' : submitted ? 'Already submitted' : 'Send approved proposal with PDF'}</button>
      </>}
    </div>}
    {error && <p className="gd-error" role="alert">{error}</p>}
    {notice && <p className="gd-success" role="status">{notice}</p>}
    {status?.delivery && status.delivery.length > 0 && <details className="gd-history"><summary>Recent Gmail delivery attempts ({status.delivery.length})</summary>
      <ul>{status.delivery.map(d => <li key={d.id}><strong>{d.status}</strong> · {d.recipient} · {new Date(d.created_at).toLocaleString()}</li>)}</ul>
      <p className="gd-hint">“Submitted” means Gmail accepted the request, not that the customer received or opened the email. An “uncertain” attempt must be checked in Gmail Sent before recovery.</p>
    </details>}
  </section>;
}
