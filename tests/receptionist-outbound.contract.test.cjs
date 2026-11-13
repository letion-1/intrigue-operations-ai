const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.cwd();
const read=x=>fs.readFileSync(`${base}/${x}`,'utf8');
const route='app/api/receptionist/outbound/route.ts',api=read(route),panel=read('app/dashboard/ai-receptionist/ReceptionistPanel.tsx');
test('server outbound is off by default',()=>{assert.match(api,/INTRIGUE_VAPI_OUTBOUND_ENABLED==='true'/);assert.match(api,/INTRIGUE_VAPI_OUTBOUND_PILOT_WORKSPACES/);});
test('outbound is owner-only and same-origin',()=>{assert.match(api,/requireCompanyOwner/);assert.match(api,/checkOrigin\(req\)/);});
test('only one provider call request; verified route and Twilio',()=>{assert.equal((api.match(/fetch\('https:\/\/api\.vapi\.ai\/call'/g)||[]).length,1);assert.match(api,/verified_at/);assert.match(api,/twilio/);});
test('per-call consent and purpose checks',()=>{assert.match(api,/consent_attested/);assert.match(api,/consent_reference/);assert.match(api,/requested_callback/);assert.match(api,/confirmation!==`CALL \$\{dest\}`/);});
test('usage reserved before contacting provider',()=>{assert.ok(api.indexOf("rpc('intrigue_ai_reserve'") < api.indexOf("fetch('https://api.vapi.ai/call'"));});
test('uncertain outcome preserves reservation',()=>{assert.match(api,/status:'review_required'/);assert.match(api,/Do not retry/);});
test('provider-verified reconciliation checks call routing and cost',()=>{const evidence=read('lib/intrigue-outbound-evidence.ts');assert.match(evidence,/outboundPhoneCall/);assert.match(evidence,/call\.cost/);assert.match(evidence,/expected\.destination/);});
test('outbound webhook avoids duplicate legacy billing',()=>{const webhook=read('app/api/integrations/vapi/webhook/route.ts');assert.match(webhook,/reconcileOutboundWebhook/);assert.match(webhook,/!outbound\.found && asStr\(call\.type\)!=='outboundPhoneCall'/);});
test('summary recovery never imports transcripts',()=>{const summaries=read('app/api/receptionist/summaries/route.ts');assert.match(summaries,/callRow\(call,false\)/);assert.match(summaries,/\.update\(\{summary:normalized\.summary\}\)/);});
test('dial pad and summary button are integrated',()=>{assert.match(panel,/OutboundDialPanel workspaceId=/);assert.match(panel,/SummaryRecoveryButton workspaceId=/);});
test('private outbound table protects cross-workspace data',()=>{const sql=read('sql/INTRIGUE_RECEPTIONIST_OUTBOUND_PILOT.sql');assert.match(sql,/REVOKE ALL .* FROM PUBLIC,anon,authenticated/);assert.match(sql,/ROW LEVEL SECURITY/);assert.match(sql,/UNIQUE INDEX/);});

const ts=require('typescript'),Module=require('node:module'),path=require('node:path');
const evidenceFile=path.join(base,'lib/intrigue-outbound-evidence.ts');
function pureEvidence(){const m=new Module(evidenceFile,module);const code=ts.transpileModule(read('lib/intrigue-outbound-evidence.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;m._compile(code,evidenceFile);return m.exports;}
const valid={
 id:'4cc12bc8-40e1-4c39-b2c8-cfbf67c864d7',type:'outboundPhoneCall',status:'ended',
 phoneNumberId:'f7e3286f-b6c2-4a30-b363-0d628603c531',
 assistantId:'69d66b3d-b2c8-442c-95bb-1b1d86e636e5',
 customer:{number:'+491711234567'},
 startedAt:'2026-11-13T13:00:00.000Z',endedAt:'2026-11-13T13:01:00.000Z',cost:0.12,
};
const expected={callId:valid.id,phoneId:valid.phoneNumberId,assistantId:valid.assistantId,destination:valid.customer.number,reservedSeconds:600};
test('evidence: legitimate completed outbound matches identity and cost',()=>{const proof=pureEvidence().validateOutboundEvidence(valid,expected,Date.parse('2026-11-13T15:00:00Z'));assert.equal(proof.actualSeconds,60);assert.equal(proof.costUsd,0.12);assert.equal(proof.exceededReservation,false);});
test('evidence: reject different phone, assistant, recipient or wrong direction',()=>{const {validateOutboundEvidence}=pureEvidence();for(const bad of [{...valid,phoneNumberId:'e08ee3a8-3db1-4e7f-a5c7-e10229323277'},{...valid,assistantId:'e08ee3a8-3db1-4e7f-a5c7-e10229323277'},{...valid,customer:{number:'+491711111111'}},{...valid,type:'inboundPhoneCall'}])assert.throws(()=>validateOutboundEvidence(bad,expected,Date.parse('2026-11-13T15:00:00Z')));});
test('evidence: never infer zero cost from missing provider evidence',()=>assert.throws(()=>pureEvidence().validateOutboundEvidence({...valid,cost:null},expected,Date.parse('2026-11-13T15:00:00Z'))));
test('destination allowlist is E.164 and defaults can restrict country',()=>{const {allowedDestination}=pureEvidence();assert.equal(allowedDestination('+491711234567',['+49']),true);assert.equal(allowedDestination('+14155550123',['+49']),false);assert.equal(allowedDestination('0171 1234567',['+49']),false);});
