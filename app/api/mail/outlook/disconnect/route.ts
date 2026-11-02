import { NextRequest } from 'next/server';
import { actor, adminClient, jsonBody, mailError, noStore, uuidPattern, MailError } from '../../_lib/common';

export async function POST(request: NextRequest) {
  try {
    const body = await jsonBody(request);
    const workspaceId = String(body.workspaceId||'');
    if (!uuidPattern.test(workspaceId)) throw new MailError('Invalid workspace.',400);
    await actor(request,workspaceId);
    const db = adminClient();
    const {error} = await db.from('intrigue_outlook_connections').delete().eq('workspace_id',workspaceId);
    if (error) throw new MailError('Unable to disconnect Outlook.',502);
    return noStore({disconnected:true,note:'Microsoft credential removed from this company. Revoke the grant in Microsoft account settings if needed.'});
  } catch(e){return mailError(e);}
}
