'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CalendarClock, CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw, Unplug } from 'lucide-react';
import './calendar-provider-connections.css';

export type CalendarProvider = 'none' | 'cal' | 'calendly';
type Provider = Exclude<CalendarProvider, 'none'>;
type ConnectionStatus = { cal: boolean; calendly: boolean };

type Props = {
  workspaceId: string;
  onOpenCalendar?: () => void;
  bookingProvider: CalendarProvider;
  bookingUrl: string;
  onBookingProviderChange: (provider: CalendarProvider) => void;
  onBookingUrlChange: (value: string) => void;
  onSaveBooking: () => void;
  preferenceLoading: boolean;
  preferenceSaving: boolean;
  preferenceStatus: string;
  preferenceError: string;
};

const providers: Array<{ id: Provider; name: string; explanation: string }> = [
  { id: 'calendly', name: 'Calendly', explanation: 'Connect an existing Calendly account. Availability and booking permissions depend on the provider plan and configured scopes.' },
  { id: 'cal', name: 'Cal.com', explanation: 'Connect an existing Cal.com account. Booking-page links can also be shared independently of OAuth.' },
];

function validBookingUrl(provider: CalendarProvider, text: string): boolean {
  if (provider === 'none') return text.trim() === '';
  try {
    const url = new URL(text.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname.length < 2) return false;
    const host = provider === 'cal' ? 'cal.com' : 'calendly.com';
    return url.hostname === host || url.hostname.endsWith('.' + host);
  } catch { return false; }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to check calendar connection.';
}

