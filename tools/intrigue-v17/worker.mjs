#!/usr/bin/env node
/** V17.1A safe local worker. NO external email, CRM, calendar or telephony actions. */
import { pathToFileURL } from 'node:url';
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const apiUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const once = process.argv.includes('--once');
const pollMs = Number(process.env.INTRIGUE_V17_POLL_MS || 10000);
if (isMain && (!apiUrl || !serviceKey || !/^https:\/\//.test(apiUrl))) {
  console.error('Missing HTTPS SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never place service keys in NEXT_PUBLIC_* vars.');
  process.exit(1);
}
if (isMain && (!Number.isInteger(pollMs) || pollMs < 3000 || pollMs > 300000)) {
  console.error('INTRIGUE_V17_POLL_MS must be between 3000 and 300000.');
  process.exit(1);
}
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

export async function rpc(name, payload, fetcher = fetch) {
  const r = await fetcher(`${apiUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`,
               'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) {
    // Intentionally exclude provider response body to avoid logging sensitive values.
    throw new Error(`Supabase RPC ${name} failed (${r.status})`);
  }
  return r.json();
}

export function executeSafeAction(run) {
  // V17.1A only supports internal audit-only actions, and never processes arbitrary URLs.
  if (!run || !run.id || !run.workspace_id || !run.workflow_id || !run.lease_token) {
    throw new Error('Incomplete lease.');
  }
  if (!run.approved_at) {
    // A workflow configured as requires_approval=false is handled by its workflow
    // definition; run stores no copied policy in this version. Therefore fail closed.
    throw new Error('Run has no recorded human approval (fail closed).');
  }
  return { kind: 'audit_event', result: 'processed_without_external_side_effects',
           workflow_id: run.workflow_id };
}

async function tick() {
  const claimed = await rpc('intrigue_v17_claim', { p_lease_seconds: 120 });
  if (!Array.isArray(claimed) || claimed.length === 0) return false;
  const run = claimed[0];
  let success = false; let result = {}; let error = null;
  try {
    result = executeSafeAction(run);
    success = true;
  } catch (e) {
    error = String(e?.message || 'Processing failure').slice(0, 300);
  }
  const status = await rpc('intrigue_v17_finish', {
    p_run_id: run.id, p_lease_token: run.lease_token,
    p_success: success, p_result: result, p_error: error
  });
  console.log(`[v17-worker] run=${run.id} status=${status}`);
  return true;
}

if (isMain) {
  console.log('[v17-worker] Development worker started. Audit-only, approval-required, no external actions.');
  do {
    try { await tick(); } catch (e) { console.error('[v17-worker]', e.message); }
    if (once || stopping) break;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  } while (!stopping);
}
