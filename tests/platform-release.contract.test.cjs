'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const read=(p)=>fs.readFileSync(p,'utf8');
const sql=read('sql/INTRIGUE_PLATFORM_ADMIN_HELP.sql');
const consoleRoute=read('app/api/platform/console/route.ts');
const helpRoute=read('app/api/help-center/route.ts');
const platform=read('app/platform/page.tsx');
const help=read('app/help-center/page.tsx');
const dashboard=read('app/dashboard/page.tsx');
test('Platform operator identity verified server side',()=>{
 assert.match(consoleRoute,/platformAuth\(req\)/);assert.match(consoleRoute,/mustBeOperator\(ctx\)/);
 assert.match(consoleRoute,/ctx\.user\.id/);assert.doesNotMatch(consoleRoute,/body\.actor_id|body\.user_id/);
});
test('All actions use protected RPCs and validate requested UUIDs',()=>{
 for(const name of ['intrigue_platform_set_freeze','intrigue_platform_reply_ticket','intrigue_platform_ticket_status'])assert.ok(consoleRoute.includes(name));
 assert.match(consoleRoute,/checkOrigin\(req\)/);assert.match(consoleRoute,/uuid\(body\.workspace_id\)/);
});
test('No unauthenticated direct service-role access to support tickets',()=>{
 assert.match(helpRoute,/platformAuth\(req\)/);assert.match(sql,/REVOKE ALL ON public\.intrigue_platform_support_tickets,public\.intrigue_platform_support_messages FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/public\.intrigue_platform_member\(p_actor,p_tenant\)/);
});
test('Operator grant is seeded by verified email, not client-provided UUID',()=>{
 assert.match(sql,/lower\(email\)='intriguearts1@gmail.com'/);assert.match(sql,/email_confirmed_at IS NOT NULL/);assert.match(sql,/private\.intrigue_platform_operators/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.intrigue_platform_is_operator\(uuid\) FROM PUBLIC,anon,authenticated/);
});
test('Suspension blocks direct auth reads and guarded business writes',()=>{
 assert.match(sql,/AS RESTRICTIVE FOR ALL TO authenticated/);
 assert.match(sql,/public\.intrigue_platform_guard_frozen_write/);
 assert.match(sql,/public\.intrigue_v17_runs/);assert.match(sql,/public\.intrigue_mail_deliveries/);
});
test('V21 strict deletion registry covers every new workspace table',()=>{
 for(const name of ['private.intrigue_platform_workspace_controls','public.intrigue_platform_support_tickets','public.intrigue_platform_support_messages'])assert.ok(sql.includes(`'${name}'`));
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.intrigue_v21_export_company/);
});
test('Support functions are not callable directly by authenticated users',()=>{
 for(const name of ['intrigue_platform_new_ticket','intrigue_platform_list_tickets','intrigue_platform_reply_ticket'])assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`));
});
test('Both client and operator portal use bearer auth and real APIs',()=>{
 assert.match(platform,/\/api\/platform\/console/);assert.match(help,/\/api\/help-center/);
 assert.match(platform,/session\.access_token/);assert.match(help,/session\.access_token/);
});
test('Privacy-safe limits on ticket lengths and categories',()=>{
 assert.match(sql,/char_length\(body\) BETWEEN 1 AND 4000/);
 assert.match(sql,/Daily support ticket limit reached/);
 assert.match(sql,/ticket access refused/i);
});
test('Next Cache Components compatible with route handlers',()=>{
 assert.doesNotMatch(consoleRoute,/export const (dynamic|runtime)/);assert.doesNotMatch(helpRoute,/export const (dynamic|runtime)/);
});
test('Dashboard includes Help Center link and local brand mark',()=>{
 assert.match(dashboard,/href="\/help-center"/);assert.match(dashboard,/\/intrigue-mark\.png/);
});
test('Rendered branding files are included',()=>{
 for(const p of ['app/favicon.ico','app/icon.png','app/apple-icon.png','public/intrigue-mark.png'])assert.ok(fs.existsSync(p),p);
 const ico=fs.readFileSync('app/favicon.ico');assert.equal(ico.readUInt16LE(0),0);assert.equal(ico.readUInt16LE(2),1);
});

// Release branding must not introduce obsolete release/debug labels to client pages.
test('New customer-facing portal contains no version or developer traces',()=>{
 for(const page of [platform,help]){
  assert.doesNotMatch(page,/\bV(?:1|2|17|18|19|20|21|22)\b|developer mode|staging preview|demo records/i);
  assert.match(page,/\/intrigue-mark\.png/);
 }
});
test('New public CSS and library names are product-named',()=>{
 assert.ok(fs.existsSync('app/platform-ui.css'));
 assert.ok(fs.existsSync('lib/intrigue-platform.ts'));
 assert.doesNotMatch(read('app/platform-ui.css'),/\.v22\b/i);
});

test('No release/version label in enquiry instructions or workspace footer',()=>{
 const crm=read('app/dashboard/crm/CustomersCRMPanel.tsx');
 assert.doesNotMatch(crm,/existing V17 workflow/);
 assert.doesNotMatch(dashboard,/Demo records in Supabase/);
});
