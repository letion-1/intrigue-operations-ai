'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, ShieldAlert, Trash2 } from 'lucide-react';
import './account-deletion.css';

type Blocker = { type?: string; resource?: string; count?: number; details?: string };
type Guard = { email: string; eligible: boolean; configured: boolean; blockers: Blocker[]; message?: string };

export default function AccountDeletionPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [guard, setGuard] = useState<Guard | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const authHeader = async () => {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) throw new Error('Please sign in again.');
    return { Authorization: `Bearer ${session.access_token}` };
  };

  const loadGuard = async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await authHeader();
      const response = await fetch('/api/account/delete', { method: 'GET', headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Safety check failed (${response.status}).`);
      setGuard(data as Guard);
    } catch (err) {
      setGuard(null);
      setError(err instanceof Error ? err.message : 'Unable to check account deletion eligibility.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadGuard(); /* Account data is checked upon panel mount. */ }, []);

  const deleteMyAccount = async () => {
    if (!guard || busy || !acknowledged || typed !== `DELETE ${guard.email}` || !guard.eligible) return;
    setBusy(true);
    setError('');
    try {
      const headers = await authHeader();
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: typed, acknowledged: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (Array.isArray(data?.blockers)) setGuard(current => current ? { ...current, eligible: false, blockers: data.blockers } : current);
        throw new Error(data?.error || `Account deletion failed (${response.status}).`);
      }
      if (!data?.deleted) throw new Error('Deletion was not confirmed by the server.');
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      window.location.replace('/auth/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion failed.');
    } finally { setBusy(false); }
  };

  return (
    <section className="intrigue-account-panel" aria-labelledby="intrigue-delete-account-heading">
      <div className="intrigue-account-heading">
        <ShieldAlert size={19} aria-hidden="true" />
        <h3 id="intrigue-delete-account-heading">Account security & deletion</h3>
      </div>
      <p className="intrigue-account-description">
        Log out to switch accounts. Deleting your account permanently removes your INTRIGUE sign-in, not your company's records.
        An account that owns workspaces or has protected dependencies cannot be deleted here until those are resolved.
      </p>
      {loading && <p className="intrigue-account-muted">Checking linked account records…</p>}
      {!loading && guard && <>
        <p className="intrigue-account-muted">Signed in as <strong>{guard.email}</strong></p>
        {!guard.configured && <p role="status" className="intrigue-account-warning">Server-side account deletion has not been configured. Ask the deployment administrator to set a Supabase server secret key.</p>}
        {guard.blockers.length > 0 && <div className="intrigue-account-blockers" role="status">
          <strong>Deletion blocked by linked records</strong>
          <ul>{guard.blockers.map((item, i) => <li key={i}>{item.resource || item.type || 'Protected records'}{typeof item.count === 'number' ? ` (${item.count})` : ''}{item.details ? `: ${item.details}` : ''}</li>)}</ul>
          <p>Transfer company ownership or resolve the dependencies safely. Do not use cascading SQL deletes.</p>
        </div>}
        {guard.message && <p className="intrigue-account-muted">{guard.message}</p>}
        <div className="intrigue-account-actions">
          <button type="button" onClick={() => { void loadGuard(); }} disabled={loading || busy} className="intrigue-account-secondary">Refresh safety check</button>
          <button type="button" className="intrigue-account-danger" disabled={!guard.eligible || busy} onClick={() => { setShowConfirmation(!showConfirmation); setTyped(''); setAcknowledged(false); setError(''); }}><Trash2 size={15} /> Delete my account</button>
        </div>
        {showConfirmation && guard.eligible && <div className="intrigue-account-confirmation">
          <div className="intrigue-account-heading"><AlertTriangle size={18} aria-hidden="true" /><strong>Permanent account deletion</strong></div>
          <p>Make sure you have exported any personal data you need. Deleting your sign-in cannot be undone. Business audit and legally retained records may remain.</p>
          <label className="intrigue-account-ack"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I understand this permanently removes my login and does not reset the company database.</label>
          <label className="intrigue-account-label">Type <strong>{`DELETE ${guard.email}`}</strong> to confirm
            <input type="text" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Account deletion confirmation" />
          </label>
          <button type="button" className="intrigue-account-danger" disabled={busy || !acknowledged || typed !== `DELETE ${guard.email}`} onClick={() => { void deleteMyAccount(); }}>{busy ? 'Deleting account…' : 'Permanently delete my account'}</button>
        </div>}
      </>}
      {error && <p className="intrigue-account-error" role="alert">{error}</p>}
    </section>
  );
}
