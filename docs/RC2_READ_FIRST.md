# INTRIGUE Operations AI — Sprint 1 RC2 Account & Workspace Lifecycle

**Status: integration candidate, NOT production approved.** Based on the user's 205-file Sprint1 source export (pre-RC1) plus unchanged account module. RC1 changed other files only. No live Supabase migration, functional account-deletion run, or Next.js production build has been performed by this package's author. Back up data, install only into current `b2995c7` branch and run a complete build and staging tests first.

## Included
- Customer-facing Privacy & Account Deletion section, preserving the existing `AccountDeletionPanel` mount in dashboard Settings.
- Server-authenticated personal-account JSON export (not a complete business DSAR or data portability archive).
- Auth-bound GDPR erasure *requests*, with status/history and 1-month response target. Requests are **not** automatically processed. An authorized operator must review them.
- A standalone `/account/privacy` page remains available after an owner transfers a company and loses workspace access.
- Two-party company ownership transfer. Owner nominates an existing member; recipient signs in and accepts at `/transfer-ownership`. The transfer reassigns work item ownership in the same workspace transaction and removes the old owner's membership.
- Strict self-service deletion for **empty workspaces only** (no business records, other members or user-owned Storage files). Nonempty companies must be reviewed manually.
- Automatic account deletion only after user signs in recently, explicit phrase confirmation, full FK preflight, and zero user-owned Storage files. Server-only Supabase privileged key.
- SQL-level privacy request history with RLS, additive migration and dynamic FK safety scan.
- Built-in syntax/contract tests. No Render, no paid job host, no change to CRM, AI, Vapi, calendars or quotation logic.

## Install order
1. **Back up Supabase production project before schema changes.** Verify source/backup availability. Test in a separate staging project first.
2. Install the source patch with `install-rc2.ps1` from your repo root. It verifies current account-file checksums and saves originals externally. Do not override a checksum failure.
3. Run `npm run build` and existing tests; stop if either fails.
4. In Supabase SQL Editor, run the **entire** `sql/INTRIGUE_SPRINT1_RC2_ACCOUNT_LIFECYCLE.sql` once, then inspect all created functions and grants. No workspace is deleted by migration.
5. For pre-deployment staging, set **`INTRIGUE_RC2_DELETION_ENABLED=true` only in staging**. This gate defaults OFF, so production can receive the migration and UI without enabling deletion. After all acceptance gates pass, set it true in Production and redeploy. Confirm the Vercel **server-only** `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` is available. Never use `NEXT_PUBLIC_` for secret keys.
6. Verify `INTRIGUE_APP_URL` is set to the canonical dashboard domain. Preview/prod environment selections should match where you test.
7. In PowerShell, run `node --test tests/rc2.contract.test.cjs` (TypeScript comes from the project's dev dependencies). Run `npm run build`; no errors accepted.
8. Commit only explicit files and push. Verify Vercel Ready. Keep feature in internal test until all acceptance gates below pass.

## Acceptance gates (all in disposable staging)
- [ ] Viewer / Staff cannot request workspace deletion, nominate ownership, or access another company’s requests, including direct HTTP/RPC attempts.
- [ ] A user with no company, no RESTRICT FK refs and no owned Storage can export and delete their account after a newly created, same-session sign-in. UI redirects after a verified Auth deletion.
- [ ] Account deletion is refused after 10 minutes since session creation; signing in again permits explicit confirmation.
- [ ] An owner with business records cannot use automatic company deletion; submitting request creates a private review queue item, not a silent delete.
- [ ] A truly empty isolated test workspace is deleted with the exact phrase; nearby workspace rows and files remain untouched.
- [ ] Protected backups, document approvals, CRM contacts, automation runs or owned Storage files prevent automatic company deletion.
- [ ] Owner selects active existing team member, new owner accepts, company and work items remain intact, old owner loses access.
- [ ] Transfer cannot be accepted by a third party or reused after 48 hours.
- [ ] Deleted Auth user cannot reconnect to business data with an unexpired JWT; verify live server and RLS denials.
- [ ] Request records display reference, response target and status. Confirm queue is actively monitored.
- [ ] Verify migration, logout, transfer and deletion while storage objects are present. Test failure + safe retry.
- [ ] Confirm actual third-party token revocation and vendor data deletion steps in the operator process.

## Manual review: the needed operational step (until platform Admin console exists)
**Important**: a 'needs_review' request doesn't automatically send an email, stop a worker, revoke third-party OAuth tokens, erase retained invoices, delete Storage files, or close a legal case. The company controller/operator must assess legal holds and data processing responsibilities; document completion/retention and notify the requester. Review the queue **daily**, not at the end of a month.

Read-only request queue in Supabase SQL Editor:

```sql
SELECT id, kind, status, requested_at, response_due_at, workspace_label
FROM public.intrigue_rc2_requests
WHERE status IN ('needs_review','failed','workspace_deleted')
ORDER BY response_due_at,requested_at;
```

Do NOT mark a request `completed` without verifying the actual deletion / retention outcome. No direct SQL `DELETE FROM storage.objects` is allowed. Use Storage API to delete real files. A verified, time-limited encrypted backup is needed for data integrity and recovery before deleting nonempty companies. Retention periods and processing contracts need legal review.

## Known limitations
- Nonempty workspace erasure is deliberately **reviewed**, not automatic, because this production schema includes many RESTRICT and CASCADE dependencies, private backups, and potential retention duties. The full automatic erasure processor, operator review console, external revocation checks, backup deletion/recovery playbook, and statutory subject-rights reporting require further work.
- Company export uses the existing Data Management functionality. It does **not** provide a comprehensive GDPR portability/export response in this release.
- Request handling has no background queue worker. The operator must actively monitor the SQL queue. The `response_due_at` date is a tracking target, not a promise of automatic fulfillment.
- `auth.admin.deleteUser()` may still encounter unexpected triggers and storage ownership issues. Handle and retain the error, never claim success on failure.
- GDPR compliance is a legal and operational obligation; app code alone does not establish compliance.
- Build has to be run on user's Windows environment; this environment lacks all npm dependencies to run a complete Next.js build.

## Compliance sources
- https://gdpr-info.eu/art-12-gdpr/
- https://gdpr-info.eu/art-17-gdpr/
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/storage/management/delete-objects

## Safe rollout flag

`INTRIGUE_RC2_DELETION_ENABLED` defaults to disabled. Staging verification requires `true`. Do not enable it for paying users before verifying this migration, security review, and actual deletion behavior on fake tenant records. The personal account summary export is still accessible while deletion actions are disabled.
