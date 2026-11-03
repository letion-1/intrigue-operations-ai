import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {validateSelection,analyzeEnquiry,subjectHash} from './quotation-analysis.mjs';
import {executeAction} from './worker.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const ws='44444444-4444-4444-8444-444444444444';
const wf='55555555-5555-4555-8555-555555555555';
const run={id:a,workspace_id:ws,workflow_id:wf,lease_token:b,approved_at:'2026-11-03T12:00:00Z',payload:{enquiry_id:c}};
const enquiry={id:c,customer_id:b,workspace_id:ws,subject:'One brake inspection'};
const catalog=[{id:a,name:'Brake inspection',price:65.00,currency:'EUR',is_active:true,description:''}];
test('model cannot choose price: resolved from company catalog',()=>{
  const r=validateSelection({items:[{catalog_id:a,quantity:2,unit_price:0}]},catalog,enquiry);
  assert.equal(r.total,'130.00');assert.equal(r.catalog_items[0].unit_price,'65.00');
  assert.equal(r.outcome,'matched');assert.equal(r.subject_md5,subjectHash(enquiry.subject));
});
test('invented, duplicate, disabled and no catalog items never yield valid matched drafts',()=>{
  assert.equal(validateSelection({items:[{catalog_id:b,quantity:1}]},catalog,enquiry).outcome,'needs_review');
  assert.equal(validateSelection({items:[{catalog_id:a,quantity:1},{catalog_id:a,quantity:1}]},catalog,enquiry).outcome,'needs_review');
  assert.equal(validateSelection({items:[{catalog_id:a,quantity:1}]},[{...catalog[0],is_active:false}],enquiry).outcome,'needs_review');
  assert.equal(validateSelection({items:[]},catalog,enquiry).outcome,'needs_review');
});
test('AI missing details force manual review',()=>{
  const result=validateSelection({items:[{catalog_id:a,quantity:1}],missing_information:'Need customer size'},catalog,enquiry);
  assert.equal(result.outcome,'needs_review');
});
test('unapproved worker call is always blocked before database access',async()=>{
  await assert.rejects(executeAction({...run,approved_at:null},{getRows(){throw Error('should not happen');}}),/fail closed/);
});
test('worker isolates enquiry lookup by workspace and never writes database rows',async()=>{
  const seen=[];
  const deps={getRows:async(table,cols,eq)=>{
    seen.push({table,eq});
    if(table==='intrigue_v17_workflows')return [{action_type:'quotation_draft',trigger_type:'manual',requires_approval:true}];
    if(table==='enquiries')return [enquiry];
    if(table==='workspace_services')return catalog;
    return [];
  },aiSelect:async()=>({items:[{catalog_id:a,quantity:1}]})};
  const r=await executeAction(run,deps);
  assert.equal(r.outcome,'matched');assert.equal(r.total,'65.00');
  assert.deepEqual(seen.map(v=>v.eq.workspace_id),[ws,ws,ws,ws]);
});
test('cross-workspace enquiry response is blocked even with privileged key',async()=>{
  const deps={getRows:async(table)=>{
    if(table==='intrigue_v17_workflows')return [{action_type:'quotation_draft',trigger_type:'manual',requires_approval:true}];
    if(table==='enquiries')return [{...enquiry,workspace_id:b}];
    if(table==='workspace_services')return catalog;
    return [];
  },aiSelect:async()=>({items:[]})};
  await assert.rejects(executeAction(run,deps),/does not belong/);
});
test('new code reuses existing quotation-save RPC, no email or calendar calls',()=>{
  const sql=readFileSync(resolve(root,'sql/INTRIGUE_V17_2A_QUOTATION_DRAFTS.sql'),'utf8');
  const worker=readFileSync(resolve(root,'tools/intrigue-v17/quotation-analysis.mjs'),'utf8');
  assert.match(sql,/public\.intrigue_quote_save_draft/);
  assert.match(sql,/intrigue_v172_draft_links/);
  assert.match(sql,/v_run\.status<>'succeeded'/);
  assert.match(sql,/FOR UPDATE/);
  assert.doesNotMatch(worker,/\/api\/mail|vapi\/webhook|googleapis\.com\/calendar/);
});
