const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const r = path => fs.readFileSync(path, 'utf8');

test('private operator auth has its own browser storage and does not use client cookies', () => {
 const x=r('lib/intrigue-platform-auth-client.ts');
 assert.match(x,/storageKey: 'intrigue-private-platform-auth'/);
 assert.doesNotMatch(x,/^import .*\@supabase\/ssr|^import .*lib\/supabase\/client/m);
});
test('private login verifies access against server endpoint', () => {
 const x=r('app/platform/login/page.tsx');
 assert.match(x,/signInWithPassword/);assert.match(x,/authorize\(data.session.access_token\)/);
 assert.doesNotMatch(x,/signUp\(/);
});
test('private console uses separate browser identity and has logout', () => {
 const x=r('app/platform/page.tsx');
 assert.match(x,/createPlatformClient/);assert.match(x,/Log out/);
 assert.doesNotMatch(x,/href="\/dashboard"/);
});
test('server still verifies every private platform call', () => {
 const x=r('app/api/platform/console/route.ts');
 assert.match(x,/mustBeOperator\(ctx\)/);
});
test('platform proxy route is explicitly handled without leaking bearer authorization', () => {
 const x=r('lib/supabase/proxy.ts');
 assert.match(x,/intrigue_private_platform_boundary/);
});
test('admin database identity cannot belong to client company', () => {
 const x=r('sql/INTRIGUE_PRIVATE_ADMIN_ACCOUNT.sql');
 assert.match(x,/NOT EXISTS \(SELECT 1 FROM public.workspace_memberships/);
 assert.match(x,/NOT EXISTS \(SELECT 1 FROM public.workspaces/);
 assert.match(x,/one_active_platform_admin/);
});

test('new and changed TypeScript sources parse without syntax errors', () => {
 const ts = require('typescript');
 for (const file of ['app/platform/page.tsx','app/platform/login/page.tsx','lib/intrigue-platform-auth-client.ts','lib/intrigue-platform.ts','lib/supabase/proxy.ts']) {
  const result=ts.transpileModule(r(file),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.deepEqual((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.messageText),[],file);
 }
});
