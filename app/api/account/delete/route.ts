import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Account deletion runs only on the server. Never expose the secret key to a client bundle.
// Deletion is only for the caller's own verified Auth user ID. It never deletes a workspace.

type GuardResult = { eligible: boolean; blockers: Array<{type?:string; resource?:string; count?:number; details?:string}>; message?:string };

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function config() {
  return {
    url: (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim(),
    publicKey: (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY || ''
    ).trim(),
    secretKey: (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  };
}

async function verifiedRequest(request: NextRequest) {
  const { url, publicKey, secretKey } = config();
  if (!url || !publicKey) throw { status: 503, message: 'Supabase public configuration is incomplete.' };
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw { status: 401, message: 'Please sign in again.' };
  const client = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  // getUser verifies the access token against Supabase Auth. Never trust user_id from the request.
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user?.id) throw { status: 401, message: 'Session expired. Please sign in again.' };
  if (!user.email) throw { status: 409, message: 'This account has no verified email. Contact the administrator to delete it safely.' };
  return { client, user, url, secretKey };
}

async function preflight(client: Awaited<ReturnType<typeof verifiedRequest>>['client']): Promise<GuardResult> {
  // Fail closed if the safety migration is missing. This RPC only scans the caller's own FK references.
  const { data, error } = await client.rpc('intrigue_self_delete_preflight');
  if (error) throw { status: 503, message: `Account-deletion safety check unavailable. Run the separate SQL migration first. (${error.code || 'RPC error'})` };
  if (!data || typeof data !== 'object' || typeof data.eligible !== 'boolean' || !Array.isArray(data.blockers)) {
    throw { status: 503, message: 'Account-deletion safety check returned an unexpected response.' };
  }
  return data as GuardResult;
}

function safeError(error: unknown) {
  const maybe = error as { status?: number; message?: string };
  const status = typeof maybe?.status === 'number' && maybe.status >= 400 && maybe.status < 600 ? maybe.status : 500;
  return fail(typeof maybe?.message === 'string' ? maybe.message : 'Account deletion could not be completed.', status);
}

export async function GET(request: NextRequest) {
  try {
    const { client, user, secretKey } = await verifiedRequest(request);
    const result = await preflight(client);
    return NextResponse.json({
      email: user.email,
      eligible: result.eligible && Boolean(secretKey),
      blockers: result.blockers,
      configured: Boolean(secretKey),
      message: !secretKey ? 'Server-side Supabase secret key is not configured yet.' : result.message,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return safeError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const { client, user, url, secretKey } = await verifiedRequest(request);
    if (!secretKey) return fail('Account deletion is not configured on this deployment. Add SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY as a server-only environment variable.', 503);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid confirmation.', 400);
    const input = body as Record<string, unknown>;
    const phrase = `DELETE ${user.email}`;
    if (input.confirmation !== phrase || input.acknowledged !== true) {
      return fail(`Type the exact confirmation phrase: ${phrase}`, 400);
    }
    const guard = await preflight(client);
    if (!guard.eligible) {
      return NextResponse.json({ error: 'This account still owns or is referenced by protected data. Transfer owned workspaces or resolve the listed dependencies before deleting the login. No records were changed.', blockers: guard.blockers }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    const admin = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Admin key is server-only and user.id comes solely from getUser(token).
    const { error } = await admin.auth.admin.deleteUser(user.id, false);
    if (error) {
      // Supabase itself enforces FK constraints and storage ownership too.
      return fail('Supabase could not delete this login. A linked database record, trigger, or owned Storage file may still block deletion. No company data was deliberately deleted. Check Supabase Auth/Postgres logs and resolve the dependency.', 409);
    }
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return safeError(error); }
}
