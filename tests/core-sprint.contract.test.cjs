'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => { const direct=path.join(root,p); return fs.readFileSync(fs.existsSync(direct)?direct:path.join(root,'source',p),'utf8'); };
const sql = read('sql/INTRIGUE_CORE_SPRINT_SUPPORT_GMAIL_QUEUE.sql');

test('updated TypeScript pages and Google OAuth routes are syntactically valid', () => {
  for (const name of [
    'app/dashboard/page.tsx',
    'app/dashboard/crm/CustomersCRMPanel.tsx',
    'app/api/mail/google/start/route.ts',
    'app/api/mail/google/callback/route.ts',
  ]) {
    const src = read(name);
    const transpiled = ts.transpileModule(src, {
      fileName: name, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022 },
    });
    const errors = transpiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${name}: ${errors.map(e => e.messageText).join('; ')}`);
  }
});

test('approved, verified support route creates an internal task only', () => {
  assert.match(sql, /NEW\.approved_at IS NULL/);
  assert.match(sql, /classification_source' IS DISTINCT FROM 'v17\.2b'/);
  assert.match(sql, /NEW\.result->>'outcome' IS DISTINCT FROM 'routed'/);
  assert.match(sql, /v_intent NOT IN \('exchange','order_status','refund_return','stock_check','support'\)/);
  assert.match(sql, /wf\.action_type = 'quotation_draft'/);
  assert.match(sql, /wf\.requires_approval = true/);
  assert.match(sql, /e\.workspace_id = NEW\.workspace_id/);
  assert.match(sql, /INSERT INTO public\.follow_ups/);
  assert.doesNotMatch(sql, /INSERT INTO public\.quotations/);
  assert.doesNotMatch(sql, /https?:\/\//);
});

test('follow-up dedupe and protected source metadata are enforced in SQL', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS intrigue_core_followup_source_once/);
  assert.match(sql, /ON CONFLICT \(workspace_id, source_enquiry_id\)/);
  assert.match(sql, /source_enquiry_id IS DISTINCT FROM OLD\.source_enquiry_id/);
  assert.match(sql, /Assignee must be an active owner\/admin\/staff member/);
  assert.match(sql, /Only the owner or admin can assign tasks/);
});

test('workflow worker uses fair claim without external action', () => {
  const src = read('tools/intrigue-v17/worker.mjs');
  assert.match(src, /rpc\('intrigue_v17_claim_fair'/);
  assert.match(src, /approval-required/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.intrigue_v17_claim_fair/);
  assert.match(sql, /FOR UPDATE OF r SKIP LOCKED/);
  assert.match(sql, /leased_until=now\(\)\+pg_catalog\.make_interval/);
});

test('Gmail OAuth retains single-use state security and gives recoverable errors', () => {
  const start=read('app/api/mail/google/start/route.ts');
  const cb=read('app/api/mail/google/callback/route.ts');
  const dash=read('app/dashboard/page.tsx');
  assert.match(start, /state_hash: sha\(state\)/);
  assert.match(start, /20 \* 60_000/);
  assert.match(cb, /is\('consumed_at', null\)/);
  assert.match(cb, /\.gt\('expires_at'/);
  assert.match(cb, /return redirect\('expired_state'\)/);
  assert.match(dash, /const gmailResult = params\.get\("gmail"\)/);
  assert.match(dash, /Connect Gmail to start a fresh/);
  assert.match(dash, /setSection\("Integrations"\)/);
});

test('follow-ups link source enquiry and support safe team assignment', () => {
  const dash=read('app/dashboard/page.tsx');
  const crm=read('app/dashboard/crm/CustomersCRMPanel.tsx');
  assert.match(dash, /source_enquiry_id,source_intent,assigned_to/);
  assert.match(dash, /assignFollowUp\(id: string, assignedTo: string\)/);
  assert.match(dash, /View enquiry<\/button>/);
  assert.match(crm, /highlightEnquiryId\?: string \| null/);
  assert.match(crm, /setActiveTab\('enquiries'\)/);
});
