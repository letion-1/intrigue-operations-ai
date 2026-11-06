const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const routeFile='app/api/account/lifecycle/route.ts';
const frontendFile='app/dashboard/account/AccountDeletionPanel.tsx';
const user={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com'};
const ws={id:'22222222-2222-4222-8222-222222222222',name:'TEST COMPANY',members:1};
const reqId='33333333-3333-4333-8333-333333333333';

function loadRoute({workspace=ws, requests=[]}={}){
  const calls=[];
  const db={rpc:async(name,params)=>{
    calls.push({name,params});
    if(name!=='intrigue_rc2_request')throw new Error('Unexpected RPC');
    return {data:reqId,error:null};
  }};
  const helpers={
    identity:async()=>({db,user,url:'https://test.invalid',serviceKey:'secret'}),
    admin:()=>{throw new Error('Privileged execution must not run');},
    checkOrigin:()=>{},
    recentlySignedIn:()=>{throw new Error('Recent-session check not needed for intake');},
    preview:async()=>({workspace,account_deletion_eligible:false,empty_workspace_eligible:false}),
    LifecycleError:class LifecycleError extends Error {constructor(status,message){super(message);this.status=status;}},
    safeResponseError:e=>({status:e.status||500,message:e.message}),
  };
  const module={exports:{}};
  const compiled=ts.transpileModule(read(routeFile),{
    fileName:routeFile,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  const ctx={
    exports:module.exports,module,
    require:id=>{
      if(id==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options.status})}};
      if(id==='@/lib/intrigue-account-lifecycle/server')return helpers;
      throw new Error('Unexpected module '+id);
    },
    process:{env:{INTRIGUE_RC2_DELETION_ENABLED:'false'}},
    console,
  };
  vm.runInNewContext(compiled,ctx,{filename:routeFile});
  const run=async b=>module.exports.POST({json:async()=>b});
  return {run,calls};
}

test('RC2.1 source parses and preserves existing deletion guard',()=>{
  for(const f of [routeFile,frontendFile]){
    const source=read(f);
    const transpiled=ts.transpileModule(source,{fileName:f,reportDiagnostics:true,compilerOptions:{
      jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext
    }});
    const bad=(transpiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
    assert.equal(bad.length,0,`${f}: ${bad.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(' ')}`);
  }
  const route=read(routeFile);
  assert.ok(route.indexOf("if(action==='request')") < route.indexOf("if(process.env.INTRIGUE_RC2_DELETION_ENABLED!=='true')"));
  assert.match(route,/await recentlySignedIn\(request,user,url,serviceKey\)/);
  assert.match(route,/safety\.account_deletion_eligible/);
  assert.match(route,/safety\.empty_workspace_eligible/);
});

test('confirmed personal privacy request works when deletion feature is OFF',async()=>{
  const m=loadRoute();
  const r=await m.run({action:'request',kind:'account',acknowledged:true,confirmation:'REQUEST ACCOUNT owner@example.com'});
  assert.equal(r.status,202);
  assert.equal(r.body.request_id,reqId);
  assert.equal(r.body.status,'received');
  assert.equal(r.body.requested,true);
  assert.equal(m.calls.length,1);
  assert.equal(m.calls[0].name,'intrigue_rc2_request');
  assert.equal(m.calls[0].params.p_workspace_id,null);
});

test('confirmed company + account request derives owner workspace from server preview',async()=>{
  const m=loadRoute();
  const r=await m.run({action:'request',kind:'workspace_and_account',acknowledged:true,
    confirmation:'REQUEST COMPANY AND ACCOUNT TEST COMPANY',workspace_id:'untrusted-client-id'});
  assert.equal(r.status,202);
  assert.equal(m.calls[0].params.p_workspace_id,ws.id);
  assert.equal(m.calls[0].params.p_kind,'workspace_and_account');
});

test('unconfirmed or malformed privacy requests are rejected without writes',async()=>{
  for(const payload of [
    {action:'request',kind:'account',acknowledged:false,confirmation:'REQUEST ACCOUNT owner@example.com'},
    {action:'request',kind:'account',acknowledged:true,confirmation:'DELETE owner@example.com'},
    {action:'request',kind:'delete_everything',acknowledged:true,confirmation:'anything'},
    {action:'request',kind:'workspace',acknowledged:true,confirmation:'REQUEST COMPANY BAD COMPANY'},
  ]){
    const m=loadRoute();const r=await m.run(payload);
    assert.equal(r.status,400);
    assert.equal(m.calls.length,0);
  }
});

test('workspace review cannot be submitted by account without owned workspace',async()=>{
  const m=loadRoute({workspace:null});
  const r=await m.run({action:'request',kind:'workspace',acknowledged:true,confirmation:'REQUEST COMPANY TEST COMPANY'});
  assert.equal(r.status,403);
  assert.equal(m.calls.length,0);
});

test('permanent account and workspace execution still blocked when flag OFF',async()=>{
  for(const action of ['delete_account','delete_empty_workspace','offer_transfer','accept_transfer']){
    const m=loadRoute();
    const r=await m.run({action,acknowledged:true,confirmation:'DELETE owner@example.com'});
    assert.equal(r.status,503,action);
    assert.equal(m.calls.length,0);
  }
});

test('customer UI requires confirmation and acknowledges non-destructive review',()=>{
  const ui=read(frontendFile);
  assert.match(ui,/Review and type|Type <strong>\{reviewPhrase\}/);
  assert.match(ui,/requestEnabled/);
  assert.match(ui,/reviewAck/);
  assert.match(ui,/(?:requestEnabled|canStartRequest)\|\|!reviewAck\|\|reviewTyped!==reviewPhrase/);
  assert.match(read(routeFile),/status:'received'/);
  assert.match(ui,/not confirmation that data has been erased/);
  assert.match(ui,/Request company \+ account deletion/);
});

console.log('RC2.1 contract tests are source and mocked-route checks, NOT live Supabase or GDPR legal validation.');
