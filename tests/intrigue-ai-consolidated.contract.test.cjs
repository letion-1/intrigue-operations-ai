'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('sql/INTRIGUE_VOICE_GATE_AND_OPERATIONS.sql');
const gate=read('app/api/integrations/vapi/call-gate/route.ts');
const admin=read('app/api/platform/ai-voice/route.ts');
const server=read('lib/intrigue-ai/voice-gate.ts');
const meter=read('lib/intrigue-ai/vapi-postcall-meter.ts');
const control=read('app/api/ai-control/route.ts');
const panel=read('app/platform/ai-usage/page.tsx');
test('voice route is private and registered for company erasure',()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/REVOKE ALL ON public\.intrigue_ai_voice_routes/);
 assert.match(sql,/private\.intrigue_v21_supported_tables/);assert.match(sql,/intrigue_v21_stop_closing_writes/);
});
test('voice admission is server-only and checks workspace freeze before reserving',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.intrigue_ai_voice_admit/);
 assert.match(sql,/intrigue_platform_workspace_open\(p_workspace\)/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/v_used \+ v_route\.reservation_seconds/);
});
test('voice admission accounts for concurrency and duplicates',()=>{
 assert.match(sql,/status='reserved'/);assert.match(sql,/status='settled'/);
 assert.match(sql,/v_existing\.status='reserved'/);assert.match(sql,/v_route\.provider_mode/);
});
test('voice gate derives company identity only from authenticated per-phone binding',()=>{
 assert.match(gate,/authorization/);assert.match(gate,/tokenDigest\(match\[1\]\)/);
 assert.match(gate,/eq\('phone_number_id',phoneId\)/);
 assert.match(gate,/eq\('token_sha256',hashed\)/);
 assert.match(gate,/p_workspace:route\.workspace_id/);
 assert.doesNotMatch(gate,/p_workspace:\s*(?:body|message|call)\./);
});
test('voice gate only admits assistant-request, no fake end reports',()=>{
 assert.match(gate,/message\.type!=='assistant-request'/);assert.match(gate,/assistantId:route\.assistant_id/);
 assert.match(gate,/voice_allowance_exhausted/);
});
test('client-owned Vapi requires connected key and verified active route',()=>{
 assert.match(control,/INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED/);
 assert.match(control,/intrigue_ai_voice_routes/);
 assert.match(control,/\.eq\('provider_mode','byok'\)/);
 assert.match(control,/\.eq\('active',true\)/);
});
test('no static assistant or unverified webhook can activate inbound gate',()=>{
 assert.match(server,/phone\.assistantId\|\|phone\.squadId/);
 assert.match(server,/pserver\.credentialId/);assert.match(server,/aserver\.credentialId/);
 assert.match(server,/assistant\.maxDurationSeconds/);assert.match(server,/getCredential\(db,workspace,'vapi'\)/);
});
test('private operator controls one-time token, not browser company session',()=>{
 assert.match(admin,/mustBeOperator\(ctx\)/);assert.match(admin,/checkOrigin\(req\)/);
 assert.match(admin,/randomBytes\(32\)/);assert.match(admin,/tokenDigest\(token\)/);
 assert.match(admin,/one_time_token:token/);
 assert.doesNotMatch(read('app/api/platform/ai-voice/route.ts').split('export async function GET')[1].split('export async function POST')[0],/token_sha256/);
});
test('post-call settlement releases reserved minutes and does not duplicate entries',()=>{
 assert.match(meter,/requestKey='vapi:'/);assert.match(meter,/intrigue_ai_settle/);
 assert.match(meter,/existing\?\.status==='settled'/);assert.match(meter,/intrigue_ai_record_voice/);
});
test('private admin UI exposes voice setup and pending reconciliation',()=>{
 assert.match(panel,/VoiceGatePanel/);
 const ui=read('app/platform/ai-usage/VoiceGatePanel.tsx');
 assert.match(ui,/oneTimeToken/);assert.match(ui,/unreconciled_over_36h/);
});
test('machine-to-machine call gate bypasses login redirects but authenticates within route',()=>{
 const proxy=read('proxy.ts');assert.match(proxy,/\/api\/integrations\/vapi\/call-gate/);
 assert.match(proxy,/request\.method === \"POST\"/);
 assert.match(gate,/authorization/);
});
test('modified TypeScript / TSX syntax parses',()=>{
 let ts;try{ts=require('typescript')}catch{ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript')}
 for(const name of [
 'lib/intrigue-ai/voice-gate.ts','lib/intrigue-ai/vapi-postcall-meter.ts',
 'app/api/integrations/vapi/call-gate/route.ts','app/api/platform/ai-voice/route.ts',
 'app/api/ai-control/route.ts','app/platform/ai-usage/page.tsx',
 'app/platform/ai-usage/VoiceGatePanel.tsx']){
  const parsed=ts.createSourceFile(name,read(name),ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.deepEqual(parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],name);
 }
});
