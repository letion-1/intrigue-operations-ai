import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callRow } from '@/lib/intrigue-vapi-call-history';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (value: unknown, status=200) => NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const jwt = /^Bearer (\S{20,})$/.exec(authorization)?.[1];
  if (!jwt) return reply({error:'Sign in required'},401);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return reply({error:'Supabase is not configured'},503);
  const db = createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false},global:{headers:{Authorization:`Bearer ${jwt}`}}});
  const {data:identity,error:identityError} = await db.auth.getUser(jwt);
  if (identityError || !identity.user) return reply({error:'Invalid session'},401);
  let body: Record<string,unknown>;
  try { body = await request.json(); } catch { return reply({error:'Invalid JSON'},400); }
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  if (!uuid.test(workspaceId)) return reply({error:'Invalid workspace'},400);
  // Owner-only RPC returns solely the assistant mapped to this workspace.
  const {data:assistantId,error:ownerError} = await db.rpc('intrigue_v160_owner_assistant',{p_workspace_id:workspaceId});
  if (ownerError || typeof assistantId !== 'string' || !uuid.test(assistantId)) return reply({error:'No authorized Vapi connection for this company'},403);
  const privateKey = process.env.INTRIGUE_VAPI_PRIVATE_KEY;
  if (!privateKey) return reply({error:'INTRIGUE_VAPI_PRIVATE_KEY is not configured in Vercel'},503);
  const endpoint = new URL('https://api.vapi.ai/call');
  endpoint.searchParams.set('assistantId',assistantId);
  endpoint.searchParams.set('limit','100');
  let calls: unknown;
  try {
    const response = await fetch(endpoint,{headers:{Authorization:`Bearer ${privateKey}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (!response.ok) return reply({error:`Vapi call list request failed (${response.status})`},502);
    calls = await response.json();
  } catch { return reply({error:'Vapi request timed out or failed'},502); }
  if (!Array.isArray(calls)) return reply({error:'Unexpected Vapi response'},502);
  let imported=0, skipped=0;
  for (const raw of calls.slice(0,100)) {
    const c = raw && typeof raw === 'object' ? raw as Record<string,unknown> : {};
    if (c.assistantId !== assistantId || typeof c.id !== 'string' || !uuid.test(c.id)) { skipped++;continue; }
    const {data:ok,error} = await db.rpc('intrigue_v160_owner_ingest',{p_workspace_id:workspaceId,p_assistant_id:assistantId,p_record:callRow(c,false)});
    if (error || !ok) skipped++; else imported++;
  }
  return reply({imported,skipped,limit:100,transcriptsImported:false});
}
