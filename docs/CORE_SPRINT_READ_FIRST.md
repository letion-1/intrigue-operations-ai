# INTRIGUE Core Sprint: Consolidated Support, Queue & Gmail Fix

This package is based on the Nov 7 source export and the RC2.4.2 `main` dashboard source. It does **not** contain your .env files, customer records, OAuth tokens, or Supabase secrets.

What changes:
- A human-approved, successfully routed exchange/order-status/return/stock/support analysis creates **one** internal, linked follow-up, with 48-hour default due date. No retroactive backfill; your manually completed tasks remain untouched.
- Each follow-up carries a source enquiry and run ID. Owner/Admin can assign it only to active members in the same company; the UI allows the owner to assign and open the source enquiry.
- The dev worker uses a fair, lease-aware cross-workspace claim instead of always selecting the oldest job globally. The separate `run-specific.mjs` remains untouched.
- Gmail OAuth state remains single-use but the validity window grows from 10 to 20 minutes, and every known result gets a visible in-app explanation. `expired_state` can still legitimately occur if the flow is replayed, delayed beyond 20 minutes, or misconfigured. Reconnect from Integrations using a fresh authorization.
- **No email is sent automatically**; quote approval and delivery confirmation remain independent.

## Installation order
1. The installer checks exact source hashes and makes timestamped copies; it does not call Supabase or GitHub.
2. Run `node --test tests/core-sprint.contract.test.cjs` and `npm run build` in your project.
3. Paste the complete `sql/INTRIGUE_CORE_SPRINT_SUPPORT_GMAIL_QUEUE.sql` into your existing **Ai_automation** Supabase project's **SQL Editor**. Only after its success should you deploy source that selects the newly added columns / uses `intrigue_v17_claim_fair`.
4. Verify the migration with `sql/INTRIGUE_CORE_READ_ONLY_VERIFY.sql`.
5. Push a reviewed commit to `main`, then wait for Vercel Ready. Keep `INTRIGUE_RC2_DELETION_ENABLED=false`.

## Test after deployment
1. ORBIT THREAD QA: create a NEW fictitious customer exchange enquiry and approve its analysis. The existing historical Jamie/Alex jobs are already complete, so they will not be automatically backfilled.
2. Run the existing `run-specific.mjs` against the new run ID, or run the fair worker once when suitable. Refresh Follow-ups. One linked Pending task should appear with due date about 48 hours from processing.
3. Re-process or replay the same run only in isolated QA with a safe test harness. The partial unique index prevents duplicate auto follow-ups.
4. Click View enquiry and verify it opens the correct CRM Enquiries tab. Assign a team member and refresh; try a member from another company and confirm it is rejected.
5. Run `node --env-file=.env.local tools/intrigue-core/diagnose-gmail.mjs` locally (no secrets printed) to confirm the expected callback. Start a NEW Gmail connection from Integrations -> Business email. Complete the Google authorization promptly in the same browser. If `expired_state` persists, check the authorized redirect URI (`INTRIGUE_APP_URL/api/mail/google/callback`), deployment settings and server logs; don't weaken OAuth single-use checks.
6. Sending tests only to your own verified inbox, after explicit review and final confirmation. Never send to `example.com` fictional customers.

## Safety / limitations
- This is a source/contract-tested release candidate, NOT a fully verified production release. Database trigger and multi-client OAuth tests require your actual Supabase environment and Vercel deployment.
- Do not run the SQL or approve integrations without reviewing backup readiness. A production backup is not yet verified. The migration is additive and doesn't wipe existing records, but schema changes still carry risk.
- The offline localization branch stays paused and untouched.
