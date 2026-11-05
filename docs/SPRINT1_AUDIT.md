# INTRIGUE Sprint 1 Release Candidate: Audit and boundaries

Source audited: uploaded INTRIGUE_SPRINT1_CURRENT_SOURCE.zip, 205 original files.

## Preserved and reused
- Next.js/Vercel Supabase multi-workspace auth and RLS-backed roles.
- Existing Gmail, Outlook, Google Calendar, Cal.com/Calendly and Vapi modules.
- Existing onboarding, customer CRM, CSV import function, quotation generation and automation engine.
- Existing source backups and additive migration strategy.

## Gaps identified in uploaded code
- Old Action Center page ran a narrow service-specific parser beside Automation Centre.
- Integrations duplicated a CRM CSV importer instead of linking to the approved import flow in Customers & CRM.
- Zoho/HubSpot/Pipedrive were offered as CSV source labels, **not** authorized live integrations.
- Multiple version and development labels were visible in client workflow UI.
- Direct .xlsx contact uploads were not supported.
- Sidebar had too many equally weighted navigation entries.

## Included source work
- Removed old Action Center from navigation, retained access to its historical approvals within Automation Centre.
- Simplified sidebar presentation and moved advanced settings into an expandable area.
- Updated primary banner/copy and removed visible release labels in key automation and import screens.
- Replaced duplicate integrations CSV importer with a per-workspace provider connection panel.
- Added read-only OAuth for Zoho/HubSpot/Pipedrive; token encryption; domain allowlists; owner/admin checks; one-time state; manual import preview.
- Added .xlsx contact parsing to the existing preview/approval import flow using a pinned third-party package.
- Added SQL migration to store encrypted provider credentials and OAuth states with RLS and service-only access.

## Acceptance status as packaged
- Syntax-transpilation checks: pass for modified TS/TSX files.
- CRM and static regression unit checks: 10 passed in build workspace.
- Existing suite: needs to run in user environment.
- `npm run build`: **not verified** here. Dependency installation in temporary environment failed with npm's internal “Exit handler never called” error.
- Real OAuth with Zoho/HubSpot/Pipedrive: **not verified**; requires app keys, allowed redirect URIs and test accounts.
- Supabase migration: **not applied**; must be reviewed and applied in backed-up target.
- Client UI on desktop/mobile: **not visually verified** in a browser; requires human QA.

## Not in this RC (cannot responsibly claim complete)
- Full bidirectional CRM sync and large-history paging; CRM import only first 100 per preview.
- Customer file ingestion into all business entities from PDFs/Word/Excel; only contacts support XLSX and existing Knowledge Base ingestion is preserved.
- End-to-end onboarding acceptance, performance budgets, production security audit, staging isolation, external worker reliability and admin portal.
- Platform owner admin dashboard and support tickets intentionally reserved for Sprint 2.

## Launch decision
Do not treat this RC as a finished Sprint 1 or as production-safe until the entire acceptance matrix passes and listed gaps are addressed. This is one integrated batch to test, not many small deployments.
