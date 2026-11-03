import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEnquiry, validateSelection, selectWithOpenRouter } from './quotation-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ws = '44444444-4444-4444-8444-444444444444';
const customer = '22222222-2222-4222-8222-222222222222';
const enquiryId = '33333333-3333-4333-8333-333333333333';
const sand = '42133031-c134-4239-a3af-349d5f632958';
const charcoal = '1cc05b1d-4fa6-4aa1-a882-d6bbccbfaabe';
const lime = '30516f0a-001b-4469-9dab-27da00eca5e7';
const catalog = [
  {id: sand,name: 'Heavyweight Box Hoodie - Sand',price:109,is_active:true,currency:'EUR',description:'Box hoodie'},
  {id: charcoal,name:'Heavyweight Box Hoodie - Charcoal',price:109,is_active:true,currency:'EUR',description:'Box hoodie'},
  {id: lime,name:'Kimono Hoodie - Acid Lime',price:149,is_active:true,currency:'EUR',description:'Hoodie'},
];
const enquiry = {id:enquiryId,workspace_id:ws,customer_id:customer,subject:'I want to buy 3 charcoal hoodies. Please send me a quotation.'};
const approvedRun = {approved_at:'2026-11-04T00:00:00Z',workspace_id:ws,payload:{enquiry_id:enquiryId}};

const proposed = items => ({intent:'sales_quote',items,missing_information:''});

test('Hana exact charcoal product by short catalog reference, qty 3, EUR 327', () => {
  const result = validateSelection(proposed([{catalog_ref:'C2',quantity:3,unit_price:0}]),catalog,enquiry);
  assert.equal(result.outcome,'matched');
  assert.equal(result.intent,'sales_quote');
  assert.equal(result.total,'327.00');
  assert.equal(result.catalog_items.length,1);
  assert.equal(result.catalog_items[0].catalog_id,charcoal);
  assert.equal(result.catalog_items[0].quantity,3);
  assert.equal(result.catalog_items[0].unit_price,'109.00');
  assert.equal(result.classification_source,'v17.2b'); // DB policy still accepts this
});

test('AI sees only short references, product names and descriptions; not UUIDs or prices',async()=>{
  let prompt;
  const got=await analyzeEnquiry(approvedRun,{
    getRows:async(table,cols,filters)=>{
      assert.equal(filters.workspace_id,ws);
      return table==='enquiries'?[enquiry]:table==='workspace_services'?catalog:[];
    },
    aiSelect:async payload=>{
      prompt=payload;
      return proposed([{catalog_ref:'C2',quantity:3}]);
    },
  });
  assert.equal(got.outcome,'matched');
  assert.deepEqual(prompt.catalog.map(v=>v.catalog_ref),['C1','C2','C3']);
  assert(!('id' in prompt.catalog[0]));
  assert(!('price' in prompt.catalog[0]));
});

test('Unknown, invented, duplicate and conflicting short references fail closed',()=>{
  for(const items of [
    [{catalog_ref:'C999',quantity:3}],
    [{catalog_ref:'C2',quantity:3},{catalog_ref:'C2',quantity:3}],
    [{catalog_ref:'C2',catalog_id:sand,quantity:3}],
  ]){
    const result=validateSelection(proposed(items),catalog,enquiry);
    assert.equal(result.outcome,'needs_review');
  }
});

test('AI choosing sand despite requested charcoal cannot produce a savable draft',()=>{
  const result=validateSelection(proposed([{catalog_ref:'C1',quantity:3}]),catalog,enquiry);
  assert.equal(result.outcome,'needs_review');
  assert.equal(result.catalog_items.length,0);
  assert.match(result.warnings.join(' '),/requested variant/i);
});

test('AI cannot silently change an explicit single-product quantity',()=>{
  const result=validateSelection(proposed([{catalog_ref:'C2',quantity:2}]),catalog,enquiry);
  assert.equal(result.outcome,'needs_review');
  assert.match(result.warnings.join(' '),/quantity does not match/i);
});

test('String quantity normalized only when an integer 1-100',()=>{
  const ok=validateSelection(proposed([{catalog_ref:'c2',quantity:'3'}]),catalog,enquiry);
  assert.equal(ok.total,'327.00');
  assert.equal(ok.outcome,'matched');
  for (const qty of ['3.2','0','101','three']){
    assert.equal(validateSelection(proposed([{catalog_ref:'C2',quantity:qty}]),catalog,enquiry).outcome,'needs_review');
  }
});

test('OpenRouter system instruction requests catalog refs, and no UUID copying',async()=>{
  let body;
  const fetcher=async(url,options)=>{
    body=JSON.parse(options.body);
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(proposed([{catalog_ref:'C2',quantity:3}]))}}]})};
  };
  const result=await selectWithOpenRouter({enquiry:enquiry.subject,catalog:[]},fetcher,{OPENROUTER_API_KEY:'TEST-NOT-REAL'});
  assert.equal(result.items[0].catalog_ref,'C2');
  assert.match(body.messages[0].content,/catalog_ref/i);
  assert.match(body.messages[0].content,/NEVER return UUIDs/i);
});

test('API reanalysis requires membership, previous unresolved result and fresh approval',()=>{
  const src=readFileSync(resolve(root,'app/api/automation/v17/route.ts'),'utf8');
  assert.match(src,/operation === 'reanalyze_quotation'/);
  assert.match(src,/await manager\(request,workspaceId\)/);
  assert.match(src,/prior\.result\?\.outcome!=='needs_review'/);
  assert.match(src,/p_event_key:`reanalyze:\$\{enquiryId\}:\$\{randomUUID\(\)\}`/);
  assert.match(src,/p_payload:\{source:'enquiry_reanalysis'/);
});

test('UI exposes controlled reanalysis and chooses newest run for the same enquiry',()=>{
  const src=readFileSync(resolve(root,'app/dashboard/automation/EnquiryQuotationAutomation.tsx'),'utf8');
  assert.match(src,/Re-analyze quotation/);
  assert.match(src,/!byEnquiry\.has\(id\)/);
  assert.match(src,/reanalyze_quotation/);
});
