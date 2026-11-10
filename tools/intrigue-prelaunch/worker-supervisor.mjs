/**
 * INTRIGUE local worker supervisor.
 * Runs an approved-job worker repeatedly without starting overlapping copies.
 * It is NOT always-on hosting: it stops when the computer stops or sleeps.
 * Usage: node tools/intrigue-prelaunch/worker-supervisor.mjs
 * Optional: INTRIGUE_WORKER_INTERVAL_SECONDS=60 (minimum 20)
 */
import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const cwd = process.cwd();
const worker = resolve(cwd, 'tools/intrigue-v17/worker.mjs');
const env = resolve(cwd, '.env.local');
const delaySeconds = Number.parseInt(process.env.INTRIGUE_WORKER_INTERVAL_SECONDS || '60', 10);
if (!existsSync(worker)) throw new Error('Worker not found: tools/intrigue-v17/worker.mjs');
if (!Number.isInteger(delaySeconds) || delaySeconds < 20 || delaySeconds > 3600)
  throw new Error('INTRIGUE_WORKER_INTERVAL_SECONDS must be between 20 and 3600.');

// Deterministic lock per repository. Avoid two supervisors claiming the same jobs.
const lock = resolve(tmpdir(), `intrigue-worker-${createHash('sha256').update(cwd.toLowerCase()).digest('hex').slice(0,18)}.lock`);
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}
function takeLock() {
  for (let attempt=0;attempt<2;attempt++) {
    try {
      const fd=openSync(lock, 'wx', 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
      closeSync(fd);
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let oldPid = 0;
      try { oldPid = JSON.parse(readFileSync(lock, 'utf8')).pid; } catch { /* invalid lock is unsafe to assume live */ }
      if (Number.isInteger(oldPid) && oldPid > 0 && alive(oldPid))
        throw new Error(`An INTRIGUE worker supervisor is already running (PID ${oldPid}).`);
      // Stale lock, process exited.
      unlinkSync(lock);
    }
  }
  throw new Error('Could not obtain the worker lock.');
}
takeLock();
let stopping=false;
let child;
let wake;
function clean() {
  try {
    const value=JSON.parse(readFileSync(lock,'utf8'));
    if (value.pid===process.pid) unlinkSync(lock);
  } catch { /* another process owns it or already removed */ }
}
async function stop() {
  if (stopping) return;
  stopping=true;
  if (child && child.exitCode===null) child.kill('SIGTERM');
  if (wake) wake();
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
process.on('exit',clean);

function sleep(ms) {
  return new Promise(resolvePromise => {
    const timer=setTimeout(resolvePromise,ms);
    wake=()=>{clearTimeout(timer);resolvePromise();};
  }).finally(()=>{wake=undefined;});
}
function startWorker() {
  const args=[...(existsSync(env) ? ['--env-file=.env.local'] : []), worker];
  console.log(`[INTRIGUE] Starting approved-job worker at ${new Date().toISOString()}`);
  return new Promise((resolvePromise,reject) => {
    child=spawn(process.execPath,args,{cwd,env:process.env,stdio:'inherit',windowsHide:true});
    child.once('error',reject);
    child.once('exit',(code,signal)=>resolvePromise({code,signal}));
  });
}
let failures=0;
try {
  while(!stopping) {
    let result;
    try { result=await startWorker(); }
    catch (error) { console.error('[INTRIGUE] Worker launch failed:',error?.message||'unknown'); result={code:1}; }
    if (stopping) break;
    if(result.code===0) {
      failures=0;
      console.log(`[INTRIGUE] Worker batch completed; next check in ${delaySeconds}s`);
      await sleep(delaySeconds*1000);
    } else {
      failures++;
      console.error(`[INTRIGUE] Worker failed (${failures}/5), code=${result.code ?? 'signal'}`);
      if(failures>=5) { console.error('[INTRIGUE] Stopping after repeated failures. Investigate logs before restarting.'); process.exitCode=1; break; }
      await sleep(Math.min(300,15*2**(failures-1))*1000);
    }
  }
} finally {
  if (child && child.exitCode===null) child.kill('SIGTERM');
  clean();
  console.log('[INTRIGUE] Worker supervisor stopped.');
}