export default function CalendarProviderConnections({
  workspaceId, onOpenCalendar, bookingProvider, bookingUrl,
  onBookingProviderChange, onBookingUrlChange, onSaveBooking,
  preferenceLoading, preferenceSaving, preferenceStatus, preferenceError,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ConnectionStatus>({ cal: false, calendly: false });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Ignore delayed status responses after changing company workspaces.
  const activeWorkspace = useRef(workspaceId);
  activeWorkspace.current = workspaceId;

  const refresh = useCallback(async (expectedWorkspaceId: string) => {
    const response = await fetch('/api/integrations/calendar/connections', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
    });
    const json: unknown = await response.json().catch(() => null);
    const data = json && typeof json === 'object' ? json as Record<string, unknown> : {};
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Calendar connection check failed (${response.status}).`);
    const cal = data.cal && typeof data.cal === 'object' ? data.cal as Record<string, unknown> : {};
    const calendly = data.calendly && typeof data.calendly === 'object' ? data.calendly as Record<string, unknown> : {};
    if (activeWorkspace.current === expectedWorkspaceId) {
      setConnections({ cal: cal.connected === true, calendly: calendly.connected === true });
    }
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true); setCanManage(false); setConnections({ cal: false, calendly: false }); setError(''); setNotice('');
    (async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Sign in again to manage calendar connections.');
      const { data, error: memberError } = await supabase.from('workspace_memberships')
        .select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!data) throw new Error('You do not have access to this company workspace.');
      // Existing calendar OAuth endpoints have owner-level controls. Match the existing Calendar UI.
      if (!current) return;
      const owner = data.role === 'owner';
      setCanManage(owner);
      if (owner) await refresh(workspaceId);
    })().catch(e => { if (current) setError(messageOf(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, supabase, refresh]);

  async function disconnect(provider: Provider) {
    if (!canManage || busy) return;
    const name = provider === 'cal' ? 'Cal.com' : 'Calendly';
    if (!window.confirm(`Disconnect ${name} from this company's scheduling integrations? Existing bookings will not be deleted.`)) return;
    setBusy(provider); setError(''); setNotice('');
    try {
      const response = await fetch('/api/integrations/calendar/connections', {
        method: 'DELETE', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const json: unknown = await response.json().catch(() => null);
      const data = json && typeof json === 'object' ? json as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Disconnect failed (${response.status}).`);
      await refresh(workspaceId);
      setNotice(`${name} disconnected from INTRIGUE. Revoke access separately in ${name} if required.`);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(null); }
  }

  return <section className="icpc-panel" aria-label="Calendly and Cal.com calendar integrations">
    <div className="icpc-heading">
      <div><h2><CalendarClock size={19}/> Scheduling providers</h2>
        <p>Connect Calendly or Cal.com for companies that use them. Google Calendar direct booking remains available separately in Calendar.</p></div>
      <span className="icpc-owner">Workspace Owner</span>
    </div>
    {loading ? <p className="icpc-muted"><Loader2 size={14}/> Checking calendar access…</p>
      : !canManage ? <p className="icpc-muted">Only this company's Owner can manage these calendar connections. Ask the owner to connect a provider.</p>
      : <div className="icpc-providers">
        {providers.map(provider => <div className="icpc-provider" key={provider.id}>
          <div className="icpc-provider-info"><strong>{provider.name}</strong>
            {connections[provider.id]
              ? <p className="icpc-connected"><CheckCircle2 size={14}/> Connected via existing calendar OAuth</p>
              : <p>Not connected</p>}
            <small>{provider.explanation}</small>
          </div>
          <div className="icpc-actions">
            {connections[provider.id] ? <>
              <button type="button" disabled={busy !== null} onClick={() => { setError(''); void refresh(workspaceId).catch(e => setError(messageOf(e))); }}><RefreshCw size={14}/> Refresh</button>
              <button type="button" disabled={busy !== null} onClick={() => void disconnect(provider.id)}><Unplug size={14}/> Disconnect</button>
            </> : <a className="icpc-button icpc-primary" href={`/api/integrations/calendar/start?provider=${provider.id}`}><Link2 size={14}/> Connect {provider.name}</a>}
          </div>
        </div>)}
      </div>}
    {canManage && <div className="icpc-booking">
      <h3>Optional public booking page</h3>
      <p>Clients can save a scheduling link even when OAuth is not connected. Saving a link does not give INTRIGUE permission to create meetings.</p>
      <div className="icpc-form">
        <label>Booking provider
          <select value={bookingProvider} disabled={preferenceLoading || preferenceSaving} onChange={e => onBookingProviderChange(e.target.value as CalendarProvider)}>
            <option value="none">No booking link</option><option value="calendly">Calendly</option><option value="cal">Cal.com</option>
          </select>
        </label>
        <label>Booking page HTTPS URL
          <input type="url" maxLength={400} placeholder="https://calendly.com/your-team/consultation" value={bookingUrl}
            disabled={preferenceLoading || preferenceSaving || bookingProvider === 'none'} onChange={e => onBookingUrlChange(e.target.value)}/>
        </label>
      </div>
      <div className="icpc-actions icpc-booking-actions">
        <button type="button" disabled={preferenceLoading || preferenceSaving || !validBookingUrl(bookingProvider, bookingUrl)} onClick={onSaveBooking}>
          {preferenceSaving ? 'Saving…' : 'Save booking preference'}
        </button>
        {validBookingUrl(bookingProvider, bookingUrl) && bookingProvider !== 'none' &&
          <a className="icpc-button" href={bookingUrl.trim()} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Open booking page</a>}
        {onOpenCalendar && <button type="button" onClick={onOpenCalendar}><CalendarClock size={14}/> Open Calendar settings</button>}
      </div>
      {preferenceStatus && <p className="icpc-notice" role="status">{preferenceStatus}</p>}
      {preferenceError && <p className="icpc-error" role="alert">{preferenceError}</p>}
    </div>}
    {notice && <p className="icpc-notice" role="status">{notice}</p>}
    {error && <p className="icpc-error" role="alert">{error}</p>}
    <p className="icpc-footnote">The existing Calendly/Cal.com OAuth routes remain unchanged. Provider API capabilities depend on their plan, granted permissions and current connection configuration. Google Calendar booking is not replaced by these settings.</p>
  </section>;
}
