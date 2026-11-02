import { adminClient, emailPattern, MailError } from './common';

export type EmailPreferences = {
  defaultProvider: 'gmail' | 'outlook';
  replyTo: string;
  signature: string;
  revision: string;
};
const empty: EmailPreferences = { defaultProvider:'gmail', replyTo:'', signature:'', revision:'unset' };

export function validateEmailPreferences(input:unknown): Omit<EmailPreferences,'revision'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MailError('Invalid email settings.',400);
  const x=input as Record<string,unknown>;
  if (x.defaultProvider !== 'gmail' && x.defaultProvider !== 'outlook') throw new MailError('Choose Gmail or Outlook.',400);
  if (typeof x.replyTo !== 'string' || typeof x.signature !== 'string') throw new MailError('Invalid email preferences.',400);
  const replyTo=x.replyTo.trim().toLowerCase();
  const signature=x.signature.trim();
  if (replyTo && (!emailPattern.test(replyTo)||replyTo.length>254||/[\r\n\0]/.test(replyTo))) throw new MailError('Enter a valid reply-to address.',400);
  if (signature.length>1200||/\0/.test(signature)) throw new MailError('Signature must be at most 1200 characters.',400);
  return {defaultProvider:x.defaultProvider,replyTo,signature};
}

export async function loadEmailPreferences(workspaceId:string): Promise<EmailPreferences> {
  const {data,error}=await adminClient().from('intrigue_email_preferences')
    .select('default_provider,reply_to,signature,revision')
    .eq('workspace_id',workspaceId).maybeSingle();
  if (error) throw new MailError('Email preferences unavailable. Apply the V16.9 SQL migration before sending.',503);
  if (!data) return {...empty};
  if (!['gmail','outlook'].includes(data.default_provider)||typeof data.revision!=='string') throw new MailError('Stored email preferences are invalid.',503);
  const prefs={defaultProvider:data.default_provider,replyTo:data.reply_to||'',signature:data.signature||'',revision:data.revision} as EmailPreferences;
  validateEmailPreferences(prefs);
  return prefs;
}

export function assertPreferencesVersion(prefs:EmailPreferences, expected:unknown) {
  if (typeof expected!=='string'||prefs.revision!==expected) throw new MailError('Business email preferences changed since review. Refresh the send screen and review again.',409);
}

export function finalizedEmailBody(approvedBody:string,prefs:EmailPreferences) {
  const result=prefs.signature ? `${approvedBody}\n\n--\n${prefs.signature}` : approvedBody;
  if (result.length>14000) throw new MailError('Approved email and signature exceed the maximum email length.',409);
  return result;
}
