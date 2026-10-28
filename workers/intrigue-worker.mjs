/**
 * INTRIGUE V12 staging worker: one harmless demo receipt per approved quotation.
 * Cloud: node workers/intrigue-worker.mjs
 * Local: node --env-file=.env.local workers/intrigue-worker.mjs --once
 * No customer email, phone, CRM or external side effects.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !secretKey) {
  console.error('Configuration error: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.');
  process.exit(1);
}
if (process.env.INTRIGUE_WORKER_MODE && process.env.INTRIGUE_WORKER_MODE !== 'demo') {
  console.error('This release supports INTRIGUE_WORKER_MODE=demo only.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const once = process.argv.includes('--once');
const numberInRange = (value, fallback, low, high) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= low && n <= high ? Math.floor(n) : fallback;
};
const POLL_MS = numberInRange(process.env.WORKER_POLL_INTERVAL_MS, 3000, 1000, 60000);
const ERROR_BACKOFF_MS = numberInRange(process.env.WORKER_ERROR_BACKOFF_MS, 5000, 1000, 60000);
const HEARTBEAT_MS = numberInRange(process.env.WORKER_HEARTBEAT_SECONDS, 30, 10, 3600) * 1000;
const workerId = String(process.env.RENDER_INSTANCE_ID || process.env.INTRIGUE_WORKER_NAME || `local-${process.pid}`).slice(0, 100);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
let completed = 0;
let failures = 0;
const stop = () => { stopping = true; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

async function heartbeat(status = 'running') {
  const { error } = await supabase.rpc('worker_heartbeat_intrigue_v12', {
    p_worker_id: workerId,
    p_status: status,
    p_completed: completed,
    p_failures: failures,
  });
  if (error) console.error(`Worker heartbeat failed: ${error.message}`);
}

async function processOne() {
  const { data: claim, error } = await supabase.rpc('worker_claim_intrigue_v11');
  if (error) throw new Error(`Claim failed: ${error.message}`);
  if (!claim) return false;

  const { job_id: jobId, claim_token: token, quotation_id: quotationId, attempt } = claim;
  console.log(`Claimed job ${jobId}, attempt ${attempt}`);
  try {
    const receipt = {
      kind: 'demo_quotation_receipt',
      quotation_id: quotationId,
      message: 'Approved quotation acknowledged by INTRIGUE worker (demo only)',
      processed_at: new Date().toISOString(),
    };
    const { data: finished, error: completionError } = await supabase.rpc('worker_complete_intrigue_v11', {
      p_job_id: jobId,
      p_claim_token: token,
      p_receipt: receipt,
    });
    if (completionError) throw new Error(completionError.message);
    if (finished !== true) throw new Error('Database did not acknowledge completion');
    completed++;
    console.log(`Completed job ${jobId}. No external action was taken.`);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    console.error(`Job ${jobId} failed: ${message}`);
    const { error: reportError } = await supabase.rpc('worker_fail_intrigue_v11', {
      p_job_id: jobId,
      p_claim_token: token,
      p_error: message.slice(0, 200),
    });
    if (reportError) console.error(`Unable to record failure for ${jobId}: ${reportError.message}`);
  }
  return true;
}

console.log(`INTRIGUE V12 worker started (${once ? 'one-shot' : 'continuous'}; demo-only).`);
let lastHeartbeat = 0;
try {
  do {
    try {
      if (Date.now() - lastHeartbeat > HEARTBEAT_MS || lastHeartbeat === 0) {
        await heartbeat();
        lastHeartbeat = Date.now();
      }
      const worked = await processOne();
      if (once) break;
      if (!worked) await pause(POLL_MS);
    } catch (error) {
      failures++;
      console.error(`Worker loop failure: ${error instanceof Error ? error.message : String(error)}`);
      if (once) process.exitCode = 1;
      else await pause(ERROR_BACKOFF_MS);
    }
  } while (!stopping);
} finally {
  await heartbeat('stopping').catch(() => {});
  console.log('Worker stopped.');
}
