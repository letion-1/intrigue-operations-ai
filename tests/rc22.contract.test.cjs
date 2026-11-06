const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const route='app/api/account/lifecycle/route.ts';
const panel='app/dashboard/account/AccountDeletionPanel.tsx';
const migration='sql/INTRIGUE_SPRINT1_RC22_PRIVACY_SAFETY.sql';
const id='33333333-3333-4333-8333-333333333333';
function routeHarness(){
  const calls=[];
  const db={rpc:async (name,args)=>{
    calls.push({name,args});
    if(name==='intrigue_rc22_withdraw_request') return {data:id,error:null};
    if(name==='intrigue_rc2_request')return {data:id,error:null};
    throw new Error('Unexpected RPC '+name);
  }};
  const helpers={
    identity:async()=>({db,user:{id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com'},url:'https://example.test',serviceKey:'unused'}),
    admin:()=>{throw Error('Privileged action should never run');},
    checkOrigin:()=>{}, recentlySignedIn:()=>{throw Error('Not for intake');},
    preview:async()=>({workspace:{id:'22222222-2222-4222-8222-222222222222',name:'TEST COMPANY'},account_deletion_eligible:false,empty_workspace_eligible:false}),
    LifecycleError:class LifecycleError extends Error {constructor(status,message){super(message);this.status=status;}},
    safeResponseError:e=>({status:e.status||500,message:e.message})
  };
  const compiled=ts.transpileModule(read(route),{fileName:route,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(compiled,{
    module,exports:module.exports,
    require:name=>{
      if(name==='next/server')return {NextResponse:{json:(body,opts)=>({body,status:opts.status})}};
      if(name==='@/lib/intrigue-account-lifecycle/server')return helpers;
      throw Error('Unexpected dependency '+name);
    },
    process:{env:{INTRIGUE_RC2_DELETION_ENABLED:'false'}},console
  });
  return {run:body=>module.exports.POST({json:async()=>body}),calls};
}
test('RC2.2 changed TypeScript parses, including Dashboard page',()=>{
 for(const f of [route,panel,'app/dashboard/page.tsx']){
  const r=ts.transpileModule(read(f),{fileName:f,reportDiagnostics:true,compilerOptions:{
    jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  const errors=(r.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,`${f}: ${errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')).join('; ')}`);
 }
});
test('confirmed withdrawal works with irreversible deletion disabled',async()=>{
 const h=routeHarness();
 const r=await h.run({action:'withdraw_request',request_id:id,confirmation:`WITHDRAW ${id}`,acknowledged:true});
 assert.equal(r.status,200);assert.equal(r.body.withdrawn,true);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,'intrigue_rc22_withdraw_request');
 assert.equal(h.calls[0].args.p_request_id,id);
});
test('withdrawal without correct confirmation is rejected without writes',async()=>{
 for(const payload of [
  {action:'withdraw_request',request_id:id,confirmation:`WITHDRAW ${id}`,acknowledged:false},
  {action:'withdraw_request',request_id:id,confirmation:'DELETE ALL',acknowledged:true},
  {action:'withdraw_request',request_id:'nonuuid',confirmation:'WITHDRAW nonuuid',acknowledged:true}
 ]){
  const h=routeHarness();const r=await h.run(payload);
  assert.equal(r.status,400);assert.equal(h.calls.length,0);
 }
});
test('new request cannot request deletion through the feature flag',async()=>{
 const h=routeHarness();const r=await h.run({action:'request',kind:'workspace',confirmation:'REQUEST COMPANY TEST COMPANY',acknowledged:true});
 assert.equal(r.status,202);assert.equal(h.calls[0].name,'intrigue_rc2_request');
 const q=routeHarness();const blocked=await q.run({action:'delete_empty_workspace'});
 assert.equal(blocked.status,503);assert.equal(q.calls.length,0);
});
test('SQL verifies requester for withdrawals, locks row, rejects reviewed requests',()=>{
 const s=read(migration);
 assert.match(s,/WHERE id = p_request_id AND requested_by = v_actor\s+FOR UPDATE/);
 assert.match(s,/v_request\.status <> 'needs_review'/);
 assert.match(s,/WITHDRAW /);
 assert.match(s,/status = 'withdrawn'/);
 assert.doesNotMatch(s,/DELETE FROM public\.workspaces|auth\.admin\.deleteUser/i);
});
test('SQL stops overlapping requests inside a locked user transaction',()=>{
 const s=read(migration);
 assert.match(s,/FROM auth\.users WHERE id = v_actor FOR UPDATE/);
 assert.match(s,/R(AISE|AISE) EXCEPTION 'An overlapping privacy request/);
 assert.match(s,/workspace_id IS NOT DISTINCT FROM p_workspace_id/);
});
test('operator review cannot perform erasure or claim completion',()=>{
 const s=read(migration);
 assert.match(s,/CREATE OR REPLACE FUNCTION public\.intrigue_rc22_operator_review/);
 assert.match(s,/p_next_status = 'reviewing'/);
 assert.match(s,/p_next_status IN \('needs_review','rejected'\)/);
 assert.match(s,/GRANT EXECUTE ON FUNCTION public\.intrigue_rc22_operator_review\(uuid,text,text,text,text\)\s+TO service_role/);
 assert.doesNotMatch(s,/GRANT EXECUTE ON FUNCTION public\.intrigue_rc22_operator_review[^;]*TO authenticated/);
 assert.match(s,/REVOKE ALL ON public\.intrigue_rc22_review_events FROM PUBLIC, anon, authenticated/);
});
test('client cannot read internal operator notes',()=>{
 const s=read(migration);
 const grant=s.match(/GRANT SELECT \(([\s\S]*?)\) ON public\.intrigue_rc2_requests TO authenticated/);
 assert.ok(grant);assert.ok(!grant[1].includes('operator_note'));
});
test('customer UI includes withdrawal, existing request guard and status',()=>{
 const s=read(panel);
 assert.match(s,/WITHDRAW \$\{withdrawTarget\.id\}/);
 assert.match(s,/existingActive/);
 assert.match(s,/canStartRequest/);
 assert.match(s,/public_message/);
 assert.match(s,/status==='needs_review'/);
});
test('dashboard gates first render until theme and workspace resolved',()=>{
 const s=read('app/dashboard/page.tsx');
 assert.match(s,/appearanceReady/);assert.match(s,/workspaceResolvedOnce/);
 assert.match(s,/if \(!appearanceReady \|\| !workspaceResolvedOnce\)/);
 assert.match(s,/Preparing your secure workspace/);
 const loc=s.indexOf('if (!appearanceReady || !workspaceResolvedOnce)');
 const ui=s.indexOf('data-intrigue-theme={appearance}');
 assert.ok(loc>=0&&ui>loc);
});
