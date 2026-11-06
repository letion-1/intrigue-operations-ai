const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('all RC2 TypeScript files parse without syntax errors',()=>{
 for(const file of [
  'lib/intrigue-account-lifecycle/server.ts',
  'app/api/account/lifecycle/route.ts',
  'app/api/account/lifecycle/export/route.ts',
  'app/dashboard/account/AccountDeletionPanel.tsx',
  'app/transfer-ownership/page.tsx',
  'app/account/privacy/page.tsx',
  'app/api/account/delete/route.ts']){
  const compiled=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,
   compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  const bad=(compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(bad.length,0,`${file}: ${bad.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(' ')}`);
 }
});
test('state-changing API requires bearer identity and recent sign-in for destructive actions',()=>{
 const s=read('app/api/account/lifecycle/route.ts');
 assert.match(s,/checkOrigin\(request\)/);
 assert.match(s,/await identity\(request\)/);
 assert.match(s,/await recentlySignedIn\(request,user,url,serviceKey\)/);
 assert.match(s,/safety\.account_deletion_eligible/);
 assert.match(s,/safety\.empty_workspace_eligible/);
 assert.match(s,/acknowledged!==true/);
 assert.match(s,/admin\(url,serviceKey\)/);
 assert.doesNotMatch(s,/deleteUser\(b\./);
});
test('service-only SQL grants prevent direct client access to destructive RPCs',()=>{
 const s=read('sql/INTRIGUE_SPRINT1_RC2_ACCOUNT_LIFECYCLE.sql');
 for(const op of ['intrigue_rc2_recent_session(uuid,uuid)','intrigue_rc2_offer_transfer(uuid,uuid,uuid)','intrigue_rc2_accept_transfer(uuid,uuid)','intrigue_rc2_delete_empty_workspace(uuid,uuid,text)']) {
  assert.ok(s.includes(`GRANT EXECUTE ON FUNCTION public.${op} TO service_role`),op);
  assert.ok(s.includes(`REVOKE ALL ON FUNCTION public.${op} FROM PUBLIC,anon,authenticated`),op);
 }
});
test('database is tenant-scoped with catalog-driven dependency checks and no global cascade changes',()=>{
 const s=read('sql/INTRIGUE_SPRINT1_RC2_ACCOUNT_LIFECYCLE.sql');
 assert.match(s,/pg_catalog\.pg_constraint/);
 assert.match(s,/id=p_workspace_id AND owner_id=v_user/);
 assert.match(s,/owner_id=v_user::text/);
 assert.match(s,/IF v_rows>0 THEN RAISE EXCEPTION/);
 assert.match(s,/ON DELETE SET NULL/);
 assert.doesNotMatch(s,/DISABLE TRIGGER|DROP CONSTRAINT|ALTER TABLE auth\.users|TRUNCATE public\./i);
});
test('export excludes general company CRM and warns about limits',()=>{
 const s=read('app/api/account/lifecycle/export/route.ts');
 assert.match(s,/personal_account_summary/);
 assert.match(s,/owner-only Data Management/);
 assert.doesNotMatch(s,/from\('customers'\)|from\('quotations'\)/);
});
test('company erasure with real records is a reviewed request not a SQL cascade',()=>{
 const ui=read('app/dashboard/account/AccountDeletionPanel.tsx');
 assert.match(ui,/Request company \+ account deletion/);
 assert.match(ui,/strict empty-workspace check/);
 assert.match(ui,/not confirmation that data has been erased/);
});
test('legacy deletion endpoint is disabled',()=>{
 const s=read('app/api/account/delete/route.ts');
 assert.match(s,/status:410/);
 assert.doesNotMatch(s,/auth\.admin\.deleteUser/);
});
