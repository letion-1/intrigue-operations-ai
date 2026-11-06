# INTRIGUE Sprint 1 RC2.2 | Privacy, withdrawal and stable dashboard startup

**Target:** Existing `Ai_automation` Supabase and `intrigue-operations-ai` GitHub/Vercel project already running RC2.1. No new project needed.

## Included

- Personal withdrawal of a pending erasure *review request*. Requires exact `WITHDRAW <request-id>` typed confirmation. It does not erase any data.
- PostgreSQL guard against conflicting account and company review requests, including concurrent attempts. Identical pending requests reuse their ID.
- Display request status and a safe public response. Internal reviewer notes are not available to authenticated clients.
- Operator-only review recording and event log. No cross-company administrator website, automated review or actual erasure executor is added.
- Temporary wrong-theme and fake-company screen eliminated by showing a consistent branded startup screen until saved appearance and first workspace lookup complete.
- The existing `INTRIGUE_RC2_DELETION_ENABLED=false` Production safety flag must remain disabled.

## Install order

1. Download RC2.2 ZIP into Windows Downloads, extract, and run `install-rc22.ps1` in VS Code PowerShell. It validates the exact baseline and writes backups to `~/INTRIGUE-backups/`. **Stop on checksum mismatch** and never use `git add -A`.
2. Run `node --test tests/rc2.contract.test.cjs tests/rc21.contract.test.cjs tests/rc22.contract.test.cjs` and `npm run build`.
3. In **existing** Supabase SQL Editor, review and apply the complete `sql/INTRIGUE_SPRINT1_RC22_PRIVACY_SAFETY.sql` migration. It changes constraints and functions but does not delete records. A verified backup is recommended; user previously opted to proceed without one, which increases risk.
4. Run the read-only security verification below. Apply the SQL **before deploying the new source**, because GET now selects `public_message`.
5. Stage only the 9 RC2.2 paths from the manifest, commit, push to GitHub, and check Vercel Ready. Production deletion must remain disabled.

## Verify function permissions

```sql
SELECT
  has_function_privilege('authenticated','public.intrigue_rc22_withdraw_request(uuid,text)','EXECUTE') AS can_withdraw_own_pending,
  has_function_privilege('anon','public.intrigue_rc22_withdraw_request(uuid,text)','EXECUTE') AS anon_can_withdraw,
  has_function_privilege('authenticated','public.intrigue_rc22_operator_review(uuid,text,text,text,text)','EXECUTE') AS client_can_operate,
  has_function_privilege('authenticated','public.intrigue_rc2_delete_empty_workspace(uuid,uuid,text)','EXECUTE') AS client_can_delete_directly,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.intrigue_rc22_review_events'::regclass) AS review_log_rls;
```

Expected: `true`, `false`, `false`, `false`, `true`. Also test with real authenticated accounts: `auth.uid()` must restrict withdrawal to the request owner; a database superuser test cannot establish that.

## Operator review, no erasure

An authorized operator must **monitor real requests** and make case-by-case decisions, including contacting relevant controllers and considering retention and deadline duties. The new RPC does not delete data, execute erasure or allow claiming completion.

```sql
-- Private read-only operator queue
SELECT id,kind,status,workspace_label,requested_at,response_due_at,public_message
FROM public.intrigue_rc2_requests
WHERE status IN ('needs_review','reviewing','failed')
ORDER BY response_due_at,requested_at;
```

Once identity and request legitimacy are verified, a privileged SQL Editor operator may record an initial review:

```sql
-- Illustrative ONLY, replace with a real ID and accurate notes.
SELECT public.intrigue_rc22_operator_review(
  '00000000-0000-4000-8000-000000000001'::uuid,
  'reviewing', 'authorized-privacy-reviewer',
  'Identity verified and retention analysis initiated.',
  'Your request is under review. No deletion has occurred.'
);
```

Allowed transitions: `needs_review -> reviewing`, `reviewing -> needs_review/rejected`. A rejection requires a justified reason, not merely cleaning up an overdue queue. Individual events are recorded in `intrigue_rc22_review_events` and hidden from end users. `completed` is **not** an option in this review RPC.

## Acceptance

- Refresh light and dark dashboard: first paint is branded loading, then correct saved theme and workspace. No fake company/sidebar.
- In Privacy Request History: a `needs_review` request shows **Withdraw this request**.
- Exact typed confirmation and acknowledgement required; withdrawal changes status to `withdrawn`, without deleting any records.
- Another identity cannot withdraw this request or access the internal operator note.
- New overlapping request is blocked at the database layer; exact duplicate returns original ID.
- All pre-existing Northline Auto/other workspace data still exists, CRM connections still work.
- Direct deletion remains unavailable with Production deletion flag `false`.

## Limits

RC2.2 is **not** full GDPR compliance. It does not automatically review real requests, email customers, erase nonempty companies, purge storage or backups, revoke external OAuth tokens, or implement a privileged platform-owner web console. Those require separate security and operational work. Existing personal export is not a full company-data export.
