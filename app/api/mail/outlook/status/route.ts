import { NextRequest } from 'next/server';
import { actor, adminClient, mailError, noStore, uuidPattern, MailError } from '../../_lib/common';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    await actor(request,workspaceId);
    const quoteId = request.nextUrl.searchParams.get('quotationId') || '';
    if (quoteId && !uuidPattern.test(quoteId)) throw new MailError('Invalid quotation.',400);
    const db = adminClient();
    const {data: account,error} = await db.from('intrigue_outlook_connections')
      .select('sender_email').eq('workspace_id',workspaceId).maybeSingle();
    if (error) throw new MailError('Unable to load Outlook connection.',502);
    let q = db.from('intrigue_outlook_deliveries')
      .select('id,quotation_id,recipient,status,created_at,submitted_at')
      .eq('workspace_id',workspaceId);
    if (quoteId) q = q.eq('quotation_id',quoteId);
    const {data: attempts,error: historyError} = await q.order('created_at',{ascending:false}).limit(10);
    if (historyError) throw new MailError('Unable to load Outlook activity.',502);
    // Surface cross-provider attempts so the UI does not offer misleading double sends.
    let gmail = db.from('intrigue_mail_deliveries')
      .select('id,quotation_id,status,created_at').eq('workspace_id',workspaceId);
    if (quoteId) gmail = gmail.eq('quotation_id',quoteId);
    const {data: gmailAttempts,error: gmailError} = await gmail.order('created_at',{ascending:false}).limit(10);
    if (gmailError) throw new MailError('Unable to verify cross-provider delivery status.',502);
    return noStore({connected:!!account,sender:account?.sender_email||null,
      delivery:attempts||[],gmailAttempts:gmailAttempts||[]});
  } catch(e) {return mailError(e);}
}
