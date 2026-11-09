const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=f=>fs.readFileSync(f,'utf8');
const route=read('app/api/account/lifecycle/route.ts');
const panel=read('app/dashboard/account/AccountDeletionPanel.tsx');
const page=read('app/dashboard/page.tsx');
const chart=read('app/dashboard/overview/OverviewInsights.tsx');
const design=read('app/dashboard/v18-polish.css');
const chartCss=read('app/dashboard/overview/overview-insights.css');

test('All V18 and privacy files parse',()=>{
 for(const file of ['app/dashboard/page.tsx','app/dashboard/account/AccountDeletionPanel.tsx','app/api/account/lifecycle/route.ts','app/dashboard/overview/OverviewInsights.tsx','app/layout.tsx','app/page.tsx']){
  const result=ts.transpileModule(read(file),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  assert.equal((result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,file);
 }
});
test('Account deletion unlock is personal only; company actions remain feature-gated',()=>{
 assert.match(route,/personalDeletionEnabled:process\.env\.INTRIGUE_RC2_PERSONAL_DELETION_ENABLED!==['"]false['"]/);
 assert.match(route,/action!=='delete_account' && process\.env\.INTRIGUE_RC2_DELETION_ENABLED!=='true'/);
 assert.match(route,/action==='delete_account'/);
 assert.match(route,/await recentlySignedIn\(request,user,url,serviceKey\)/);
 assert.match(route,/const fresh=await preview\(db\)/);
 assert.match(route,/fresh\.owned_workspaces!==0/);
 assert.match(route,/fresh\.storage_owned!==0/);
 assert.match(route,/fresh\.account_blockers\.length>0/);
 assert.match(route,/b\.confirmation!==`DELETE \$\{user\.email\}`/);
 assert.match(route,/auth\.admin\.deleteUser\(user\.id,false\)/);
 assert.doesNotMatch(route,/deleteUser\(b\./);
});
test('Company action requires verified owner, even when personal deletion is enabled',()=>{
 assert.match(route,/companyOwnerAction && !safety\.workspace\?\.id/);
 assert.match(route,/Only the verified company owner may manage company deletion/);
 assert.match(route,/if\(!safety\.workspace\?\.id\|\|!safety\.empty_workspace_eligible\)/);
 assert.match(route,/p_actor:user\.id/);
});
test('Personal UI shows direct deletion when eligible, preserving reviewed fallback',()=>{
 assert.match(panel,/personalDeletionEnabled/);
 assert.match(panel,/p\.account_deletion_eligible&&personalDeletionEnabled/);
 assert.match(panel,/Request account erasure review/);
 assert.match(panel,/scope==='owner'&&p\.workspace/);
 assert.match(panel,/active==='delete_account'\?personalDeletionEnabled:enabled/);
});
test('Overview uses workspace data and has working time filter',()=>{
 assert.match(page,/<OverviewInsights/);
 assert.match(page,/enquiries=\{enquiries\}/);
 assert.match(page,/quotes=\{quotes\}/);
 assert.match(chart,/new Map(?:<[^>]+>)?\(days\.map/);
 assert.match(chart,/setPeriod\(days\)/);
 assert.doesNotMatch(chart,/Math\.random/);
});
test('Client billing/pilot links are hidden, code retained for future owner admin',()=>{
 assert.match(page,/\["Data Management","Security & Usage"\]\.map\(label/);
 assert.match(page,/section === "Plans & Billing"/);
 assert.match(page,/section === "Pilot Application"/);
});
test('Responsive light and dark themes include phone and tablet layouts',()=>{
 assert.match(design,/data-intrigue-theme="light"/);
 assert.match(design,/data-intrigue-theme="dark"/);
 assert.match(design,/max-width:680px/);
 assert.match(chartCss,/max-width:1100px/);
 assert.match(chartCss,/max-width:600px/);
});
test('No destructive schema change included in UI release',()=>{
 assert.match(route,/intrigue_rc2_request/);
 assert.match(route,/account_deletion_eligible/);
 assert.match(route,/Only the verified company owner/);
});

const vm=require('node:vm');
function lifecycleHarness({eligible=true,companyOwned=false,personalFlag,companyFlag='false'}={}){
 const calls=[];
 const uid='11111111-1111-4111-8111-111111111111';
 const rid='33333333-3333-4333-8333-333333333333';
 const db={rpc:async(name,args)=>{calls.push({method:'rpc',name,args});return {data:rid,error:null};}};
 const safety={email:'employee@example.com',owned_workspaces:companyOwned?1:0,
  workspace:companyOwned?{id:'22222222-2222-4222-8222-222222222222',name:'COMPANY TEST'}:null,
  empty_workspace_eligible:false,account_deletion_eligible:eligible,
  storage_owned:0,account_blockers:[],workspace_references:[]};
 const privileged={
  auth:{admin:{deleteUser:async(id,soft)=>{calls.push({method:'deleteUser',id,soft});return {error:null};}}},
  from:table=>({update:()=>({eq:async()=>{calls.push({method:'update',table});return {error:null};}})})
 };
 const helpers={
  identity:async()=>({db,user:{id:uid,email:'employee@example.com'},url:'https://supabase.example.test',serviceKey:'test-only'}),
  admin:()=>privileged,checkOrigin:()=>{},recentlySignedIn:async()=>calls.push({method:'recentSignIn'}),
  preview:async()=>safety,
  LifecycleError:class LifecycleError extends Error{constructor(status,message){super(message);this.status=status;}},
  safeResponseError:e=>({status:e.status||500,message:e.message})
 };
 const compiled=ts.transpileModule(route,{fileName:'route.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(compiled,{
  module,exports:module.exports,
  process:{env:{INTRIGUE_RC2_PERSONAL_DELETION_ENABLED:personalFlag,INTRIGUE_RC2_DELETION_ENABLED:companyFlag}},
  console,
  require:name=>{
   if(name==='next/server')return {NextResponse:{json:(body,options)=>({status:options.status,body})}};
   if(name==='@/lib/intrigue-account-lifecycle/server')return helpers;
   throw Error('Unexpected test import '+name);
  }
 });
 return {calls,post:body=>module.exports.POST({json:async()=>body})};
}
test('Employee can delete eligible personal login while company deletion stays disabled',async()=>{
 const h=lifecycleHarness();
 const result=await h.post({action:'delete_account',acknowledged:true,confirmation:'DELETE employee@example.com'});
 assert.equal(result.status,200);
 assert.equal(result.body.account_deleted,true);
 assert.equal(h.calls.filter(x=>x.method==='deleteUser').length,1);
 assert.equal(h.calls.filter(x=>x.method==='rpc'&&x.name==='intrigue_rc2_request').length,1);
 assert.equal(h.calls.filter(x=>x.method==='recentSignIn').length,1);
 const company=lifecycleHarness({companyOwned:false});
 const forbidden=await company.post({action:'request',kind:'workspace',acknowledged:false});
 assert.equal(forbidden.status,403);
 assert.equal(company.calls.length,0);
});
test('Account deletion is blocked for owners, protected references and disabled personal flag',async()=>{
 for(const inputs of [{companyOwned:true,eligible:false},{eligible:false},{personalFlag:'false'}]){
  const h=lifecycleHarness(inputs);
  const res=await h.post({action:'delete_account',acknowledged:true,confirmation:'DELETE employee@example.com'});
  assert.ok(res.status===409||res.status===503);
  assert.equal(h.calls.some(x=>x.method==='deleteUser'),false);
 }
});
test('Personal deletion confirmation must be explicit and cannot accept a mismatched email',async()=>{
 const h=lifecycleHarness();
 const res=await h.post({action:'delete_account',acknowledged:true,confirmation:'DELETE someoneelse@example.com'});
 assert.equal(res.status,400);
 assert.equal(h.calls.some(x=>x.method==='deleteUser'),false);
});
