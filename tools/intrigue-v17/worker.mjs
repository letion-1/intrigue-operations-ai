#!/usr/bin/env node
/** V17.2A local worker: audit receipts + approved internal quotation analysis only.
 * NEVER sends emails, books calls, or writes quotation/customer tables. */
import { pathToFileURL } from 'node:url';
import { analyzeEnquiry, selectWithOpenRouter } from './quotation-analysis.mjs';
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

function headers() { return {'apikey':serviceKey,'Authorization':`Bearer ${serviceKey}`,'Content-Type':'application/json','Accept':'application/json'}; }
export async function rpc(name, payload, fetcher = fetch) {
  const r = await fetcher(`${apiUrl}/rest/v1/rpc/${name}`, {
    method:'POST',headers:headers(),body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`Supabase RPC ${name} failed (${r.status})`);
  return r.json();
}
async function getRows(table, select, eq, limit = 100) {
  const allowed = ['enquiries','workspace_services','knowledge_entries','intrigue_v17_workflows'];
  if (!allowed.includes(table)) throw Error('Unexpected database table.');
  const params = new URLSearchParams({select,limit:String(limit)});
  for (const [field,value] of Object.entries(eq)) params.set(field,`eq.${value}`);
  const r = await fetch(`${apiUrl}/rest/v1/${table}?${params}`, {
    headers:headers(),signal:AbortSignal.timeout(15000)
  });
  if (!r.ok) throw Error(`Supabase table read failed (${table}, HTTP ${r.status})`);
  return r.json();
}
export function executeSafeAction(run) {
  if (!run || !run.id || !run.workspace_id || !run.workflow_id || !run.lease_token) {
    throw new Error('Incomplete lease.');
  }
  if (!run.approved_at) throw new Error('Run has no recorded human approval (fail closed).');
  return {kind:'audit_event',result:'processed_without_external_side_effects',workflow_id:run.workflow_id};
}

// Use the same selector in both modes; metered mode requires lease-scoped context.
const quotationSelect=(payload,context)=>selectWithOpenRouter(payload,fetch,process.env,context);
export async function executeAction(run, deps = {getRows,aiSelect:quotationSelect}) {
  if (!run || !run.id || !run.workspace_id || !run.workflow_id || !run.lease_token || !run.approved_at) {
    throw Error('Incomplete or unapproved lease (fail closed).');
  }
  const matches = await deps.getRows('intrigue_v17_workflows','id,workspace_id,action_type,trigger_type,requires_approval',{
    id:run.workflow_id,workspace_id:run.workspace_id
  },1);
  const workflow = matches?.[0];
  if (!workflow || workflow.requires_approval !== true || workflow.trigger_type !== 'manual') throw Error('Unsupported workflow definition.');
  if (workflow.action_type === 'audit_event') return executeSafeAction(run);
  if (workflow.action_type === 'quotation_draft') return analyzeEnquiry(run,deps);
  throw Error('Unsupported action type.');
}
async function tick() {
  const claimed = await rpc('intrigue_v17_claim_fair',{p_lease_seconds:120});
  if (!Array.isArray(claimed) || claimed.length===0) return false;
  const run = claimed[0];
  let success=false, result={}, error=null;
  try { result = await executeAction(run); success=true; }
  catch (e) { error=String(e?.message || 'Processing failure').slice(0,300); }
  const status=await rpc('intrigue_v17_finish',{
    p_run_id:run.id,p_lease_token:run.lease_token,p_success:success,p_result:result,p_error:error,
  });
  console.log(`[v17-worker] run=${run.id} status=${status}`);
  return true;
}
if (isMain) {
  console.log('[v17-worker] Development worker started. Approval-required; internal analysis only; no external actions.');
  do {
    try { await tick(); } catch(e) { console.error('[v17-worker]',e.message); }
    if (once || stopping) break;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  } while(!stopping);
}
