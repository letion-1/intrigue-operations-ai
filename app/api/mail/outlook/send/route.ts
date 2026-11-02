import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { approvedPdf } from '../../_lib/approved-pdf';
import { actor, adminClient, decrypt, encrypt, emailPattern, jsonBody, mailError, MailError, noStore, uuidPattern } from '../../_lib/common';
import { exchangeMicrosoftToken, outlookConfig } from '../../_lib/outlook';

export async function POST(request: NextRequest) {
  let deliveryId: string | null = null;
  try {
    const input = await jsonBody(request);
    const workspaceId = String(input.workspaceId||'');
    const quotationId = String(input.quotationId||'');
    if (!uuidPattern.test(workspaceId)||!uuidPattern.test(quotationId)) throw new MailError('Invalid workspace or quotation.',400);
    if (input.confirmation !== 'SEND APPROVED PROPOSAL') throw new MailError('Explicit confirmation is required.',400);
    const wantedHash = String(input.previewSnapshotHash||'');
    if (!/^[a-f0-9]{64}$/.test(wantedHash)) throw new MailError('Preview and review the current approved PDF before sending.',409);
    const {userClient} = await actor(request,workspaceId);
    const rendered = await approvedPdf(request,workspaceId,quotationId);
    if (rendered.snapshotHash!==wantedHash) throw new MailError('Approved PDF changed since your review. Preview again.',409);
    if (rendered.pdf.length < 200 || rendered.pdf.length > 1_500_000) throw new MailError('Generated PDF exceeds 1.5 MB.',409);
    const {data: emailPreview,error: previewError} = await userClient.rpc('intrigue_proposal_email_preview',{
      p_workspace_id:workspaceId,p_quotation_id:quotationId,
    });
    if (previewError || !emailPreview) throw new MailError(previewError?.message||'Approval missing or outdated.',409);
    const recipient = String(emailPreview.recipient||'').trim().toLowerCase();
    const subject = String(emailPreview.subject||'').trim();
    const body = String(emailPreview.body||'');
    if (!emailPattern.test(recipient)||/\.(example|test|invalid)$/i.test(recipient.split('@')[1]||'')) throw new MailError('Fictional or invalid recipients cannot be emailed.',400);
    if (subject.length<2||subject.length>180||/[\r\n\0]/.test(subject)||body.length<2||body.length>12000) throw new MailError('Invalid approved email content.',409);
    const db = adminClient();
    const {data: account,error: accountError} = await db.from('intrigue_outlook_connections')
      .select('sender_email,refresh_token_cipher').eq('workspace_id',workspaceId).maybeSingle();
    if (accountError||!account) throw new MailError('Connect Outlook for this company in Integrations.',409);
    const config=outlookConfig();
    const tokens=await exchangeMicrosoftToken(new URLSearchParams({
      client_id:config.clientId,client_secret:config.clientSecret,
      refresh_token:decrypt(account.refresh_token_cipher),grant_type:'refresh_token',
      scope:config.scopes,
    }));
    if (typeof tokens.access_token!=='string'||!tokens.access_token) throw new MailError('Outlook token refresh did not provide an access token.',409);
    if (typeof tokens.refresh_token==='string' && tokens.refresh_token) {
      const {error: rotateError}=await db.from('intrigue_outlook_connections')
        .update({refresh_token_cipher:encrypt(tokens.refresh_token),updated_at:new Date().toISOString()})
        .eq('workspace_id',workspaceId).eq('refresh_token_cipher',account.refresh_token_cipher);
      // Token rotation must not risk sending from an account that INTRIGUE can no longer refresh.
      if (rotateError) throw new MailError('Unable to store rotated Microsoft token. Sending stopped.',502);
    }
    const {data: claim,error: claimError}=await userClient.rpc('intrigue_outlook_claim_delivery',{
      p_workspace_id:workspaceId,p_quotation_id:quotationId,
      p_pdf_sha256:createHash('sha256').update(rendered.pdf).digest('hex'),
    });
    if (claimError||!claim) throw new MailError(claimError?.message||'Already attempted or unable to reserve delivery.',409);
    deliveryId=String(claim.delivery_id||'');
    if (!uuidPattern.test(deliveryId)) throw new MailError('Delivery reservation returned invalid ID.',502);

    // Re-check all approved fields against the live database after the reservation.
    const {data: latest,error: latestError}=await userClient.rpc('intrigue_proposal_email_preview',{
      p_workspace_id:workspaceId,p_quotation_id:quotationId,
    });
    let finalPdfMatches=false;
    try {const check=await approvedPdf(request,workspaceId,quotationId);finalPdfMatches=check.snapshotHash===wantedHash;}
    catch {finalPdfMatches=false;}
    if (latestError||!latest||latest.recipient!==recipient||latest.subject!==subject||latest.body!==body||!finalPdfMatches) {
      await db.from('intrigue_outlook_deliveries').update({status:'failed',error_code:'approval_or_pdf_changed'}).eq('id',deliveryId);
      throw new MailError('Proposal changed before sending. Delivery stopped; request a new approval if needed.',409);
    }
    const graphMessage = {
      message: {
        subject,
        body: {contentType:'Text',content:body},
        toRecipients:[{emailAddress:{address:recipient}}],
        attachments:[{'@odata.type':'#microsoft.graph.fileAttachment',
          name:'approved-proposal.pdf',contentType:'application/pdf',
          contentBytes:rendered.pdf.toString('base64')}],
      },
      saveToSentItems:true,
    };
    let response:Response;
    try {
      response=await fetch('https://graph.microsoft.com/v1.0/me/sendMail',{
        method:'POST',signal:AbortSignal.timeout(20000),
        headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json'},
        body:JSON.stringify(graphMessage),
      });
    } catch {
      // Graph may have accepted before timeout. Never blindly retry.
      await db.from('intrigue_outlook_deliveries').update({status:'uncertain',error_code:'network_unknown'}).eq('id',deliveryId);
      throw new MailError('Outlook response lost. Check Sent Items before any manual recovery. Automatic retry is blocked.',502);
    }
    if (response.status!==202) {
      await db.from('intrigue_outlook_deliveries').update({status:'failed',error_code:`graph_http_${response.status}`}).eq('id',deliveryId);
      throw new MailError(`Microsoft Graph rejected the message (HTTP ${response.status}). No submission confirmed.`,502);
    }
    // Microsoft Graph returns 202 without a message ID. Never fabricate one.
    const requestId=(response.headers.get('request-id')||'').slice(0,160)||null;
    const {error: saveError}=await db.from('intrigue_outlook_deliveries').update({
      status:'submitted',graph_request_id:requestId,error_code:null,
      submitted_at:new Date().toISOString(),
    }).eq('id',deliveryId);
    if (saveError) throw new MailError('Graph accepted the message, but the log could not be updated. Do not resend; verify Sent Items.',502);
    return noStore({submitted:true,deliveryId,provider:'outlook',
      warning:'Microsoft Graph accepted the message (202). Inbox delivery has NOT been confirmed.'});
  } catch(e) {return mailError(e);}
}
