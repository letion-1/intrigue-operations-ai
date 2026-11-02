import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { actor, adminClient, jsonBody, mailError, MailError, noStore, uuidPattern } from '../_lib/common';
import { loadEmailPreferences, validateEmailPreferences } from '../_lib/email-preferences';

// All reads and writes require a currently authenticated workspace owner/admin.
// The service-role key never leaves the server and the table has no browser RLS access.
export async function GET(request:NextRequest) {
  try {
    const workspaceId=request.nextUrl.searchParams.get('workspaceId')||'';
    if (!uuidPattern.test(workspaceId)) throw new MailError('Invalid workspace.',400);
    await actor(request,workspaceId);
    return noStore(await loadEmailPreferences(workspaceId));
  } catch(e){return mailError(e);}
}
export async function POST(request:NextRequest) {
  try {
    const data=await jsonBody(request);
    const workspaceId=String(data.workspaceId||'');
    if (!uuidPattern.test(workspaceId)) throw new MailError('Invalid workspace.',400);
    const {userId}=await actor(request,workspaceId);
    const payload=validateEmailPreferences(data);
    const db=adminClient();
    const providerTable=payload.defaultProvider==='gmail'?'intrigue_gmail_connections':'intrigue_outlook_connections';
    const {data:connection,error:connectedError}=await db.from(providerTable).select('workspace_id').eq('workspace_id',workspaceId).maybeSingle();
    if (connectedError||!connection) throw new MailError(`Connect ${payload.defaultProvider==='gmail'?'Gmail':'Outlook'} in Integrations before setting it as the default sender.`,409);
    const {error}=await db.from('intrigue_email_preferences').upsert({
      workspace_id:workspaceId,default_provider:payload.defaultProvider,
      reply_to:payload.replyTo||null,signature:payload.signature,
      updated_by:userId,revision:randomUUID(),updated_at:new Date().toISOString(),
    },{onConflict:'workspace_id'});
    if(error) throw new MailError('Could not save company email preferences. Check the V16.9 migration.',503);
    return noStore(await loadEmailPreferences(workspaceId));
  } catch(e){return mailError(e);}
}
