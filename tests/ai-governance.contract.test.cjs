'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=read('sql/INTRIGUE_AI_GOVERNANCE.sql');
const api=read('app/api/ai-control/route.ts');
const admin=read('app/api/platform/ai-control/route.ts');
const runtime=read('app/api/ai-runtime/chat/route.ts');
const server=read('lib/intrigue-ai/server.ts');
const ui=read('app/dashboard/integrations/AiConnectionsPanel.tsx');
const doc=read('docs/INTRIGUE_AI_USAGE_ACCEPTANCE.md');
test('three workspace-scoped tables registered for V21 erasure',()=>{
 for(const table of ['intrigue_ai_plans','intrigue_ai_connections','intrigue_ai_usage_ledger']){
  assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+table));
  assert.match(sql,new RegExp("\\('public\\."+table+"'\\)"));
 }
});
test('provider secrets and ledgers denied from public clients',()=>{
 assert.match(sql,/REVOKE ALL ON public\.intrigue_ai_plans,public\.intrigue_ai_connections,public\.intrigue_ai_usage_ledger FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/ALTER TABLE public\.intrigue_ai_connections ENABLE ROW LEVEL SECURITY/);
});
test('RPC reservation callable only by trusted service role',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.intrigue_ai_reserve.*FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.intrigue_ai_reserve.*TO service_role/);
});
test('budget check serialized per company and uses workspace freeze',()=>{
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/intrigue_platform_workspace_open\(p_workspace\)/);
 assert.match(sql,/text_allowance_exhausted/);assert.match(sql,/voice_allowance_exhausted/);
});
test('duplicate operations are never paid twice',()=>{
 assert.match(sql,/PRIMARY KEY \(workspace_id,request_key\)/);assert.match(sql,/duplicate.*true/);
 assert.match(runtime,/if\(reserved\?\.approved!==true\)/);
});
test('unknown provider costs remain reserved for reconciliation',()=>{
 assert.match(runtime,/reconciled=false/);assert.match(runtime,/Provider cost not yet confirmed; reservation held/);
});
test('call reconciliation scoped to company and provider call',()=>{
 assert.match(sql,/ON CONFLICT\(workspace_id,request_key\) DO NOTHING/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.intrigue_ai_record_voice/);
});
test('client API requires verified signed-in company owner',()=>{
 assert.match(api,/await platformAuth\(req\)/);assert.match(api,/requireCompanyOwner\(ctx/);
 assert.match(server,/Only the company owner can change AI provider connections/);
});
test('operator API uses private admin boundary, not client session',()=>{
 assert.match(admin,/await mustBeOperator\(ctx\)/);assert.match(admin,/intrigue_platform_workspace_open/);
});
test('provider key encrypted authenticated before storing',()=>{
 assert.match(server,/createCipheriv\('aes-256-gcm'/);assert.match(server,/getAuthTag/);
 assert.match(server,/Authorization:`Bearer \$\{raw\}`/);assert.match(server,/if\(!resp.ok\)/);
});
test('secret material not returned to browser from status endpoint',()=>{
 assert.match(server,/select\('provider,updated_at'\)/);assert.doesNotMatch(api,/secret_cipher/);
 assert.doesNotMatch(ui,/secret_cipher/);
});
test('BYOK modes refuse activation until worker and voice paths reviewed',()=>{
 assert.match(api,/INTRIGUE_AI_BYOK_ACTIVATION_ENABLED/);
 assert.match(api,/INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED/);
 assert.match(ui,/Saving a key alone does not switch billing/);
});
test('internal chat runtime requires server-only secret',()=>{
 assert.match(runtime,/INTRIGUE_AI_WORKER_TOKEN/);assert.match(runtime,/timingSafeEqual/);
 assert.match(runtime,/x-intrigue-worker-token/);
});
test('worker cannot request unapproved arbitrary model or endpoint',()=>{
 assert.match(runtime,/INTRIGUE_AI_APPROVED_MODEL/);assert.doesNotMatch(runtime,/body\.model/);
 assert.match(runtime,/https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
});
test('provider HTTP request cannot bypass reservation',()=>{
 assert.ok(runtime.indexOf("rpc('intrigue_ai_reserve'")<runtime.indexOf("fetch('https://openrouter.ai/api/v1/chat/completions'"));
});
test('client mode transitions require connection',()=>{
 assert.match(api,/Connect OpenRouter before enabling/);assert.match(api,/Connect Vapi before enabling/);
});
test('month resets aggregate without a manual cron',()=>{
 assert.match(sql,/date_trunc\('month',now\(\) AT TIME ZONE 'UTC'\)/);
 assert.match(server,/intrigue_ai_usage_summary/);
});
test('collector intentionally excludes env files',()=>{
 const collector=read('tools/intrigue-ai/collect-runtime-sources.ps1');
 assert.doesNotMatch(collector,/Copy-Item.*\.env/i);assert.match(doc,/No\.? .*?worker|Existing AI assistant/);
});

test('AI route avoids cacheComponents-incompatible runtime export',()=>{
 assert.doesNotMatch(runtime,/export\s+const\s+runtime\s*=/);
 assert.match(runtime,/export\s+const\s+maxDuration\s*=\s*60/);
});
