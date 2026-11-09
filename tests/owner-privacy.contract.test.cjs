'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const route='app/api/account/lifecycle/route.ts';
const panel='app/dashboard/account/AccountDeletionPanel.tsx';
const page='app/dashboard/page.tsx';
const privacy='app/account/personal-privacy/page.tsx';
const testUser={id:'11111111-1111-4111-8111-111111111111',email:'team@example.com'};
const owned={id:'22222222-2222-4222-8222-222222222222',name:'Owned Company'};
const requestId='33333333-3333-4333-8333-333333333333';
function makeHarness({workspace=null,enabled='false'}={}){
 const writes=[];
 const db={rpc:async(name,args)=>{writes.push({name,args});if(name==='intrigue_rc2_request')return{data:requestId,error:null};throw Error('Unexpected RPC '+name)}};
 const helpers={
   identity:async()=>({db,user:testUser,url:'https://example.invalid',serviceKey:'dummy'}),
   admin:()=>{throw Error('Privileged admin client must not run');},
   checkOrigin:()=>{},recentlySignedIn:()=>{throw Error('Recent sign-in not reached');},
   preview:async()=>({workspace,empty_workspace_eligible:true,account_deletion_eligible:false}),
   LifecycleError:class LifecycleError extends Error{constructor(status,message){super(message);this.status=status;}},
   safeResponseError:e=>({status:e.status||500,message:e.message})
 };
 const compiled=ts.transpileModule(read(route),{fileName:route,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(compiled,{module:m,exports:m.exports,console,process:{env:{INTRIGUE_RC2_DELETION_ENABLED:enabled}},require:name=>{
   if(name==='next/server')return {NextResponse:{json:(body,opts)=>({body,status:opts.status})}};
   if(name==='@/lib/intrigue-account-lifecycle/server')return helpers;
   throw Error('Unexpected '+name);
 }});
 return {run:payload=>m.exports.POST({json:async()=>payload}),writes};
}
test('all changed TypeScript files parse',()=>{
 for(const file of [page,panel,route,privacy]){
  const r=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.equal((r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 }
});
test('employee cannot submit company erasure request by forged payload',async()=>{
 for(const kind of ['workspace','workspace_and_account']){
  const m=makeHarness();
  const r=await m.run({action:'request',kind,confirmation:'REQUEST COMPANY Owned Company',acknowledged:true,workspace_id:owned.id});
  assert.equal(r.status,403,kind);assert.equal(m.writes.length,0);
 }
});
test('employee can request own account erasure review',async()=>{
 const m=makeHarness();const r=await m.run({action:'request',kind:'account',confirmation:'REQUEST ACCOUNT team@example.com',acknowledged:true});
 assert.equal(r.status,202);assert.equal(m.writes.length,1);assert.equal(m.writes[0].args.p_workspace_id,null);
});
test('employee cannot invoke company destructive/transfer actions even when feature disabled',async()=>{
 for(const action of ['delete_empty_workspace','offer_transfer']){
  const m=makeHarness();const r=await m.run({action});assert.equal(r.status,403,action);assert.equal(m.writes.length,0);
 }
});
test('owner request remains available for reviewed company erasure',async()=>{
 const m=makeHarness({workspace:owned});const r=await m.run({action:'request',kind:'workspace',confirmation:'REQUEST COMPANY Owned Company',acknowledged:true});
 assert.equal(r.status,202);assert.equal(m.writes.length,1);assert.equal(m.writes[0].args.p_workspace_id,owned.id);
});
test('owner destructive actions still disabled by feature flag',async()=>{
 const m=makeHarness({workspace:owned});const r=await m.run({action:'delete_empty_workspace'});assert.equal(r.status,503);assert.equal(m.writes.length,0);
});
test('dashboard exposes owner-only company deletion route and personal privacy link',()=>{
 const p=read(page);assert.match(p,/isOwner\s*\?\s*<>/);
 assert.match(p,/href="\/company\/erasure"/);
 assert.match(p,/<AccountDeletionPanel scope="personal"\s*\/>/);
 assert.match(p,/href="\/account\/personal-privacy"/);
 const c=read(panel);assert.match(c,/scope==='owner'\s*&&\s*p\.workspace/);
 assert.match(c,/scope\?:'owner'\|'personal'/);
 assert.match(c,/scope='personal'/);
 assert.match(read(privacy),/scope="personal"/);
});
test('API trusts server-verified owner preview and never client supplied owner ID',()=>{
 const r=read(route);
 assert.match(r,/companyOwnerAction/);
 assert.match(r,/Only the verified company owner may manage company deletion or transfers/);
 assert.match(r,/const workspaceId=kind==='account'\?null:safety\.workspace\?\.id/);
});
test('database verification is read only and checks owner-restricted functions',()=>{
 const s=read('sql/INTRIGUE_OWNER_PRIVACY_READ_ONLY_VERIFY.sql');
 assert.match(s,/owner_id = v_actor/);assert.match(s,/owner_id=v_user/);
 assert.doesNotMatch(s,/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bCREATE\s+POLICY\b|\bALTER\s+TABLE\b/i);
});
