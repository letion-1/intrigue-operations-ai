import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { actor, adminClient, decrypt, emailPattern, googleConfig, jsonBody, mailError, MailError, noStore, sha, uuidPattern } from '../_lib/common';

const MAX_PDF_BYTES = 1_500_000;
function encodedHeader(value: string) {
  if (/[\r\n\0]/.test(value)) throw new MailError('Invalid email header.');
  const symbols = Array.from(value);
  // RFC 2047 encoded words, folded at safe Unicode code-point boundaries.
  const words: string[] = [];
  for (let i = 0; i < symbols.length; i += 12) {
    words.push(`=?UTF-8?B?${Buffer.from(symbols.slice(i, i + 12).join(''), 'utf8').toString('base64')}?=`);
  }
  return words.join('\r\n ');
}
function wrap64(data: Buffer) { return data.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd(); }
function mime(sender: string, recipient: string, subject: string, body: string, file: Buffer) {
  const boundary = `intrigue_${sha(file.toString('base64')).slice(0, 28)}`;
  const lines = [
    `From: <${sender}>`, `To: <${recipient}>`, `Subject: ${encodedHeader(subject)}`,
    'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    wrap64(Buffer.from(body, 'utf8')), '',
    `--${boundary}`, 'Content-Type: application/pdf; name="approved-proposal.pdf"',
    'Content-Disposition: attachment; filename="approved-proposal.pdf"',
    'Content-Transfer-Encoding: base64', '', wrap64(file), '', `--${boundary}--`, '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}
export async function POST(request: NextRequest) {
  let deliveryId: string | null = null;
  let attemptedGmail = false;
  try {
    const input = await jsonBody(request);
    const workspaceId = String(input.workspaceId || '');
    const quotationId = String(input.quotationId || '');
    if (!uuidPattern.test(workspaceId) || !uuidPattern.test(quotationId)) throw new MailError('Invalid workspace or quotation.');
    if (input.confirmation !== 'SEND APPROVED PROPOSAL') throw new MailError('Explicit send confirmation is required.');
    const base64 = input.pdfBase64;
    if (typeof base64 !== 'string' || base64.length > 2_100_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new MailError('Attach the reviewed PDF (maximum 1.5 MB).');
    const pdf = Buffer.from(base64, 'base64');
    if (pdf.length < 100 || pdf.length > MAX_PDF_BYTES || !pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-') || !pdf.subarray(-4096).toString('latin1').includes('%%EOF')) {
      throw new MailError('The attachment is not a valid-looking PDF or exceeds 1.5 MB.');
    }
    const { userClient } = await actor(request, workspaceId);
    const { data: preview, error: previewError } = await userClient.rpc('intrigue_proposal_email_preview', {
      p_workspace_id: workspaceId, p_quotation_id: quotationId,
    });
    if (previewError || !preview || typeof preview !== 'object') throw new MailError(previewError?.message || 'Approval is missing or outdated.', 409);
    const proposal = preview as { recipient?: string; subject?: string; body?: string; sent?: boolean };
    const recipient = String(proposal.recipient || '').trim().toLowerCase();
    if (!emailPattern.test(recipient) || /\.(example|test|invalid)$/i.test(recipient.split('@')[1] || '')) throw new MailError('Cannot send to a fictional or invalid email address.', 400);
    const subject = String(proposal.subject || '').trim();
    const body = String(proposal.body || '');
    if (!subject || subject.length > 180 || !body || body.length > 12_000 || /[\r\n]/.test(subject)) throw new MailError('Invalid approved email content.', 409);
    const db = adminClient();
    const { data: account, error: accountError } = await db.from('intrigue_gmail_connections')
      .select('sender_email,refresh_token_cipher').eq('workspace_id', workspaceId).maybeSingle();
    if (accountError || !account) throw new MailError('Connect Gmail for this company before sending.', 409);
    const config = googleConfig();
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.id, client_secret: config.secret,
        refresh_token: decrypt(account.refresh_token_cipher), grant_type: 'refresh_token' }),
    });
    if (!tokenResponse.ok) throw new MailError('Google Gmail authorization has expired or was revoked. Reconnect Gmail.', 409);
    const tokenValue: unknown = await tokenResponse.json();
    const accessToken = tokenValue && typeof tokenValue === 'object' ? String((tokenValue as { access_token?: string }).access_token || '') : '';
    if (!accessToken) throw new MailError('Google did not return a usable access token.', 502);
    // Exactly one server-side claim for an approved fingerprint, even if the browser double-clicks.
    // This function checks current approval, sender role and recipient inside one DB transaction.
    const { data: claim, error: claimError } = await userClient.rpc('intrigue_gmail_claim_delivery', {
      p_workspace_id: workspaceId, p_quotation_id: quotationId,
      p_pdf_sha256: createHash('sha256').update(pdf).digest('hex'),
    });
    if (claimError || !claim || typeof claim !== 'object') throw new MailError(claimError?.message || 'Could not reserve the approved delivery.', 409);
    deliveryId = String((claim as { delivery_id?: string }).delivery_id || '');
    if (!uuidPattern.test(deliveryId)) throw new MailError('Delivery reservation failed.', 502);
    // Approval/recipient are revalidated immediately before the actual provider call.
    const { data: verified, error: verifiedError } = await userClient.rpc('intrigue_proposal_email_preview', {
      p_workspace_id: workspaceId, p_quotation_id: quotationId,
    });
    if (verifiedError || !verified || verified.recipient !== recipient || verified.subject !== subject || verified.body !== body) {
      await db.from('intrigue_mail_deliveries').update({ status: 'failed', error_code: 'approval_changed' }).eq('id', deliveryId);
      throw new MailError('Approval changed during preparation. Do not send; request a new approval.', 409);
    }
    const raw = mime(String(account.sender_email), recipient, subject, body, pdf);
    attemptedGmail = true;
    let response: Response;
    try {
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
    } catch {
      // A network timeout may occur AFTER Gmail accepted the request. Never auto-retry.
      await db.from('intrigue_mail_deliveries').update({ status: 'uncertain', error_code: 'network_unknown' }).eq('id', deliveryId);
      throw new MailError('Gmail response was lost. The message MAY have been submitted. Check Gmail Sent before attempting any manual recovery.', 502);
    }
    if (!response.ok) {
      await db.from('intrigue_mail_deliveries').update({ status: 'failed', error_code: `gmail_http_${response.status}` }).eq('id', deliveryId);
      throw new MailError(`Gmail rejected the message (HTTP ${response.status}). No submission confirmed.`, 502);
    }
    const providerMessage: unknown = await response.json().catch(() => null);
    const gmailId = providerMessage && typeof providerMessage === 'object'
      ? String((providerMessage as { id?: string }).id || '') : '';
    if (!gmailId || gmailId.length > 160) {
      await db.from('intrigue_mail_deliveries').update({ status: 'uncertain', error_code: 'no_provider_id' }).eq('id', deliveryId);
      throw new MailError('Gmail responded without a message ID. Check Gmail Sent; do not resend automatically.', 502);
    }
    const { error: saveError } = await db.from('intrigue_mail_deliveries').update({
      status: 'submitted', gmail_message_id: gmailId, submitted_at: new Date().toISOString(), error_code: null,
    }).eq('id', deliveryId).eq('status', 'sending');
    if (saveError) return noStore({ submitted: true, warning: 'Gmail accepted the message, but INTRIGUE could not save its submission status. Check Gmail Sent.', gmailMessageId: gmailId });
    return noStore({ submitted: true, deliveryId, gmailMessageId: gmailId,
      message: 'Gmail accepted the message with its PDF attachment. Inbox delivery has not been verified.' });
  } catch (e) {
    // The reserved record deliberately remains for manual review when the provider state is uncertain.
    if (attemptedGmail && !(e instanceof MailError)) {
      return mailError(new MailError('Provider response uncertain. Check Gmail Sent; do not retry this proposal automatically.', 502));
    }
    return mailError(e);
  }
}
