'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, Link2, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import './business-email-connections.css';

type Connection = { connected: boolean; sender: string | null };
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unable to manage your email connection.'; }

export default function BusinessEmailConnections({ workspaceId }: { workspaceId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const accessToken = useCallback(async () => {
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.access_token) throw new Error('Sign in again to manage business email.');
    return session.access_token;
  }, [supabase]);

  const callMail = useCallback(async (path: string, method: 'GET' | 'POST', body?: Record<string, unknown>) => {
    const token = await accessToken();
    const url = path === '/api/mail/status' ? `${path}?workspaceId=${encodeURIComponent(workspaceId)}` : path;
    const response = await fetch(url, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data: unknown = await response.json().catch(() => null);
    const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
    if (!response.ok) throw new Error(typeof obj.error === 'string' ? obj.error : `Gmail request failed (${response.status}).`);
    return obj;
  }, [workspaceId, accessToken]);

  const refresh = useCallback(async () => {
    const data = await callMail('/api/mail/status', 'GET');
    setConnection({ connected: data.connected === true, sender: typeof data.sender === 'string' ? data.sender : null });
  }, [callMail]);

  useEffect(() => {
    let current = true;
    setRole(''); setConnection(null); setLoading(true); setError(''); setNotice('');
    (async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('Sign in again to view email connections.');
      const { data, error: memberError } = await supabase.from('workspace_memberships')
        .select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!data) throw new Error('No access to this company workspace.');
      if (!current) return;
      setRole(String(data.role || ''));
      if (data.role === 'owner' || data.role === 'admin') await refresh();
    })().catch(e => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, supabase, refresh]);

  async function connect() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await callMail('/api/mail/google/start', 'POST', { workspaceId });
      if (typeof data.authorizationUrl !== 'string') throw new Error('Google did not return an authorization URL.');
      const redirect = new URL(data.authorizationUrl);
      if (redirect.origin !== 'https://accounts.google.com') throw new Error('Unexpected Google authorization destination.');
      window.location.assign(redirect.href);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  async function disconnect() {
    if (busy || !window.confirm(`Disconnect Gmail ${connection?.sender || ''} from this company? This does not revoke access inside your Google account.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await callMail('/api/mail/disconnect', 'POST', { workspaceId });
      await refresh();
      setNotice('Gmail disconnected for this company. Existing proposal delivery records were preserved.');
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const canManage = role === 'owner' || role === 'admin';
  return <section className="bec-panel" aria-label="Business email integrations">
    <div className="bec-heading"><div><h3><Mail size={18}/> Business email</h3>
      <p>Connect a sender once per company here. Approved proposal delivery stays in Quotations.</p></div>
      <span className="bec-label"><ShieldCheck size={13}/> Owner/Admin</span>
    </div>
    {loading ? <p className="bec-muted"><Loader2 size={14}/> Checking access and Gmail connection…</p>
      : !canManage ? <p className="bec-muted">Only this company's Owner or Admin can manage its email accounts.</p>
      : <div className="bec-providers">
        <div className="bec-provider">
          <div className="bec-provider-info"><strong>Gmail</strong>
            {connection?.connected ? <p className="bec-connected"><CheckCircle2 size={14}/> Connected: {connection.sender}</p> : <p>Not connected. Authorize Gmail to send approved proposals on behalf of this company.</p>}
            <small>Uses Google's send-only OAuth permission. Access is isolated to this workspace.</small>
          </div>
          <div className="bec-actions">
            {connection?.connected ? <>
              <button type="button" disabled={busy} onClick={() => void refresh().catch(e => setError(errorMessage(e)))}><RefreshCw size={14}/> Refresh</button>
              <button type="button" disabled={busy} onClick={() => void disconnect()}><Unplug size={14}/> Disconnect</button>
            </> : <button type="button" className="bec-primary" disabled={busy} onClick={() => void connect()}><Link2 size={14}/> Connect Gmail</button>}
          </div>
        </div>
        <div className="bec-provider"><div className="bec-provider-info"><strong>Microsoft Outlook</strong><p>Not connected. Microsoft Graph OAuth sending has not been implemented yet.</p></div><span className="bec-upcoming">Coming later</span></div>
      </div>}
    {error && <p className="bec-error" role="alert">{error}</p>}
    {notice && <p className="bec-notice" role="status">{notice}</p>}
    <p className="bec-footnote">Connecting an email provider does not send anything. Sending still requires a saved proposal, current approval, reviewed PDF and explicit final confirmation.</p>
  </section>;
}
