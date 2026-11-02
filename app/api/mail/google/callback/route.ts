import { NextRequest, NextResponse } from 'next/server';
import { adminClient, appOrigin, decrypt, encrypt, googleConfig, sha } from '../../_lib/common';
function redirect(result: string) {
  const url = new URL('/dashboard', appOrigin());
  url.searchParams.set('gmail', result);
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const state = params.get('state') || '';
    if (!/^[A-Za-z0-9_-]{35,100}$/.test(state)) return redirect('invalid_state');
    const db = adminClient();
    const digest = sha(state);
    // Consume the state exactly once BEFORE exchanging the authorization code.
    const { data: records, error } = await db.from('intrigue_gmail_oauth_states')
      .update({ consumed_at: new Date().toISOString() })
      .eq('state_hash', digest).is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('workspace_id,actor_id,verifier_cipher');
    if (error || !records || records.length !== 1) return redirect('expired_state');
    const stateRow = records[0];
    if (params.get('error')) return redirect('declined');
    const code = params.get('code');
    if (!code || code.length > 4096) return redirect('missing_code');
    const config = googleConfig();
    const verifier = decrypt(String(stateRow.verifier_cipher));
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.id, client_secret: config.secret,
        redirect_uri: config.redirect, grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!tokenRes.ok) return redirect('token_failed');
    const tokens: unknown = await tokenRes.json();
    const token = tokens && typeof tokens === 'object' ? tokens as { access_token?: string; refresh_token?: string; scope?: string } : null;
    if (!token?.access_token || !token.refresh_token || !String(token.scope || '').includes('https://www.googleapis.com/auth/gmail.send')) return redirect('no_refresh_token');
    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000),
    });
    if (!userInfoRes.ok) return redirect('profile_failed');
    const profile: unknown = await userInfoRes.json();
    const userInfo = profile && typeof profile === 'object' ? profile as { email?: string; email_verified?: boolean } : null;
    const email = (userInfo?.email || '').trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || userInfo?.email_verified === false) return redirect('email_unverified');
    // Recheck role at callback time; a revoked owner must not establish a connection.
    const { data: member } = await db.from('workspace_memberships')
      .select('role').eq('workspace_id', stateRow.workspace_id).eq('user_id', stateRow.actor_id).maybeSingle();
    if (!member || !['owner', 'admin'].includes(String(member.role))) return redirect('access_revoked');
    const { error: saveError } = await db.from('intrigue_gmail_connections').upsert({
      workspace_id: stateRow.workspace_id, connected_by: stateRow.actor_id,
      sender_email: email, refresh_token_cipher: encrypt(token.refresh_token),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
    if (saveError) return redirect('storage_failed');
    return redirect('connected');
  } catch { return redirect('callback_failed'); }
}
