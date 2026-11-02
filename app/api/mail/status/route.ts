import { NextRequest } from 'next/server';
import { actor, adminClient, mailError, noStore, uuidPattern } from '../_lib/common';
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') || '';
    await actor(request, workspaceId);
    const quoteId = request.nextUrl.searchParams.get('quotationId') || '';
    if (quoteId && !uuidPattern.test(quoteId)) return noStore({ error: 'Invalid quotation' }, 400);
    const db = adminClient();
    const { data, error } = await db.from('intrigue_gmail_connections')
      .select('sender_email,updated_at').eq('workspace_id', workspaceId).maybeSingle();
    if (error) throw new Error(error.message);
    let deliveries = db.from('intrigue_mail_deliveries')
      .select('id,quotation_id,recipient,status,submitted_at,created_at')
      .eq('workspace_id', workspaceId);
    if (quoteId) deliveries = deliveries.eq('quotation_id', quoteId);
    const { data: delivery, error: deliveryError } = await deliveries.order('created_at', { ascending: false }).limit(10);
    if (deliveryError) throw new Error(deliveryError.message);
    return noStore({ connected: !!data, sender: data?.sender_email || null, delivery: delivery || [] });
  } catch (e) { return mailError(e); }
}
