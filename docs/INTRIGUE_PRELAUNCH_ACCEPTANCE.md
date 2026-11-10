# INTRIGUE Operations Intelligence | Final prelaunch acceptance

This document is internal, not customer-facing. Do not claim commercial readiness from build output alone.

## Scope of this release

- Responsive CSS, keyboard focus and touch targets in the existing light/dark themes.
- Plain-language network outage and uncaught-error pages.
- Reduced information exposure through HTTP security headers, with a limited public liveness route.
- A local supervisor that executes the **existing** approval-controlled V17 worker serially, locks out duplicate supervisors and stops after repeated failures.
- A repeatable security audit and non-destructive live HTTP checks.
- A brand icon generator that uses your uploaded PNG, preserves the artwork and adds transparent padding. It runs **only on explicit `--apply`**.

## Still requires external hosting or manual verification

- The local worker only runs while its machine is powered on and executing the supervisor. Before promising any 24/7 client SLA, install it on continuously running infrastructure with appropriate environment secrets, monitoring and operational ownership.
- Independently hosted Vapi, CRM or calendar integrations must be verified to respect workspace freeze and delete states. This package does not claim to switch off those providers.
- Test two-workspace isolation and approval-only email sends using fictional data, without bypassing RLS.
- GDPR retention, restored backups, legal holds and external-provider erasure need documented procedures and review. A live database deletion is not proof all copies were erased.

## One combined acceptance test

1. Check Vercel says Ready for the installed commit. Run `node tools/intrigue-prelaunch/live-check.mjs https://YOUR_DOMAIN`.
2. Open `/dashboard`, `/help-center`, `/platform/login` and `/platform` at 390px (phone), 768px (tablet), and desktop width. Inspect both themes. No horizontal clipped form controls or missing actions.
3. Test the client and separate admin logins, logout, and direct API denial for client users on `/api/platform/console`. The private admin must have no workspace membership.
4. Confirm ORBIT THREAD QA and Northline Auto remain isolated. Admin, Staff and Viewer may only perform their permitted actions.
5. In a **disposable workspace**, create a pending approved-job test, freeze it, and check no database writes, external sends, calendar bookings, or worker jobs can proceed. Reactivate and confirm recovery. Do not assume a green freeze badge guarantees external shutdown.
6. Create a short-subject Help Center ticket and verify administrator unread notification, reply, resolution, client unread notification, and mark-read persistence.
7. Confirm no quote is emailed before explicit approval. Test only with a sender and recipient you control.
8. Run the worker supervisor on a running test host. Confirm only approved jobs are processed, no duplicate claim, restart backoff on simulated errors, and full stop on repeated failures.
9. Test offline banner in browser DevTools Offline mode. Confirm failures show actionable UI errors and no false success states.
10. If you supply the final transparent logo, run `node tools/intrigue-prelaunch/prepare-brand.mjs --apply`. Confirm favicon, app icon and Apple touch icon after a fresh browser session. The original public PNG is not rewritten by this script.
11. Confirm there are no customer-facing developer/release/version/starter/demo labels, and record any remaining ones.
12. Perform a pilot with 1 to 3 clients only after all high-risk checks pass. Use manual invoices until billing is implemented and verified.

## Recommended user-visible labels

- INTRIGUE Operations Intelligence
- Admin Control Center
- Help Center
- Workspace access temporarily suspended
- You're offline. Changes may not save until you reconnect.

Avoid any release code names or development terminology in client UI. Internal code and migration filenames can remain for traceability.
