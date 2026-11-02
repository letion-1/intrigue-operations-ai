import { NextRequest } from 'next/server';
import { actor, adminClient, jsonBody, mailError, noStore, uuidPattern } from '../_lib/common';
export async function POST(request: NextRequest) {
  try {
    const input = await jsonBody(request);
    const workspaceId = String(input.workspaceId || '');
    if (!uuidPattern.test(workspaceId)) return noStore({ error: 'Invalid workspace' }, 400);
    await actor(request, workspaceId);
    const db = adminClient();
    const { error } = await db.from('intrigue_gmail_connections').delete().eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);
    return noStore({ disconnected: true, note: 'INTRIGUE removed the stored Gmail credential. You can also revoke access in Google Account settings.' });
  } catch (e) { return mailError(e); }
}
