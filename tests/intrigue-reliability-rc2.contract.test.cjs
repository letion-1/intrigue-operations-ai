const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=process.cwd();
const read=p=>fs.readFileSync(path.join(repo,p),'utf8');
const webhook=read('app/api/integrations/vapi/webhook/route.ts');
const settlement=read('lib/intrigue-ai/vapi-auto-finalize.ts');
test('webhook remains authenticated through its database RPC',()=>{
 assert.match(webhook,/intrigue_vapi_inbound/); assert.match(webhook,/Invalid webhook credential or assistant/);
});
test('webhook tool calls still support Google and Calendly',()=>{
 for (const n of ['google_book_appointment','google_check_availability','book_appointment','check_availability']) assert.ok(webhook.includes(n));
});
test('only authenticated end reports can attempt automatic finalization',()=>{
 assert.match(webhook,/eventType === 'end-of-call-report' && uuid\.test\(callId\)/);
 assert.match(webhook,/finalizeAdmittedVapiCall\(\{authorization:data,callId,assistantId\}\)/);
});
test('finalization cannot use webhook-reported costs',()=>{
 assert.doesNotMatch(settlement,/message\.cost|call\.cost/);
 assert.match(settlement,/validateCompletedVapiCall\(call/);
});
test('no fabricated workspace or cross-tenant settlement',()=>{
 assert.match(settlement,/auth\.workspace_id/);
 assert.match(settlement,/auth\.authorized !== true/);
 assert.match(settlement,/\.eq\('workspace_id', workspace\)/);
 assert.match(settlement,/\.eq\('phone_number_id', phoneId\)/);
});
test('no automatic excess-duration or failed-call settlement',()=>{
 assert.match(settlement,/evidence\.exceededReservation/);
 assert.match(settlement,/ledger\.status !== 'reserved'/);
});
test('live voice mode is opt-in and preserves manual fallback',()=>{
 assert.match(settlement,/INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED/);
 assert.match(webhook,/recordVapiCall\(\{authorization:data,call,message\}\)/);
});
test('telemetry logs no content, tokens or booking arguments',()=>{
 assert.match(webhook,/\[VAPI_TOOL_OUTCOMES\]/);
 assert.doesNotMatch(webhook,/console\.(log|info|warn)\([^\n]*arguments/);
});
