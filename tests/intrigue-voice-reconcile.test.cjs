const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {stripTypeScriptTypes} = require('node:module');
const source = path.resolve(__dirname, '../lib/intrigue-ai/vapi-reconcile-validation.ts');
let imported;
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const expected = {callId:id,phoneNumberId:a,assistantId:b,reservedSeconds:600};
const ended = {id,phoneNumberId:a,assistantId:b,type:'inboundPhoneCall',status:'ended',
  startedAt:'2026-11-12T00:39:47.820Z',endedAt:'2026-11-12T00:40:26.246Z',cost:0.0719};
async function validator() {
  if(!imported) {
    const input=fs.readFileSync(source,'utf8');
    const js=typeof stripTypeScriptTypes==='function'
      ? stripTypeScriptTypes(input,{mode:'strip'})
      : require('typescript').transpileModule(input,{compilerOptions:{module:99,target:9}}).outputText;
    imported=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(js));
  }
  return imported.validateCompletedVapiCall;
}

test('Vapi ended call is rounded up and cost preserved', async()=>{
  const result=(await validator())(ended,expected,Date.parse('2026-11-12T12:00:00Z'));
  assert.equal(result.actualSeconds,39);
  assert.equal(result.costUsd,0.0719);
  assert.equal(result.exceededReservation,false);
});
test('wrong company phone fails closed',async()=>{
  const v=await validator();assert.throws(()=>v({...ended,phoneNumberId:'11111111-1111-4111-8111-111111111112'},expected));
});
test('wrong assistant fails closed',async()=>{
  const v=await validator();assert.throws(()=>v({...ended,assistantId:'22222222-2222-4222-8222-222222222223'},expected));
});
test('unfinished and outbound calls never settle',async()=>{
  const v=await validator();assert.throws(()=>v({...ended,status:'in-progress'},expected));
  assert.throws(()=>v({...ended,type:'outboundPhoneCall'},expected));
});
test('missing cost cannot be interpreted as zero',async()=>{
  const v=await validator();const c={...ended};delete c.cost;assert.throws(()=>v(c,expected));
});
test('call over reserved maximum requires manual investigation',async()=>{
  const v=await validator();const result=v(ended,{...expected,reservedSeconds:60},Date.parse('2026-11-12T12:00:00Z'));
  assert.equal(result.exceededReservation,false);
  const long={...ended,endedAt:'2026-11-12T00:42:26.246Z'};
  assert.equal(v(long,{...expected,reservedSeconds:60},Date.parse('2026-11-12T12:00:00Z')).exceededReservation,true);
});
test('operator route enforces workspace, provider GET and explicit confirmation',()=>{
  const p=fs.readFileSync(path.resolve(__dirname,'../app/api/platform/voice-reconcile/route.ts'),'utf8');
  for(const phrase of ['mustBeOperator(ctx)','checkOrigin(req)','voiceAccountKey','validateCompletedVapiCall','confirm_call_id','INTRIGUE_VOICE_OPERATOR_RECONCILE_ENABLED','intrigue_ai_settle']) assert.ok(p.includes(phrase),phrase);
});
