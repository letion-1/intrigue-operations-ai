const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=process.cwd();
const get=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const touched=[
'app/api/company-onboarding/route.ts',
'app/dashboard/company-onboarding/CompanyOnboarding.tsx',
'app/dashboard/company-onboarding/company-onboarding.css',
'app/dashboard/page.tsx',
'app/dashboard/ai-receptionist/ReceptionistPanel.tsx',
'app/api/agent/route.ts',
'app/api/assistant/route.ts',
'lib/intrigue-onboarding-structured.ts'
];
test('source files present and TypeScript parses',()=>{
 for(const name of touched){
  assert.ok(fs.existsSync(path.join(root,name)),name);
  if(!/\.(ts|tsx)$/.test(name))continue;
  const ast=ts.createSourceFile(name,get(name),ts.ScriptTarget.Latest,true,name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length,0,`Syntax error in ${name}: `+ast.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')));
 }
});
function parser(){
 const src=get('lib/intrigue-onboarding-structured.ts');
 const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 vm.runInNewContext(compiled,{exports:m.exports,module:m},{timeout:4000});
 return m.exports.parseCompanyText;
}
const dataset=`Company: ORBIT THREADS QA\nIndustry: Fashion and E-commerce\nCurrency: EUR\nBusiness description: Premium contemporary fashion.\nPRODUCT CATALOG:\n1. Essential Hoodie | SKU OT-H001 | Price EUR 70 | Stock 35\n2. Studio T-Shirt | SKU OT-T001 | Price EUR 25 | Stock 80\n3. Canvas Tote Bag | SKU OT-B001 | Price EUR 18 | Stock 50\nCOMPANY POLICIES:\n- Returns accepted within 14 days for unworn products.\n- Exchanges accepted within 14 days subject to stock availability.\nQUOTATION POLICY:\n- All quotations require human approval before sending.\nCUSTOMERS:\nJamie Example | jamie.qa@example.com | Interested in an Essential Hoodie\nAlex Sample | alex.qa@example.com | Interested in 3 Studio T-Shirts\nSUPPORT HOURS:\nMonday to Friday, 9:00 to 17:00 Europe/Berlin.`;
test('ORBIT THREADS TXT gets 3 products, 2 customers, policies and hours without AI',()=>{
 const result=parser()(dataset);assert.equal(result.structured,true);assert.equal(result.data.company.company_name,'ORBIT THREADS QA');
 assert.equal(result.data.workspace_services.length,3);assert.deepEqual(Array.from(result.data.workspace_services.map(x=>x.price)),[70,25,18]);
 assert.equal(result.data.customers.length,2);assert.equal(result.data.knowledge_entries.length,2);
 assert.match(result.data.company.business_hours,/9:00/);assert.deepEqual(Array.from(result.warnings),[]);
});
test('no unprovided contact/order/price details are invented',()=>{
 const result=parser()('Company: TEST QA\nBusiness description: No product prices available.');
 assert.ok(!result.data.customers);assert.ok(!result.data.workspace_services);assert.ok(!result.data.orders);
});
test('unpriced products are flagged for review not imported',()=>{
 const result=parser()('Company: TEST QA\nPRODUCT CATALOG:\nUnpriced Jacket | SKU QA-X');
 assert.equal(result.data.workspace_services,undefined);assert.equal(result.warnings.length,1);
});
test('onboarding bypasses AI for recognizable TXT, preserves workspace ownership and atomic RPC',()=>{
 const s=get('app/api/company-onboarding/route.ts');
 assert.match(s,/parseCompanyText\(source\)/);assert.match(s,/if\(structured\.structured\)/);assert.match(s,/if\(unstructured\.length\)/);
 assert.match(s,/workspace\.owner_id!==user\.id/);assert.match(s,/client\.rpc\('intrigue_onboarding_import'/);assert.match(s,/finalCompanyName/);
 assert.match(s,/knowledge_only/);assert.match(s,/Company mismatch/);
});
test('guided onboarding has explicit step 2 knowledge, navigation and successful continuation',()=>{
 const s=get('app/dashboard/page.tsx');assert.match(s,/'Upload company knowledge and data'/);
 assert.match(s,/if\(guideStep===1\)openGuide\(2\)/);assert.match(s,/if\(guideStep===2\)openGuide\(3\)/);
 assert.match(s,/if\(guideStep===3\)openGuide\(4\)/);assert.match(s,/Continue to step/);
});
test('language has database allowlist and company-only context',()=>{
 const sql=get('sql/INTRIGUE_SPRINT1_RC23_ONBOARDING_LANGUAGE.sql');assert.match(sql,/ALTER TABLE public\.workspace_settings/);
 assert.doesNotMatch(sql,/\bdelete\s+from\b|\btruncate\b|drop table|drop policy/i);
 assert.match(get('app/dashboard/page.tsx'),/Preferred customer communication language/);
 for(const f of ['app/api/agent/route.ts','app/api/assistant/route.ts'])assert.match(get(f),/preferred_response_language/);
});
test('known mojibake markers are removed from affected UI source',()=>{
 for(const f of ['app/dashboard/page.tsx','app/dashboard/ai-receptionist/ReceptionistPanel.tsx'])
  assert.doesNotMatch(get(f),/Â|â€|â†|â€¢|â€¦|Ã|\uFFFD/,f);
});
