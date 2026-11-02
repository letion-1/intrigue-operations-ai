import { NextRequest, NextResponse } from 'next/server';
import { adminClient, appOrigin, decrypt, encrypt, sha } from '../../_lib/common';
import { exchangeMicrosoftToken, outlookConfig, verifiedMicrosoftEmail } from '../../_lib/outlook';

function back(result: string, microsoftError = '', microsoftDescription = '') {
  const url = new URL('/dashboard', appOrigin());
  // Keep OAuth outcomes visible in Integrations, rather than silently opening Overview.
  url.searchParams.set('integration', 'outlook');
  url.searchParams.set('outlook', result);
  // Allowlisted identifiers only. Never redirect Microsoft error_description, tokens or PII.
  if (result === 'declined') {
    const kind = /^[a-z_]{2,50}$/.test(microsoftError) ? microsoftError : 'authorization_error';
    url.searchParams.set('outlook_error', kind);
    const code = microsoftDescription.match(/\bAADSTS\d{5,7}\b/i)?.[0]?.toUpperCase();
    if (code) url.searchParams.set('outlook_code', code);
  }
  return NextResponse.redirect(url, {headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams;
    const state = query.get('state') || '';
    if (!/^[A-Za-z0-9_-]{35,100}$/.test(state)) return back('invalid_state');
    const db = adminClient();
    // Consume PKCE state exactly once, before token exchange. State binds actor/workspace.
    const {data: records, error} = await db.from('intrigue_outlook_oauth_states')
      .update({consumed_at: new Date().toISOString()})
      .eq('state_hash',sha(state)).is('consumed_at',null)
      .gt('expires_at',new Date().toISOString())
      .select('workspace_id,actor_id,verifier_cipher');
    if (error || records?.length !== 1) return back('expired_state');
    const row = records[0];
    if (query.get('error')) return back('declined', query.get('error') || '', query.get('error_description') || '');
    const code = query.get('code');
    if (!code || code.length > 4096) return back('missing_code');
    const config = outlookConfig();
    const token = await exchangeMicrosoftToken(new URLSearchParams({
      client_id:config.clientId,client_secret:config.clientSecret,code,
      redirect_uri:config.redirect,grant_type:'authorization_code',
      code_verifier:decrypt(String(row.verifier_cipher)),scope:config.scopes,
    }));
    if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || !token.refresh_token) return back('no_refresh_token');
    // Verify the delegated grants actually include Mail.Send; avoid saving unusable credentials.
    if (typeof token.scope !== 'string' || !token.scope.toLowerCase().split(/\s+/).includes('mail.send')) return back('missing_scope');
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',{
      headers:{Authorization:`Bearer ${token.access_token}`}, signal:AbortSignal.timeout(10000),
    });
    if (!profileRes.ok) return back('profile_failed');
    const profile: unknown = await profileRes.json();
    const sender = verifiedMicrosoftEmail(profile);
    // Permission could have been revoked while user was authorizing Microsoft.
    const {data: membership} = await db.from('workspace_memberships')
      .select('role').eq('workspace_id',row.workspace_id).eq('user_id',row.actor_id).maybeSingle();
    if (!membership || !['owner','admin'].includes(String(membership.role))) return back('access_revoked');
    const {error: saveError} = await db.from('intrigue_outlook_connections').upsert({
      workspace_id:row.workspace_id,connected_by:row.actor_id,sender_email:sender,
      refresh_token_cipher:encrypt(token.refresh_token),updated_at:new Date().toISOString(),
    },{onConflict:'workspace_id'});
    if (saveError) return back('storage_failed');
    return back('connected');
  } catch { return back('callback_failed'); }
}
