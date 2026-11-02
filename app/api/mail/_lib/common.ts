import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export class MailError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/;
export function mailError(error: unknown): NextResponse {
  const status = error instanceof MailError ? error.status : 500;
  const message = error instanceof MailError ? error.message : 'Mail operation failed. Check your deployment logs.';
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function sha(input: string) { return createHash('sha256').update(input).digest('hex'); }
export function tokenKey() {
  const raw = process.env.INTRIGUE_MAIL_ENCRYPTION_KEY || '';
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || !raw) throw new MailError('Email encryption key is not configured. Contact the deployment administrator.', 503);
  return key;
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), content.toString('base64url')].join('.');
}
export function decrypt(value: string): string {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new MailError('Stored email connection is invalid. Reconnect Gmail.', 409);
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
export function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !publicKey || !adminKey) throw new MailError('Supabase email-server configuration is missing.', 503);
  return { url, publicKey, adminKey };
}
export function adminClient(): SupabaseClient {
  const c = env();
  return createClient(c.url, c.adminKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
export async function actor(request: NextRequest, workspaceId: string, roles: string[] = ['owner', 'admin']) {
  if (!uuidPattern.test(workspaceId)) throw new MailError('Invalid workspace identifier.');
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!accessToken) throw new MailError('Please sign in again.', 401);
  const c = env();
  const userClient = createClient(c.url, c.publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user }, error } = await userClient.auth.getUser(accessToken);
  if (error || !user?.id) throw new MailError('Login expired. Sign in again.', 401);
  const { data: member, error: memberError } = await userClient.from('workspace_memberships')
    .select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (memberError || !member || !roles.includes(String(member.role))) throw new MailError('Workspace Owner or Admin access required.', 403);
  return { userId: user.id, userClient, role: String(member.role) };
}
export function appOrigin() {
  const raw = process.env.INTRIGUE_APP_URL || '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new MailError('INTRIGUE_APP_URL is not configured.', 503); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
    throw new MailError('INTRIGUE_APP_URL must be a trusted HTTPS origin.', 503);
  }
  return url.origin;
}
export function googleConfig() {
  const id = process.env.GOOGLE_GMAIL_CLIENT_ID || '';
  const secret = process.env.GOOGLE_GMAIL_CLIENT_SECRET || '';
  if (!id || !secret) throw new MailError('Gmail OAuth client ID/secret are missing in Vercel.', 503);
  return { id, secret, redirect: `${appOrigin()}/api/mail/google/callback` };
}
export async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > 4_500_000) throw new MailError('Request is too large.', 413);
  const body: unknown = await request.json().catch(() => null);
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new MailError('Invalid JSON body.');
  return body as Record<string, unknown>;
}
export function noStore(value: object, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
