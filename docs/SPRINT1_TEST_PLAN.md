# INTRIGUE Sprint 1 RC1: installation and acceptance tests

This is a consolidated **release candidate**, not a claim that Sprint 1 is completely finished.

## What the package changes
- Unifies customer-facing navigation by taking the old Action Centre out of the sidebar and preserving its existing approvals under Automation Centre.
- Removes customer-facing version and development labels in the major dashboard and enquiry workflow pages.
- Improves sidebar and dashboard layout, mobile spacing, focus styles, and both theme overrides.
- Removes the duplicate CSV import from Integrations. The CRM contact importer remains in Customers & CRM.
- Adds **read-only OAuth authorization** and **explicit add-only contact imports** for Zoho, HubSpot and Pipedrive, using server-side encrypted credentials and Owner/Admin authorization.
- Adds CSV or XLSX upload to Customers & CRM. The first worksheet and up to 200 contacts are supported.
- Preserves existing Gmail, Outlook, Vapi, Calendly, Cal.com, Google Calendar, onboarding, quotations, automation and knowledge modules.

## Not finished in this release
- Production OAuth verification with accounts from all 3 CRM platforms (requires provider client IDs/secrets, callback registration and test accounts).
- Pagination/full-history CRM migration and bidirectional sync. **Only the first 100 provider contacts** are previewed per connection. Do not describe this as a full CRM sync.
- Source-agnostic extraction of all business records from arbitrary PDF/Word files, beyond existing onboarding/knowledge capabilities.
- A full visual redesign of every module or a complete accessibility audit.
- Customer support tickets and Platform Admin (Sprint 2).
- Full production security penetration testing, automated billing and always-on worker hosting.

## Installation order
1. Create a fresh Git checkpoint before installation (`git status` and a local commit for wanted changes).
2. Extract the installer ZIP **outside** your project and run `install.ps1`. Installer checks exact source SHA256 of every changed file and stops on mismatch.
3. Installer creates backup, copies the integrated source, installs `read-excel-file@9.3.14`, executes the Node tests and runs `npm run build`.
4. **Do not push or deploy** if build/tests fail. The installer attempts to restore all changed files on failure.
5. Back up the *intended* Supabase project and apply **sql/INTRIGUE_SPRINT1_CRM_CONNECTIONS.sql**. Do not execute it against an unknown or shared production project.
6. Add the OAuth variables listed below to Vercel securely. Do not paste secrets in chat or commit them.
7. Validate CRM callback domains in the three provider dashboards, **then** deploy the reviewed code to Vercel.

## New environment variables (Vercel server side only)
- `INTRIGUE_APP_URL=https://<YOUR_CANONICAL_VERCEL_DOMAIN>` (existing Gmail integration may already use this).
- `INTRIGUE_CRM_ENCRYPTION_KEY`: generate **32 random bytes, Base64-encoded** with the command below. Use the same value across deployments, keep it off the client and back it up securely.
- `INTRIGUE_ZOHO_CLIENT_ID`, `INTRIGUE_ZOHO_CLIENT_SECRET`, `INTRIGUE_ZOHO_REGION=eu`.
- `INTRIGUE_HUBSPOT_CLIENT_ID`, `INTRIGUE_HUBSPOT_CLIENT_SECRET`.
- `INTRIGUE_PIPEDRIVE_CLIENT_ID`, `INTRIGUE_PIPEDRIVE_CLIENT_SECRET`.

Generate encryption key locally in PowerShell:
```
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```
Do not set any CRM secret as `NEXT_PUBLIC_*`.
Register **exactly** this callback URL in all three OAuth apps:
```
https://<YOUR_CANONICAL_VERCEL_DOMAIN>/api/integrations/crm/callback
```
For Zoho EU, use the EU data centre; HubSpot request contacts.read; Pipedrive authorize read access in the provider app. Redirect URI must match exactly. A CRM provider may require approval or application verification to allow customers outside your developer account.

## Testing, in order
1. **UI:** sign in on Vercel, check overview/sidebar, responsive mobile, both themes, AI receptionist, quotation, onboarding and customer screens. There should be no old Action Centre nav or version banner. Existing approvals must remain accessible in Automation Centre.
2. **New CRM database tables:** run `SELECT count(*) FROM public.intrigue_crm_connections;` in SQL Editor. Check that anon/authenticated roles cannot select token columns.
3. **OAuth test per provider:** log in as a workspace owner, go to Integrations → Connect CRM, authorize, return to dashboard and check Connected. Repeat with a Viewer, which must fail.
4. **Contacts:** Preview should list **at most 100**, with new/duplicate counts. Import requires typing exact confirmation, saves new contacts only, and must leave duplicates intact. Preview again: imported contacts should now be duplicates.
5. **Cross-tenant:** create a second workspace with a separate account and verify that its CRM connections and imported contacts are completely isolated.
6. **Retry and disconnect:** disconnect one provider, verify that its access tokens are removed from INTRIGUE, but existing imported contacts remain intact.
7. **CSV/XLSX:** upload the same fictional contact set in each format. Check mapping and preview; import CSV once, then preview XLSX, expecting duplicates. Try an invalid email and verify import is blocked.
8. **Regression:** reproduce exchange, refund, order-status, and hoodie sales enquiries. Ensure exchange/refund never create a sales quotation, and sales prices remain catalog-backed.
9. **Failure recovery:** revoke a provider OAuth grant from its own service and preview again. UI should show an error, not expose credentials. Confirm local worker still works and that email sending requires its pre-existing approval.

## Read-only Supabase verification
```
SELECT relname, relrowsecurity FROM pg_catalog.pg_class
WHERE relname IN ('intrigue_crm_connections','intrigue_crm_oauth_states');
```
Expected: two rows with `relrowsecurity = true`.

## Security and privacy limits
- Connection tokens are AES-256-GCM encrypted at rest in the database; the encryption key resides only in server env.
- PostgreSQL RLS is enabled on the new token tables; the `service_role` accesses them only after server-side workspace authorization.
- Provider authorization state has a 10-minute expiration and is consumed once; callback rechecks the original signed-in owner/admin and company membership.
- OAuth endpoints are pinned to provider domains to avoid arbitrary server requests. CRM imports are always human-confirmed.
- This release has **not** had independent external penetration testing or a complete GDPR review.
- Rotate any credentials exposed in earlier screenshots; never upload `.env.local` or exported real customer records.

## Deploy gate
**Only push this release to `main` if** the installer tests pass, `npm run build` passes, the migration succeeds in a backed-up target, and OAuth environment variables are ready. Record any failed checks before release.
