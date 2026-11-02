import { MailError, appOrigin, emailPattern } from './common';

export function outlookConfig() {
  const clientId = process.env.MICROSOFT_OUTLOOK_CLIENT_ID || '';
  const clientSecret = process.env.MICROSOFT_OUTLOOK_CLIENT_SECRET || '';
  // Use the common endpoint for work/school and personal Microsoft accounts.
  // The Azure app registration must be configured to permit both account types.
  if (!/^[0-9a-f-]{36}$/i.test(clientId) || !clientSecret) {
    throw new MailError('Outlook OAuth is not configured in Vercel (Microsoft client ID/secret).', 503);
  }
  return {
    clientId, clientSecret,
    redirect: `${appOrigin()}/api/mail/outlook/callback`,
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'offline_access User.Read Mail.Send',
  };
}

export async function exchangeMicrosoftToken(params: URLSearchParams): Promise<Record<string, unknown>> {
  const conf = outlookConfig();
  let response: Response;
  try {
    response = await fetch(conf.token, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: params,
    });
  } catch { throw new MailError('Microsoft token service could not be reached.', 502); }
  const data: unknown = await response.json().catch(() => null);
  // Safe OAuth diagnostics: only protocol error codes, never token payloads or PII.
  if (!response.ok) {
    const details = data && typeof data === 'object' ? data as {error?:unknown; error_codes?:unknown} : {};
    const errorType = typeof details.error === 'string' && /^[a-z_]{2,60}$/.test(details.error)
      ? details.error : 'unknown';
    const code = Array.isArray(details.error_codes) && Number.isSafeInteger(details.error_codes[0])
      ? details.error_codes[0] : null;
    console.error('[INTRIGUE_OUTLOOK_TOKEN_REJECTED]', {httpStatus:response.status, errorType, aadstsCode:code});
  }
  if (!response.ok || !data || typeof data !== 'object') {
    throw new MailError('Microsoft authorization was rejected or expired. Reconnect Outlook.', 409);
  }
  return data as Record<string, unknown>;
}

export function verifiedMicrosoftEmail(record: unknown): string {
  if (!record || typeof record !== 'object') throw new MailError('Microsoft mailbox profile is unavailable.', 409);
  const profile = record as {mail?: unknown; userPrincipalName?: unknown};
  const email = String(profile.mail || profile.userPrincipalName || '').trim().toLowerCase();
  if (!emailPattern.test(email)) throw new MailError('Microsoft did not return a valid mailbox address.', 409);
  return email;
}
