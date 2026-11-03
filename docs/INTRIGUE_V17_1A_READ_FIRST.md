# INTRIGUE V17.1A — Approval-Gated Workflow Engine Foundation

## Status

This is an **additive developer-stage package**, not the final Automation Centre. It adds an isolated workflow schema and a local audit-only worker. It does **not** modify the existing V11 automation job tables, dashboard, Supabase existing tables, integrations, environment variables, payments, or customer actions.

**Source limitation:** the complete current GitHub working tree was not available to the package builder. Only previously supplied snippets and patches were present. Do not assume compatibility with all current source files. The package is intentionally additive and must first be tested against a separate Supabase staging project.

## Delivered

- `intrigue_v17_workflows`: disabled-by-default definitions; action type restricted to `audit_event`; human approval required.
- `intrigue_v17_runs`: approval states, one event per `(workflow_id,event_key)`, attempts, retry delays, lease tokens and dead-letter status.
- `intrigue_v17_run_events`: immutable-ish append-only events from the service-side RPCs, workspace/run composite foreign key.
- Four service-role-only RPC functions for enqueue, approve, atomic claim, finish.
- Local worker with safety gate. No outbound email/CRM/phone/calendar actions, including no direct customer follow-up writes.
- Node.js unit tests.

## Installation

Run `install.ps1` from the extracted ZIP with the project root as the working directory. It refuses to overwrite files and runs the unit tests. It does not run SQL automatically.

Apply `sql/INTRIGUE_V17_1A_WORKFLOW_ENGINE.sql` in an **isolated staging** Supabase SQL editor. Take a staging backup first. SQL is also pasted inline in the accompanying ChatGPT reply.

Use a separate staging Supabase project and service role key. **Never paste secrets into ChatGPT or commit them**. Do not put the service key in any `NEXT_PUBLIC_*` environment variable. No new Vercel variables are necessary for the normal application because the new engine is not connected to the app yet.

## Local worker smoke test

Windows PowerShell, with **staging credentials only**:

```powershell
cd "$HOME\Projects\intrigue-operations-ai"
$env:SUPABASE_URL = 'https://YOUR-STAGING-PROJECT.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Host 'Staging service_role JWT (hidden)' -AsSecureString | ForEach-Object {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
node tools/intrigue-v17/worker.mjs --once
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

Expected output: `Development worker started` and no run processed until an approved test workflow is queued. Do not use production credentials. The worker only implements internal `audit_event` completion.

## Workflow smoke test, staging SQL editor ONLY

1. Get a synthetic staging workspace id with `select id from public.workspaces limit 5;`.
2. Create a test workflow (manual, approved, enabled) using that workspace UUID.
3. Call `intrigue_v17_enqueue` **in the SQL editor** with a unique event key and `{}` payload. This queues it with `awaiting_approval`.
4. In the SQL editor, approve the run using the real staging workspace owner id as actor; **this is a developer-only test path**, never wire the RPC directly to an untrusted browser.
5. Run the local worker once and verify `status='succeeded'` and an appended run event.
6. Call enqueue with the same event key and verify that it returns the same run ID. No duplicate run should be created.

## Important limits

- SQL roles alone cannot enforce who is permitted to approve a job if server code uses the service key. A future authenticated API must check the user's current workspace membership and role before using the service-only RPC.
- The workflow worker cannot be always-on when the laptop is off. No Vercel cron or Render deployment is configured.
- This is **not yet** real CRM, Gmail, Outlook, Vapi, calendar, scheduled triggers or AI actions.
- Approval is mandatory in this release. Disable/automatic mode intentionally cannot be selected.
- SQL was inspected but **not executed against a live Supabase database** in the package-building environment. Run migration and acceptance tests in staging and inspect errors before production use.

## Coming next

V17.1B: authenticated workspace-bound workflow endpoints, owner/admin approval, audit viewer integrated into Automation Centre, triggers for enquiries and missed calls (internal only at first), then provider action adapters one by one with approval and idempotency.
