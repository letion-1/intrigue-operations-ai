'use client';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createPlatformClient } from '@/lib/intrigue-platform-auth-client';
import '../../platform-ui.css';

export default function PrivateAdminLogin() {
  const client = useMemo(() => createPlatformClient(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function authorize(token: string) {
    const reply = await fetch('/api/platform/console', {
      method: 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    });
    return reply.ok;
  }
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.access_token && await authorize(session.access_token)) {
          window.location.replace('/platform');
          return;
        }
        if (session) await client.auth.signOut({ scope: 'local' });
      } catch { if (mounted) setError('Unable to check the administrator session.'); } finally { if (mounted) setChecking(false); }
    })();
    return () => { mounted = false; };
  }, [client]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data, error: loginError } = await client.auth.signInWithPassword({
        email: email.trim(), password,
      });
      if (loginError || !data.session?.access_token) throw new Error('Invalid administrator credentials.');
      if (!await authorize(data.session.access_token)) {
        await client.auth.signOut({ scope: 'local' });
        throw new Error('This account is not authorized for private administration.');
      }
      window.location.replace('/platform');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in unavailable.');
    } finally { setBusy(false); }
  }

  return <main className="intrigue-portal flex min-h-screen items-center justify-center bg-[#091725] px-4 py-12 text-[#f4efe4]">
    <section className="w-full max-w-md rounded-2xl border border-[#b89458]/50 bg-[#14273a] px-6 py-9 shadow-2xl sm:px-9" aria-label="Private administration sign-in">
      <div className="mb-6 flex items-center gap-4"><img src="/intrigue-mark.png" alt="INTRIGUE emblem" className="h-16 w-16 object-contain"/><span className="text-xs font-bold tracking-[.24em] text-[#d7b777]">INTRIGUE STUDIOS</span></div>
      <h1 className="text-3xl font-semibold">Private administrator login</h1>
      <p className="mb-7 mt-3 text-sm leading-6 text-[#b6c5d5]">Reserved for the INTRIGUE platform administrator. Company accounts cannot access this portal.</p>
      {checking ? <p role="status">Checking private session…</p> : <form className="space-y-5" onSubmit={submit}>
        <div><label className="mb-2 block text-sm" htmlFor="private-admin-email">Administrator email</label><input id="private-admin-email" className="ip-input w-full" autoComplete="username" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></div>
        <div><label className="mb-2 block text-sm" htmlFor="private-admin-password">Password</label><input id="private-admin-password" className="ip-input w-full" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></div>
        {error && <p role="alert" className="text-sm text-[#ffb5ae]">{error}</p>}
        <button type="submit" className="ip-button ip-primary w-full justify-center" disabled={busy}>{busy?'Signing in…':'Sign in to Admin Control Center'}</button>
      </form>}
      <p className="mt-6 text-xs text-[#b6c5d5]">No public administrator registration. Access is approved on the server.</p>
    </section>
  </main>;
}
