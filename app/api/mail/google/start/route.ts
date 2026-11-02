import { NextRequest } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { actor, adminClient, encrypt, googleConfig, jsonBody, mailError, noStore, sha, uuidPattern } from '../../_lib/common';
export async function POST(request: NextRequest) {
  try {
    const body = await jsonBody(request);
    const workspaceId = String(body.workspaceId || '');
    if (!uuidPattern.test(workspaceId)) throw new Error('Invalid company workspace');
    const { userId } = await actor(request, workspaceId);
    const conf = googleConfig();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const db = adminClient();
    const { error } = await db.from('intrigue_gmail_oauth_states').insert({
      state_hash: sha(state), workspace_id: workspaceId, actor_id: userId,
      verifier_cipher: encrypt(verifier), expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw new Error(`Unable to initialize Gmail OAuth: ${error.message}`);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', conf.id);
    url.searchParams.set('redirect_uri', conf.redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email https://www.googleapis.com/auth/gmail.send');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return noStore({ authorizationUrl: url.toString() });
  } catch (e) { return mailError(e); }
}
