import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {selectWithOpenRouter,analyzeEnquiry} from '../tools/intrigue-v17/quotation-analysis.mjs';
import {executeAction} from '../tools/intrigue-v17/worker.mjs';

const workspaceId='12345678-1234-4234-9234-123456789abc';
const runId='22345678-1234-4234-9234-123456789abc';
const enquiryId='32345678-1234-4234-9234-123456789abc';
const customerId='42345678-1234-4234-9234-123456789abc';
const workflowId='52345678-1234-4234-9234-123456789abc';
const catalogId='62345678-1234-4234-9234-123456789abc';
const fixture={enquiry:'Quote 3 hoodies',catalog:[{catalog_ref:'C1',name:'Hoodie',description:'Plain'}],guidance:[]};
const mockContent={choices:[{message:{content:JSON.stringify({intent:'sales_quote',items:[{catalog_ref:'C1',quantity:3}],missing_information:''})}}]};
const env={INTRIGUE_AI_WORKER_METERING_ENABLED:'true',INTRIGUE_APP_URL:'https://intrigue.example',INTRIGUE_AI_WORKER_TOKEN:'X'.repeat(36)};

test('metered quotation uses internal gateway with stable company-scoped request key',async()=>{
 let req;
 const fetcher=async (url,init)=>{req={url,init};return {ok:true,json:async()=>({completion:mockContent,usage:{reconciled:true}})};};
 const result=await selectWithOpenRouter(fixture,fetcher,env,{workspaceId,requestKey:`quote:${runId}`});
 assert.equal(result.intent,'sales_quote');
 assert.equal(req.url,'https://intrigue.example/api/ai-runtime/chat');
 assert.ok(!req.init.headers.Authorization);
 assert.equal(req.init.headers['x-intrigue-worker-token'],env.INTRIGUE_AI_WORKER_TOKEN);
 const body=JSON.parse(req.init.body);
 assert.equal(body.workspace_id,workspaceId);
 assert.equal(body.request_key,`quote:${runId}`);
 assert.equal(body.purpose,'quotation_intent');
 assert.equal(body.max_tokens,650);
 assert.equal(body.messages.length,2);
 assert.match(body.messages[0].content,/approval|price|quote/i);
});

test('gateway denial never falls back to direct OpenRouter',async()=>{
 let calls=0;
 const fetcher=async url=>{calls++;assert.match(url,/intrigue.example/);return {ok:false,status:429};};
 await assert.rejects(selectWithOpenRouter(fixture,fetcher,env,{workspaceId,requestKey:`quote:${runId}`}),/HTTP 429/);
 assert.equal(calls,1);
});

test('invalid company context, request key, token or non-HTTPS origin fail before provider call',async()=>{
 let called=false;
 const fetcher=()=>{called=true;throw Error('must not call');};
 for(const [ctx,options] of [
   [{workspaceId:'not-a-company',requestKey:`quote:${runId}`},env],
   [{workspaceId,requestKey:'short'},env],
   [{workspaceId,requestKey:`quote:${runId}`},{...env,INTRIGUE_APP_URL:'http://intrigue.example'}],
   [{workspaceId,requestKey:`quote:${runId}`},{...env,INTRIGUE_AI_WORKER_TOKEN:'short'}],
 ])await assert.rejects(selectWithOpenRouter(fixture,fetcher,options,ctx));
 assert.equal(called,false);
});

test('with metering OFF legacy direct selector remains available',async()=>{
 let req;
 const fetcher=async(url,init)=>{req={url,init};return{ok:true,json:async()=>mockContent};};
 const result=await selectWithOpenRouter(fixture,fetcher,{OPENROUTER_API_KEY:'fake-test-token'});
 assert.equal(result.intent,'sales_quote');
 assert.equal(req.url,'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(req.init.headers.Authorization,'Bearer fake-test-token');
 assert.equal(JSON.parse(req.init.body).response_format.type,'json_object');
});

test('approved lease passes DB-issued workspace and run ID to analysis',async()=>{
 const run={id:runId,workspace_id:workspaceId,workflow_id:workflowId,lease_token:'lease123',approved_at:'2026-11-11T00:00:00Z',payload:{enquiry_id:enquiryId}};
 let receivedContext;
 const deps={
  getRows:async(table)=>{
   if(table==='intrigue_v17_workflows')return [{id:workflowId,workspace_id:workspaceId,requires_approval:true,trigger_type:'manual',action_type:'quotation_draft'}];
   if(table==='enquiries')return [{id:enquiryId,workspace_id:workspaceId,customer_id:customerId,subject:'Please quote 3 hoodies'}];
   if(table==='workspace_services')return [{id:catalogId,name:'Hoodie',description:'Cotton',price:19,currency:'EUR',is_active:true}];
   if(table==='knowledge_entries')return[];
   throw Error(`Unexpected table ${table}`);
  },
  aiSelect:async(payload,ctx)=>{receivedContext=ctx;return {intent:'sales_quote',items:[{catalog_ref:'C1',quantity:3}],missing_information:''};}
 };
 const result=await executeAction(run,deps);
 assert.equal(result.intent,'sales_quote');
 assert.equal(result.outcome,'matched');
 assert.equal(receivedContext.workspaceId,workspaceId);
 assert.equal(receivedContext.requestKey,`quote:${runId}`);
});

test('non-sales requests route without a paid model call',async()=>{
 const run={id:runId,workspace_id:workspaceId,approved_at:'2026-11-11T00:00:00Z',payload:{enquiry_id:enquiryId}};
 let called=false;
 const result=await analyzeEnquiry(run,{
  getRows:async table=>table==='enquiries'?[{id:enquiryId,workspace_id:workspaceId,customer_id:customerId,subject:'Where is my order? order status'}]:[],
  aiSelect:()=>{called=true;throw Error('not allowed');}
 });
 assert.equal(result.intent,'order_status');
 assert.equal(called,false);
});

test('gateway accepts only server-approved quotation purpose and requests JSON output',()=>{
 const code=fs.readFileSync('app/api/ai-runtime/chat/route.ts','utf8');
 assert.match(code,/purpose!=='quotation_intent'/);
 assert.match(code,/purpose==='quotation_intent'\?\{temperature:0\.1,response_format:\{type:'json_object'\}\}/);
 assert.match(code,/INTRIGUE_AI_WORKER_TOKEN/);
 assert.match(code,/intrigue_ai_reserve/);
 assert.match(code,/intrigue_ai_settle/);
});

test('existing worker remains approval-only; no false voice cap activation',()=>{
 const code=fs.readFileSync('tools/intrigue-v17/worker.mjs','utf8');
 assert.match(code,/run\.approved_at/);
 assert.match(code,/workflow\.requires_approval !== true/);
 assert.ok(!code.includes('INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=true'));
 const voice=fs.readFileSync('lib/intrigue-ai/vapi-postcall-meter.ts','utf8');
 assert.match(voice,/post-call/i);
});
