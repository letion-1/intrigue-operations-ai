'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=f=>fs.readFileSync(f,'utf8');
const page=read('app/help-center/page.tsx');
const api=read('app/api/help-center/route.ts');
const sql=read('sql/INTRIGUE_SUPPORT_FORM_VALIDATION.sql');
const notif=read('sql/INTRIGUE_SUPPORT_NOTIFICATIONS.sql');

test('short subjects including CRM are accepted across client and API',()=>{
 assert.doesNotMatch(page,/minLength=\{5\}|subject\.trim\(\)\.length<5/);
 assert.match(page,/!subject\.trim\(\)/);
 assert.match(page,/Short subjects are welcome, including CRM/);
 assert.doesNotMatch(api,/subject\.length<5|at least five characters/);
 assert.match(api,/const subject=stringValue\(body\.subject,160\)/);
});
test('server and database enforce nonblank bounded input consistently',()=>{
 assert.match(sql,/length\(btrim\(p_subject\)\) NOT BETWEEN 1 AND 160/);
 assert.match(sql,/CHECK \(char_length\(btrim\(subject\)\) BETWEEN 1 AND 160\)/);
 assert.match(sql,/length\(btrim\(p_body\)\) NOT BETWEEN 1 AND 4000/);
 assert.match(page,/required maxLength=\{4000\}/);
 assert.match(api,/const ticketBody=stringValue\(body\.message,4000\)/);
});
test('existing security and rate limits are retained',()=>{
 assert.match(sql,/intrigue_platform_member\(p_actor,p_tenant\)/);
 assert.match(sql,/created_at > now\(\) - interval '1 day'\) >= 15/);
 assert.match(sql,/TO service_role/);
 assert.match(sql,/FROM PUBLIC,anon,authenticated/);
 assert.match(api,/platformAuth\(req\)/);
 assert.match(api,/checkOrigin\(req\)/);
 assert.match(api,/p_actor:ctx\.user\.id/);
});
test('notifications still come from the original ticket insert trigger',()=>{
 assert.match(notif,/intrigue_support_ticket_created_notice/);
 assert.match(notif,/AFTER INSERT ON public\.intrigue_platform_support_tickets/);
 assert.match(sql,/INSERT INTO public\.intrigue_platform_support_tickets/);
 assert.match(sql,/INSERT INTO public\.intrigue_platform_support_messages/);
 assert.doesNotMatch(sql,/DROP TRIGGER.*intrigue_support_ticket_created_notice/);
});
test('friendly inline feedback replaces silently disabled form conditions',()=>{
 assert.match(page,/support-subject-hint/);
 assert.match(page,/support-message-hint/);
 assert.match(page,/subjectTouched/);
 assert.match(page,/messageTouched/);
 assert.match(api,/Daily support ticket limit reached/);
 assert.match(api,/You cannot create a ticket for this company/);
});
test('new TSX and TypeScript files parse correctly',()=>{
 for(const f of ['app/help-center/page.tsx','app/api/help-center/route.ts']){
  const result=ts.transpileModule(read(f),{fileName:f,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve}});
  const errs=(result.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error);
  assert.equal(errs.length,0,f+': '+errs.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; '));
 }
});
