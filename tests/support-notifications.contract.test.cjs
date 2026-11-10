'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const read=f=>fs.readFileSync(f,'utf8');
const sql=read('sql/INTRIGUE_SUPPORT_NOTIFICATIONS.sql');
const api=read('app/api/support-notifications/route.ts');
const client=read('app/dashboard/SupportNotifications.tsx');
const dash=read('app/dashboard/page.tsx');
const operator=read('app/platform/page.tsx');
const help=read('app/help-center/page.tsx');
test('new support requests, client replies, operator replies and resolutions emit notifications via database triggers',()=>{
 for(const key of ['intrigue_support_ticket_created_notice','intrigue_support_message_notice','intrigue_support_ticket_status_notice'])assert.match(sql,new RegExp(key));
 for(const key of ['new_ticket','client_reply','support_reply','status_resolved','status_closed'])assert.match(sql,new RegExp(key));
 assert.match(sql,/ON CONFLICT\(source_message_id\) DO NOTHING/i);
});
test('initial client message does not duplicate new-ticket alert',()=>assert.match(sql,/older\.id<>NEW\.id/));
test('client notifications respect the same ticket visibility rule as Help Center',()=>{
 assert.match(sql,/intrigue_platform_can_view_ticket\(p_actor,n\.ticket_id,false\)/);
 assert.match(sql,/intrigue_platform_member\(p_actor,p_workspace\)/);
 assert.match(sql,/n\.workspace_id=p_workspace/);
});
test('operator notifications require dedicated administrator identity and reject client memberships',()=>{
 assert.match(sql,/intrigue_platform_is_operator\(p_actor\)/);
 assert.match(sql,/public\.workspace_memberships WHERE user_id=p_actor/);
 assert.match(api,/await mustBeOperator\(ctx\)/);
});
test('database restricts browser access and only service_role executes read/mark RPCs',()=>{
 assert.match(sql,/REVOKE ALL ON public\.intrigue_support_notifications FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.intrigue_support_notifications_list\(uuid,boolean,uuid,integer\) FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.intrigue_support_notification_mark_read\(uuid,uuid,boolean,uuid\) TO service_role/);
});
test('reads are per-user and server-validated; no recipient UUID accepted in API payload',()=>{
 assert.match(sql,/PRIMARY KEY \(actor_id,notification_id\)/);
 assert.match(api,/p_actor:ctx\.user\.id/);
 assert.match(api,/uuid\(body\.notification_id\)/);
 assert.doesNotMatch(api,/body\.actor_id|body\.user_id|body\.workspace_id/);
});
test('workspace data erasure registry updated and closing-workspace guard installed',()=>{
 assert.match(sql,/intrigue_v21_supported_tables/);
 assert.match(sql,/CREATE TRIGGER intrigue_v21_stop_closing_writes/);
});
test('both consoles have unread bell; current notifications placeholder removed',()=>{
 assert.match(dash,/<SupportNotifications[^>]*audience="client"/);
 assert.match(operator,/<SupportNotifications audience="operator"\/>/);
 assert.doesNotMatch(dash,/Notifications appear here when connected services report an event/);
 assert.match(client,/unread_count/);
 assert.match(client,/30000/);
 assert.match(help,/setOpenTicket\(id\)/);
 assert.match(operator,/setActiveTicket\(id\)/);
});
test('all introduced or modified TypeScript/TSX has valid syntax',()=>{
 for(const file of ['app/api/support-notifications/route.ts','app/dashboard/SupportNotifications.tsx','app/dashboard/page.tsx','app/platform/page.tsx','app/help-center/page.tsx']){
  const src=read(file);
  const result=ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.Preserve}});
  const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,file+': '+errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; '));
 }
});
