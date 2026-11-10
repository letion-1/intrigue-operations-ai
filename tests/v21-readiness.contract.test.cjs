'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const page=read('app/company/erasure/page.tsx');
const route=read('app/api/company/erasure/route.ts');

test('V21 readiness page parses as TSX',()=>{
 const ts=require('typescript');
 const r=ts.transpileModule(page,{fileName:'page.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve},reportDiagnostics:true});
 const errors=(r.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
 assert.equal(errors.length,0,errors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')).join('\n'));
});
test('Button is explicitly disabled and visibly explained until export and confirmation',()=>{
 assert.match(page,/const missing:string\[\]=\[\]/);
 assert.match(page,/if\(!downloaded\)missing\.push/);
 assert.match(page,/if\(!ack\)missing\.push/);
 assert.match(page,/if\(typed!==expectedConfirmation\)missing\.push/);
 assert.match(page,/disabled=\{!readyToErase\}/);
 assert.match(page,/Deletion is not ready yet/);
 assert.match(page,/aria-describedby="v21-erasure-readiness"/);
});
test('Preflight blockers are shown individually, no bypasses',()=>{
 for(const field of ['data.legal_holds','data.in_flight_ai_jobs','data.storage_objects_owned_by_actor','!data.can_stage'])assert.ok(page.includes(field),field);
 assert.match(page,/const readyToErase=Boolean\(data&&!busy&&missing\.length===0\)/);
 assert.doesNotMatch(page,/setData\(\{\s*\.\.\.data,\s*can_stage:\s*true/);
});
test('Export status only succeeds after successful authorized export response',()=>{
 const fetchIndex=page.indexOf("/api/company/erasure?mode=export");
 const statusIndex=page.indexOf('setDownloaded(true)');
 assert.ok(fetchIndex>=0&&statusIndex>fetchIndex);
 assert.match(page,/if\(!res\.ok\)/);
 assert.match(page,/setDownloaded\(false\);setExportNote\(''\)/);
});
test('Staged failure reloads preflight so cancel control becomes visible',()=>{
 assert.match(page,/if\(j\.case_id\)\{setCaseId\(j\.case_id\);await load\(\);\}/);
 assert.match(page,/data\.state==='closing'&&caseId/);
 assert.match(page,/action:'cancel'/);
});
test('Destructive action remains server-side and owner authenticated',()=>{
 assert.match(route,/const ctx=await owner\(req\)/);
 assert.match(route,/await recentlySignedIn\(req,ctx\.user,ctx\.url,ctx\.serviceKey\)/);
 assert.match(route,/ctx\.service\.rpc\('intrigue_v21_erase_company'/);
 assert.match(page,/headers:\{\.\.\.await bearer\(\),'Content-Type':'application\/json'\}/);
 assert.doesNotMatch(page,/intrigue_v21_erase_company/);
});
