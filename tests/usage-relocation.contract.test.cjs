'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=process.cwd();
const read=file=>fs.readFileSync(path.join(dir,file),'utf8');
test('Integrations retains provider credentials and mode controls, but no usage cards',()=>{
 const s=read('app/dashboard/integrations/AiConnectionsPanel.tsx');
 assert.match(s,/AI provider connections/);
 assert.match(s,/action:'connect'/);
 assert.match(s,/action:'disconnect'/);
 assert.match(s,/action:'mode'/);
 assert.doesNotMatch(s,/Math\.ceil\(state\.usage\.voice_seconds/);
 assert.doesNotMatch(s,/\{usd\(state\.usage\.text_usd\)\}/);
});
test('Security & Usage reuses the same authenticated, workspace-scoped provider usage endpoint',()=>{
 const s=read('app/dashboard/security/AiUsagePanel.tsx');
 const page=read('app/dashboard/page.tsx');
 assert.match(s,/api\/ai-control\?workspace_id/);
 assert.match(s,/Authorization:'Bearer '\+data\.session\.access_token/);
 assert.match(s,/cache:'no-store'/);
 assert.match(s,/window\.setInterval/);
 assert.match(page,/section === "Security & Usage" && workspace && isOwner/);
 assert.match(page,/<AiUsagePanel key=\{workspace\.id\} workspaceId=\{workspace\.id\} \/>/);
 assert.match(page,/supabase\.rpc\("get_intrigue_ai_usage"\)/);
});
test('Data Management retains owner gating and backup confirmation, blocks empty replacements',()=>{
 const s=read('app/dashboard/data-management/DataManagementPanel.tsx');
 const page=read('app/dashboard/page.tsx');
 assert.match(page,/section === "Data Management" && workspace && isOwner/);
 assert.match(page,/<DataManagementPanel key=\{workspace\.id\}/);
 for(const name of ['intrigue_dm_preview','intrigue_dm_prepare','intrigue_dm_download','intrigue_dm_execute'])assert.ok(s.includes(name));
 assert.match(s,/rows\.length===0/);
 assert.match(s,/!preview\|\|/);
 assert.match(s,/!downloaded\|\|!acknowledged\|\|phrase!==confirmation/);
 assert.match(s,/Read-only workspace preview/);
 assert.match(s,/separate from AI voice usage and billing/);
});
test('Read-only SQL audit contains no destructive database statements',()=>{
 const sql=read('sql/INTRIGUE_DM_READ_ONLY_AUDIT.sql').replace(/--[^\n]*/g,'').trim();
 assert.match(sql,/pg_proc/);
 assert.doesNotMatch(sql,/\b(CREATE|ALTER|DROP|TRUNCATE|DELETE|INSERT|UPDATE|CALL|DO|REVOKE|GRANT)\b/i);
});
