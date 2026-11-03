# INTRIGUE V17.1B · Automation Centre Dashboard

## Scope

Built against the exact `INTRIGUE_V17_1B_SOURCE.zip` supplied by the project owner.

- Add an Owner/Admin-only V17 Automation Centre panel under the existing sidebar section.
- Preserve the legacy V11 UI and queue inside a collapsed **Legacy** section.
- Create up to 50 manual `audit_event` workflows per workspace (new workflows are disabled by default).
- Enqueue manual test runs (up to 100 per workspace/hour), protected by a unique event key.
- Require explicit Owner/Admin approval before the V17 local worker can execute a run.
- Display run statuses, retry windows, errors and recent audit events.
- Cancel pending/queued/retry-wait jobs atomically, retry approved dead-letter jobs atomically.
- No external integration writes, email, booking, WhatsApp, phone calls or CRM mutations.

## Installation sequence

1. Back up your Git working tree and confirm the latest V17.1A commit is present.
2. Run `install.ps1`. It checks the original dashboard hash, copies only listed source files,
   runs static/unit tests and builds Next.js. On failure, the script restores the original
   dashboard and removes newly added files.
3. Apply `sql/INTRIGUE_V17_1B_RUN_CONTROLS.sql` to an *isolated staging Supabase database*
   with V17.1A already installed. It only adds the two service-only control functions.
4. Check the two functions exist using the SQL below.
5. Run the local worker separately using a server-only service key, after creating and
   approving a test run. Do not paste or expose credentials in chat or committed files.
6. Test two separate workspace accounts plus a revoked account before deploying.
7. Commit/push ONLY after your build and tests pass.

## Verification SQL (read only)

```sql
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('intrigue_v17_cancel','intrigue_v17_retry')
ORDER BY p.proname;
```

Expect both functions, with security_definer=true and an empty search_path.

## UI acceptance test

1. Open Automation Center as company Owner. New V17 panel must be visible.
2. Create `Quotation audit test`; it starts **Disabled**.
3. Enable it, queue one internal run. It must be **Awaiting approval**.
4. Verify the worker cannot run it before approval.
5. Approve it; with the V17 local worker running, expect **Succeeded**.
6. Inspect **Execution history**; see enqueued, approved, claimed and succeeded events.
7. Queue another run, cancel before approval; it must not run.
8. Confirm a Viewer/Staff user cannot access the new API and Admin can.
9. As owner in Workspace B, attempt a Workspace A run ID; expect 404/403, no mutation.
10. Ensure Gmail, Outlook, calendar and legacy V11 demo queue still function.

## Important release limits

- A successful source build is not an end-to-end security test.
- There are no real event webhooks, schedules, email/CRM/voice actions, bulk run operations
  or automatic local-worker hosting in this release.
- The Supabase database used in screenshots was marked PRODUCTION. Do not use real
  customer records for V17.1B tests. Prefer a separate staging Supabase project.
- Existing V17.1A service-role functions remain unchanged.
- Avoid adding Render or paid worker hosting during development.


## FIX1 compatibility note

The original V17.1B package used unsupported route-segment config exports
under `cacheComponents: true` in Next.js 16.4.3. FIX1 removes them; Next.js
uses the default Node.js runtime for this route, and response caching is
explicitly disabled with the `Cache-Control: no-store` response header.
The existing partialPrefetching config warning is non-fatal and unchanged.
