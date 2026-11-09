const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const sql=read('sql/INTRIGUE_V21_OWNER_ERASURE.sql');
const route=read('app/api/company/erasure/route.ts');
const page=read('app/company/erasure/page.tsx');
test('Actual destructive SQL function exists, executes workspace deletes',()=>{
 assert.match(sql,/FUNCTION public\.intrigue_v21_erase_company\(/);
 assert.match(sql,/DELETE FROM public\.workspaces WHERE id=p_tenant AND owner_id=p_actor/);
 assert.match(sql,/DELETE FROM %s WHERE workspace_id=\$1/);
 assert.match(sql,/GET DIAGNOSTICS v_count=ROW_COUNT/);
});
test('Atomic rollback and owner controls',()=>{
 assert.match(sql,/WHERE id=p_tenant AND owner_id=p_actor AND intrigue_erasure_state='closing' FOR UPDATE/);
 assert.match(sql,/Staged case not verified/);
 assert.match(sql,/Cross-tenant|Foreign key would affect/);
 assert.match(sql,/ROLLBACK|rolled back|Rollback/i);
});
test('No browser invoke to privileged delete RPC',()=>{
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.intrigue_v21_erase_company\([^)]+\) FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.intrigue_v21_erase_company\([^)]+\) TO service_role/);
 assert.match(route,/const ctx=await owner\(req\)/);
 assert.match(route,/await recentlySignedIn\(req,ctx\.user,ctx\.url,ctx\.serviceKey\)/);
 assert.match(route,/ctx\.service\.rpc\('intrigue_v21_erase_company'/);
 assert.doesNotMatch(route,/p_actor:b\.actor|p_tenant:b\.workspace/);
});
test('Closing state blocks writes and protects against unscoped cascades',()=>{
 assert.match(sql,/CREATE TRIGGER intrigue_v21_stop_closing_writes BEFORE INSERT OR UPDATE/);
 assert.match(sql,/CREATE TRIGGER intrigue_v21_protect_workspace_state BEFORE UPDATE/);
 assert.match(sql,/child\.workspace_id IS DISTINCT FROM \$1/);
 assert.match(sql,/Circular FK dependency/);
});
test('Does not pretend a request is deletion, or backups are erased',()=>{
 assert.match(route,/if\(eraseError \|\| !result\?\.database_erased\)/);
 assert.match(route,/database_erased:false/);
 assert.match(route,/Historical database\/provider backups are not erased/);
 assert.match(page,/Historical backups and external providers/);
});
test('Export and identity checks in API',()=>{
 assert.match(sql,/FUNCTION public\.intrigue_v21_export_company\(/);
 assert.match(route,/if\(b\.exported!==true \|\| b\.acknowledged!==true/);
 assert.match(route,/p_actor:ctx\.user\.id,p_tenant:ctx\.workspace\.id/);
 assert.match(route,/p\.owned_workspaces!==1/);
});
test('TypeScript source parses',()=>{
 const ts=require('typescript');
 for(const f of ['app/api/company/erasure/route.ts','app/company/erasure/page.tsx']){
  const result=ts.transpileModule(read(f),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve},reportDiagnostics:true});
  const errors=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,errors.map(x=>ts.flattenDiagnosticMessageText(x.messageText,'\n')).join('\n'));
 }
});

test('Cache Components compatible route does not export segment runtime/dynamic config',()=>{
 const route=read('app/api/company/erasure/route.ts');
 assert.doesNotMatch(route,/export\s+const\s+(?:runtime|dynamic|revalidate|fetchCache)\s*=/);
 assert.match(route,/export async function GET/);
 assert.match(route,/export async function POST/);
 assert.match(route,/'Cache-Control':'no-store'/);
});

test('Server proxy does not redirect authenticated Bearer API requests',()=>{
 const proxy=read('lib/supabase/proxy.ts');
 assert.match(proxy,/request.nextUrl.pathname !== \"\/api\/company\/erasure\"/);
});
