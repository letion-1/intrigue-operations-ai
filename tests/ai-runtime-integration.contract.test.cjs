'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const ts=require('typescript');
const root=process.cwd();
const source=f=>fs.readFileSync(path.join(root,f),'utf8');
const files=['app/api/agent/route.ts','app/api/assistant/route.ts','app/api/integrations/vapi/webhook/route.ts',
 'lib/semantic-embeddings.ts','lib/intrigue-ai/governed-provider-fetch.ts','lib/intrigue-ai/vapi-postcall-meter.ts'];
function loadTs(file,stubs,env={}){
 const transpiled=ts.transpileModule(source(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
 assert.equal((transpiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 const out={};
 const sandbox={exports:out,require:id=>{
  if(id==='server-only')return {};
  if(id in stubs)return stubs[id];
  if(id==='node:crypto')return require(id);
  throw Error('Unexpected import '+id);
 },console,Buffer,Response,AbortSignal,fetch:stubs.fetch||fetch,process:{env},setTimeout,URL,Date};
 vm.runInNewContext(transpiled.outputText,sandbox,{filename:file});
 return out;
}
test('all six touched/new TS modules parse in strict Next build syntax',()=>{
 for(const f of files){
  const result=ts.transpileModule(source(f),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,f);
  assert.doesNotMatch(source(f),/export\s+const\s+(?:runtime|dynamic)\s*=/,f);
 }
});
test('existing signed-in owner workspace is used, not a client-provided workspace id',()=>{
 for(const f of files.slice(0,2)){
  assert.match(source(f),/auth\.getUser\(\)/);
  assert.match(source(f),/\.eq\("owner_id",\s*user\.id\)/);
  assert.match(source(f),/governedOpenRouterFetch\(workspace(?:Id|\.id),\s*"chat"/);
  assert.match(source(f),/embedTexts\(\[/);
 }
});
test('no direct unmetered provider calls when browser metering is enabled',()=>{
 const helper=source('lib/intrigue-ai/governed-provider-fetch.ts');
 assert.match(helper,/INTRIGUE_AI_BROWSER_METERING_ENABLED/);
 assert.match(helper,/intrigue_ai_reserve/);
 assert.match(helper,/intrigue_ai_settle/);
 assert.match(helper,/getCredential/);
 assert.match(helper,/text_allowance_exhausted/);
 assert.match(helper,/AI_USAGE_COST_UNKNOWN/);
 assert.doesNotMatch(helper,/intrigue_ai_cancel/);
 assert.match(source('lib/semantic-embeddings.ts'),/Workspace context required for metered embeddings/);
});
test('Vapi cost parsing trusts server-authenticated workspace, not untrusted call metadata',()=>{
 const parser=loadTs('lib/intrigue-ai/vapi-postcall-meter.ts',{'@supabase/supabase-js':{createClient:()=>{throw Error('should not use')}}});
 const ws='d587d0a6-daf9-49d2-a739-74c92ecc0310',callId='21b9a027-1150-4fe8-99d5-847e87738998';
 const e={authorization:{authorized:true,workspace_id:ws},call:{id:callId,workspace_id:'43b47d8c-3be0-4f10-a231-411dddb28b5f'},
  message:{cost:0.34,startedAt:'2026-11-10T12:00:00.000Z',endedAt:'2026-11-10T12:02:01.000Z'}};
 const valid=parser.parseTrustedVoiceUsage(e);
 assert.equal(valid.workspaceId,ws);assert.equal(valid.seconds,121);assert.equal(valid.costUsd,0.34);
 assert.equal(parser.parseTrustedVoiceUsage({...e,authorization:{authorized:true}}),null);
 assert.equal(parser.parseTrustedVoiceUsage({...e,authorization:{authorized:false,workspace_id:ws}}),null);
 assert.equal(parser.parseTrustedVoiceUsage({...e,message:{...e.message,cost:-1}}),null);
});
test('governed fetch reserves BEFORE paid requests and settles actual provider charge',async()=>{
 const workspace='d587d0a6-daf9-49d2-a739-74c92ecc0310';
 let calls=[];const db={rpc:async(name,args)=>{calls.push(['rpc',name,args]);
  if(name==='intrigue_ai_reserve')return {data:{approved:true}};
  if(name==='intrigue_ai_settle')return {data:true};return {data:null,error:{message:'unexpected'}};}};
 const helper=loadTs('lib/intrigue-ai/governed-provider-fetch.ts',{
  '@supabase/supabase-js':{createClient:()=>db},
  '@/lib/intrigue-ai/server':{loadPlan:async()=>({text_provider:'openrouter',text_mode:'managed'}),getCredential:async()=>{throw Error('no BYOK')}} ,
  fetch:async(uri,opts)=>{calls.push(['fetch',uri,opts]);return new Response(JSON.stringify({id:'gen_1',usage:{cost:0.018,prompt_tokens:60,completion_tokens:12},choices:[{message:{content:'OK'}}]}),{status:200});}
 },{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'dev_only',OPENROUTER_API_KEY:'mock-managed',INTRIGUE_AI_BROWSER_METERING_ENABLED:'true'});
 const response=await helper.governedOpenRouterFetch(workspace,'chat',{method:'POST',body:JSON.stringify({model:'demo/model',messages:[{role:'user',content:'hi'}],max_tokens:50})});
 assert.equal(response.status,200);
 assert.equal(calls[0][1],'intrigue_ai_reserve');assert.equal(calls[1][1],'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(calls[2][1],'intrigue_ai_settle');assert.equal(calls[2][2].p_actual_usd,0.018);
 assert.equal(calls[1][2].headers.Authorization,'Bearer mock-managed');
});
test('denied budget never reaches paid AI provider',async()=>{
 let fetched=0;
 const helper=loadTs('lib/intrigue-ai/governed-provider-fetch.ts',{
  '@supabase/supabase-js':{createClient:()=>({rpc:async()=>({data:{approved:false,reason:'text_allowance_exhausted'}})})},
  '@/lib/intrigue-ai/server':{loadPlan:async()=>({text_provider:'openrouter',text_mode:'managed'})},
  fetch:async()=>{fetched++;throw Error('provider must not be called')}
 },{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock',OPENROUTER_API_KEY:'mock',INTRIGUE_AI_BROWSER_METERING_ENABLED:'true'});
 const res=await helper.governedOpenRouterFetch('d587d0a6-daf9-49d2-a739-74c92ecc0310','chat',{
  method:'POST',body:JSON.stringify({model:'demo/model',messages:[{role:'user',content:'hi'}],max_tokens:30})});
 assert.equal(res.status,429);assert.equal(fetched,0);
});
test('voice metering is gated and never blocks booking or call history',()=>{
 const v=source('app/api/integrations/vapi/webhook/route.ts');
 assert.match(v,/intrigue_vapi_inbound/);
 assert.match(v,/await recordVapiCall\(\{authorization:data,call,message\}\)/);
 assert.match(source('lib/intrigue-ai/vapi-postcall-meter.ts'),/INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED/);
});

test('BYOK credentials are used only when approved by provider-mode gate',async()=>{
 const workspace='d587d0a6-daf9-49d2-a739-74c92ecc0310';
 let providerCalls=0;
 const db={rpc:async()=>({data:{approved:true}})};
 const stubs={
  '@supabase/supabase-js':{createClient:()=>db},
  '@/lib/intrigue-ai/server':{loadPlan:async()=>({text_provider:'openrouter',text_mode:'byok'}),getCredential:async()=>"mock-owned-key"},
  fetch:async(uri,opts)=>{providerCalls++;assert.equal(opts.headers.Authorization,'Bearer mock-owned-key');return new Response(JSON.stringify({usage:{cost:0.001},choices:[]}),{status:200});}
 };
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock',
  OPENROUTER_API_KEY:'managed-key',INTRIGUE_AI_BROWSER_METERING_ENABLED:'true'};
 const opts={method:'POST',body:JSON.stringify({model:'demo/model',messages:[{role:'user',content:'hi'}],max_tokens:30})};
 const off=loadTs('lib/intrigue-ai/governed-provider-fetch.ts',stubs,env);
 assert.equal((await off.governedOpenRouterFetch(workspace,'chat',opts)).status,409);assert.equal(providerCalls,0);
 const on=loadTs('lib/intrigue-ai/governed-provider-fetch.ts',stubs,{...env,INTRIGUE_AI_BYOK_ACTIVATION_ENABLED:'true'});
 assert.equal((await on.governedOpenRouterFetch(workspace,'chat',opts)).status,200);assert.equal(providerCalls,1);
});
