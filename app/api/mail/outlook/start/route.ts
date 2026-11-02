import { randomBytes, createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { actor, adminClient, encrypt, jsonBody, mailError, noStore, sha, uuidPattern, MailError } from '../../_lib/common';
import { outlookConfig } from '../../_lib/outlook';

export async function POST(request: NextRequest) {
  try {
    const body = await jsonBody(request);
    const workspaceId = String(body.workspaceId || '');
    if (!uuidPattern.test(workspaceId)) throw new MailError('Invalid workspace.', 400);
    const {userId} = await actor(request, workspaceId);
    const config = outlookConfig();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const db = adminClient();
    const {error} = await db.from('intrigue_outlook_oauth_states').insert({
      state_hash: sha(state), workspace_id: workspaceId, actor_id: userId,
      verifier_cipher: encrypt(verifier), expires_at: new Date(Date.now()+10*60_000).toISOString(),
    });
    if (error) throw new MailError('Outlook authorization could not be initialized. Check the SQL migration.', 503);
    const url = new URL(config.authorize);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', config.redirect);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', config.scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return noStore({authorizationUrl: url.toString()});
  } catch(e) {return mailError(e);}
}
