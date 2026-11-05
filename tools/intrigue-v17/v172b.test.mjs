import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyzeEnquiry,hasSalesEvidence,protectiveIntent,validateSelection} from './quotation-analysis.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ws='44444444-4444-4444-8444-444444444444';
const customer='22222222-2222-4222-8222-222222222222';
const enquiryId='33333333-3333-4333-8333-333333333333';
const productId='11111111-1111-4111-8111-111111111111';
const item={id:productId,name:'Heavyweight Box Hoodie',price:109,currency:'EUR',is_active:true};
const e=(subject)=>({id:enquiryId,workspace_id:ws,customer_id:customer,subject});
const run={approved_at:'2026-11-03T00:00:00Z',workspace_id:ws,payload:{enquiry_id:enquiryId}};
const depsFor=(subject,aiSelect)=>({getRows:async(table)=>table==='enquiries'?[e(subject)]:table==='workspace_services'?[item]:[],aiSelect});

test('Hana exchange routes to exchange with no quotation even if AI proposes a product',async()=>{
  const result=await analyzeEnquiry(run,depsFor('Customer wants to exchange a hoodie for size XL',async()=>{throw Error('AI should not be needed');}));
  assert.equal(result.intent,'exchange');assert.equal(result.outcome,'routed');
  assert.deepEqual(result.catalog_items,[]);assert.equal(result.total,'0.00');
});
test('refund, tracking, stock and complaint enquiries are classified as non-sales',()=>{
  for (const [subject,intent] of [
    ['Please refund my shirt','refund_return'],
    ['Where is my order?','order_status'],
    ['Is the jacket in stock?','stock_check'],
    ['I have a complaint about a faulty product','support'],
  ]){
    assert.equal(protectiveIntent(subject),intent,subject);
    const result=validateSelection({intent:'sales_quote',items:[{catalog_id:productId,quantity:1}]},[item],e(subject));
    assert.equal(result.intent,intent);assert.equal(result.outcome,'routed');
    assert.deepEqual(result.catalog_items,[]);
  }
});
test('explicit sales enquiry with validated model intent is quotation eligible',()=>{
  const result=validateSelection({intent:'sales_quote',items:[{catalog_id:productId,quantity:2,unit_price:0}]},[item],e('Please quote me 2 charcoal hoodies'));
  assert.equal(result.classification_source,'v17.2b');
  assert.equal(result.intent,'sales_quote');assert.equal(result.outcome,'matched');assert.equal(result.total,'218.00');
});
test('unclassified or invented intent is not eligible for quotation',()=>{
  for(const intent of [undefined,'SALE','unknown','unclear']){
    const result=validateSelection({intent,items:[{catalog_id:productId,quantity:1}]},[item],e('Please quote 1 hoodie'));
    assert.equal(result.outcome,'needs_review');
  }
});
test('AI saying sales_quote for ambiguous request is not enough',()=>{
  const result=validateSelection({intent:'sales_quote',items:[{catalog_id:productId,quantity:1}]},[item],e('Question about a hoodie'));
  assert.equal(result.outcome,'needs_review');assert.equal(result.intent,'unclear');
  assert.equal(hasSalesEvidence('Question about a hoodie'),false);
});
test('AI declining a sale causes manual review rather than auto quotation',()=>{
  const result=validateSelection({intent:'unclear',items:[{catalog_id:productId,quantity:1}]},[item],e('Please quote 1 hoodie'));
  assert.equal(result.outcome,'needs_review');
});
test('worker sends no external actions and never quotes classified exchanges',async()=>{
  const result=await analyzeEnquiry(run,depsFor('I want to exchange a hoodie',async()=>({intent:'sales_quote',items:[{catalog_id:productId,quantity:1}]})));
  assert.equal(result.outcome,'routed');
  assert.equal(result.catalog_items.length,0);
});
test('SQL has mandatory database trigger to reject older or non-sales runs',()=>{
  const sql=readFileSync(resolve(root,'sql/INTRIGUE_V17_2B_INTENT_GUARD.sql'),'utf8');
  assert.match(sql,/BEFORE INSERT ON public\.intrigue_v172_draft_links/);
  assert.match(sql,/classification_source.*DISTINCT FROM 'v17\.2b'/);
  assert.match(sql,/intent.*DISTINCT FROM 'sales_quote'/);
});
test('API prevents unclassified quote save even before database gate',()=>{
  const api=readFileSync(resolve(root,'app/api/automation/v17/route.ts'),'utf8');
  assert.match(api,/analysis\.result\?\.classification_source!=='v17\.2b'/);
  assert.match(api,/analysis\.result\?\.intent!=='sales_quote'/);
});
test('older unclassified results warn for manual review and cannot be saved',()=>{
  const ui=readFileSync(resolve(root,'app/dashboard/automation/EnquiryQuotationAutomation.tsx'),'utf8');
  // The client UI must not expose technical version numbers, but must retain the warning.
  assert.match(ui,/Earlier result without intent classification\. Review manually; do not send the quotation\./);
  // The save button must require a matched, classified, explicit sales enquiry.
  assert.match(ui,/suggestion\?\.outcome==='matched'/);
  assert.match(ui,/suggestion\?\.intent==='sales_quote'/);
  assert.match(ui,/suggestion\?\.classification_source==='v17\.2b'/);
});
