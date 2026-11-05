const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const sourceFile=path.join(root,'lib/intrigue-crm/providers.ts');
const source=fs.readFileSync(sourceFile,'utf8');
const result=ts.transpileModule(source,{fileName:sourceFile,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
const moduleShim={exports:{}};
const ctx={module:moduleShim,exports:moduleShim.exports,process,URL,Error,console};
vm.runInNewContext(result.outputText,ctx,{filename:'providers.js'});
const {isCrmProvider,mapCrmContacts,safeApiDomain,oauthConfig}=moduleShim.exports;

test('provider allowlist excludes external hosts',()=>{
  assert.equal(isCrmProvider('zoho'),true);
  assert.equal(isCrmProvider('hubspot'),true);
  assert.equal(isCrmProvider('pipedrive'),true);
  assert.equal(isCrmProvider('http://attacker.test'),false);
});
test('Zoho contacts map into universal schema',()=>{
  const list=mapCrmContacts('zoho',{data:[{First_Name:'Ada',Last_Name:'Njeri',Email:'Ada@example.com',Phone:'+4912345',Account_Name:{name:'Fashion House'}}]});
  assert.equal(list[0].full_name,'Ada Njeri');assert.equal(list[0].email,'ada@example.com');assert.equal(list[0].company_name,'Fashion House');
});
test('HubSpot contact details map correctly',()=>{
  const rows=mapCrmContacts('hubspot',{results:[{properties:{firstname:'Leo',lastname:'Richter',email:'LEO@EXAMPLE.COM',phone:'+491234567',company:'Luma'}}]});
  assert.equal(rows[0].email,'leo@example.com');assert.equal(rows[0].full_name,'Leo Richter');
});
test('Pipedrive person email array maps correctly',()=>{
  const rows=mapCrmContacts('pipedrive',{data:[{name:'Zoe Müller',emails:[{value:'zoe@example.com',primary:true}],phones:[{value:'+49111111',primary:true}]}]});
  assert.equal(rows[0].email,'zoe@example.com');assert.equal(rows[0].phone,'+49111111');
});
test('discard records without name or email',()=>{
  assert.equal(mapCrmContacts('hubspot',{results:[{properties:{firstname:'No',lastname:'Email'}}]}).length,0);
});
test('validate provider API domain and block attacker endpoints',()=>{
  process.env.INTRIGUE_ZOHO_REGION='eu';
  assert.equal(safeApiDomain('zoho','https://www.zohoapis.eu'),'https://www.zohoapis.eu');
  assert.throws(()=>safeApiDomain('zoho','https://evil.example'));
  assert.throws(()=>safeApiDomain('pipedrive','http://x.pipedrive.com'));
  assert.throws(()=>safeApiDomain('hubspot','https://api.hubapi.com.evil.example'));
  assert.throws(()=>safeApiDomain('pipedrive','https://x.pipedrive.com.evil.example'));
});
test('OAuth scopes are read-only',()=>{
  process.env.INTRIGUE_ZOHO_CLIENT_ID='placeholder';process.env.INTRIGUE_ZOHO_CLIENT_SECRET='placeholder';
  process.env.INTRIGUE_HUBSPOT_CLIENT_ID='placeholder';process.env.INTRIGUE_HUBSPOT_CLIENT_SECRET='placeholder';
  assert.match(oauthConfig('zoho','https://product.example').scope,/contacts.READ/);
  assert.equal(oauthConfig('hubspot','https://product.example').scope,'crm.objects.contacts.read');
});
test('old action centre is absent from client navigation',()=>{
  const page=fs.readFileSync(path.join(root,'app/dashboard/page.tsx'),'utf8');
  assert.doesNotMatch(page,/\{ label: "Action Center"/);
  assert.match(page,/Other pending approvals/);
});
test('new token tables do not grant direct client access',()=>{
  const sql=fs.readFileSync(path.join(root,'sql/INTRIGUE_SPRINT1_CRM_CONNECTIONS.sql'),'utf8');
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);
  assert.match(sql,/REVOKE ALL ON public\.intrigue_crm_connections FROM PUBLIC, anon, authenticated/);
});
test('file import accepts XLSX and CSV with explicit confirmation',()=>{
  const code=fs.readFileSync(path.join(root,'app/dashboard/crm/CustomerFileImport.tsx'),'utf8');
  assert.match(code,/read-excel-file\/browser/);
  assert.match(code,/IMPORT \$\{preview\.new_rows\}/);
});

// Next.js Cache Components does not accept segment-level runtime config.
test('CRM routes are compatible with cacheComponents build configuration',()=>{
  for(const segment of ['start','callback','contacts']){
    const route=fs.readFileSync(path.join(root,'app/api/integrations/crm',segment,'route.ts'),'utf8');
    assert.doesNotMatch(route,/export\s+const\s+runtime\s*=/,`CRM ${segment} route must not override runtime with Cache Components enabled`);
  }
});
