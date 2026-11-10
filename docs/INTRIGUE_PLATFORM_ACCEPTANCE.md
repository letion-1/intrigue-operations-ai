# INTRIGUE Platform: private Admin Control Center + Help Center + approved logo

## What this does

- A private `/platform` dashboard for a seeded platform operator; ordinary company Owners and team roles do **not** inherit access.
- Company counts and status from real Supabase tables.
- Audited company freeze/reactivate actions. Freezes restrict direct signed-in access through restrictive RLS policies and block writes on the explicitly guarded business-operation tables.
- `/help-center` for company members to open and reply to support tickets. The company Owner can view company tickets; Staff and Viewers can view tickets they opened. Platform operators can view and reply to all tickets.
- User-supplied INTRIGUE monogram in favicon, Apple icon, sidebar and landing-page header.
- Existing company-erasure registry updated so new Help Center and freeze tables can be deleted with an owner-approved company closure. Support tickets are included in the company business-data export.

## Boundaries (do not claim features we did not build)

- Freezing is **not** equivalent to globally banning an Auth user. Users with memberships in other workspaces remain able to use those other workspaces.
- Independently hosted workers, unguarded server-side endpoints, queued external calls, and third-party systems may have other paths to perform actions. Their access must be inventoried and explicitly gated before treating freezing as an absolute operational kill switch. In particular, external calls must check status *before* sending, not merely rely on delivery-log triggers.
- No automated billing or payments, email notifications, attachment uploads, SLA timers, chatbot answers, or auto-GDPR erasure of provider backups.
- The platform dashboard is deliberately separate from a company Owner's rights; don't grant every Owner operator access.
- The INTRIGUE operator account is seeded from a **verified existing** Supabase Auth user with email `intriguearts1@gmail.com`. No UUID is entered manually. Changing operators requires a carefully reviewed SQL change in the private table.
- Ticket messages can contain personal data. Do not ask customers for passwords or OAuth tokens. Limit retention and deletion according to policy.

## Installation / rollback

1. Confirm a current verified Supabase backup and that company-data erasure is installed.
2. Execute `sql/INTRIGUE_PLATFORM_ADMIN_HELP.sql` once in Supabase SQL Editor. The final 9 read-only checks must all be true.
3. Run the package installer from the repo root with `--deploy --db-verified`. It checks integrity, backs up the changed files, executes the INTRIGUE tests plus `npm run build`, and commits/pushes only its targets. It will NOT execute SQL or change a company freeze state on installation.
4. If tests or the build fail *before* commit, the installer restores previous local files. After a successful push, revert the targeted commit if needed; do not drop database tables without a retention and migration review.

## Single combined acceptance round (fictional / disposable records only)

1. Vercel deployment shows Ready and `/platform` loads under `intriguearts1@gmail.com`.
2. A different workspace Owner gets `403` calling `/api/platform/console`; credentials are never shared.
3. `/platform` shows the currently existing companies and counts; no deleted NOVA THREADS company reappears.
4. Create an in-app ticket as a Staff account at `/help-center`; it appears in the private operator queue; operator replies; Staff sees the reply.
5. Staff cannot retrieve another employee's ticket or another company's tickets. Company Owner sees their company's tickets.
6. Freeze **only a disposable test company** with a reason; verify owner/admin/staff cannot read/write the guarded business data. The Help Center remains available. Check worker and email integration behavior separately.
7. Reactivate that company; verify ordinary access returns. Audit events are recorded.
8. Compare ORBIT THREAD QA and Northline Auto customer counts before/after; neither should change.
9. Check `/favicon.ico`, `/icon.png`, sidebar and phone browser shortcut for the correct gold/navy INTRIGUE emblem.
10. Make a disposable closure request in the company-deletion module only after checking new support/freeze tables are registered. Verify tickets are deleted with the company and other company tickets survive.

## EU GDPR operations before paying customers

- Publish an accurate privacy notice and data processing agreement (DPA): purposes, controller/processor roles, subprocessors, data location, retention periods, return/deletion at termination, incident response and data-subject request procedures.
- Record an Article 30 processing inventory appropriate to the company's responsibilities.
- Document when backups are overwritten or rendered inaccessible and any legal retention rules; the platform cannot guarantee instant deletion of Supabase historical backups.
- Review connected-provider OAuth revocation/deletion behavior and retention schedules.
- Log and respond to Article 12/17 rights requests promptly; do not confuse a support ticket with a completed legal erasure.
- Use appropriate technical and organizational measures under Article 32. Get EU/German counsel to review before launch. Software tests alone are not GDPR certification.
