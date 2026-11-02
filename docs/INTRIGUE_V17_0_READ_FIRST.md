# INTRIGUE V17.0 — Safe Security Baseline

This is **phase 1 of the V17 repair program**, not a production security certificate and not the full V17.1 Automation Centre.

## What this install does

- Adds only new files under `tools/intrigue-audit/`, `docs/` and `.github/workflows/`.
- Does **not** change app source, Supabase SQL, webhooks, email or OAuth credentials, npm dependencies or workers.
- Installs an offline, read-only source audit with a route and risk inventory.
- Adds Node built-in unit tests and a read-only GitHub Actions audit.
- Includes `staging-rls.mjs` for future **isolated staging**, requiring explicit opt-in and two dedicated test users.
- Stores the audit report in a temporary directory. Inspect it for proprietary project details before sharing.

## Run it now

```powershell
cd "$HOME\Projects\intrigue-operations-ai"
node --test tools/intrigue-audit/audit.test.mjs
node tools/intrigue-audit/audit.mjs
```

Outputs `report.md` and `inventory.json` under `%TEMP%\intrigue-v17-security-baseline`. It prints the exact paths.

### Meaning of findings

- `P0`: high-priority **manual security review candidate**, not a verified vulnerability.
- `P1`: missing or incomplete feature / important quality gap.
- `P2`: maintainability/documentation issue.
- Routes marked `REVIEW` have pattern matches suggesting the need for inspection. A route that has auth checks in helper modules can be a false positive; a route marked `still test` can still be vulnerable.
- No tests exercise production or any database by default.

## SQL inventory

The accompanying file `docs/INTRIGUE_V17_0_READ_ONLY_DATABASE_INVENTORY.sql` runs **SELECT queries only** in Supabase SQL Editor; paste that SQL separately as needed. It inventories table RLS flags, role grants and privileged functions without altering data. **This does not prove RLS effectiveness.**

## Optional live RLS validation (not for the existing production project)

Only after provisioning a **separate Supabase staging project** with the same migrations and two dedicated test users in separate, non-overlapping company workspaces:

- Obtain staging publishable/anon key and separate workspace UUIDs.
- Provide `INTRIGUE_V17_STAGING_URL`, `INTRIGUE_V17_STAGING_ANON_KEY`, `INTRIGUE_V17_A_EMAIL`, `INTRIGUE_V17_A_PASSWORD`, `INTRIGUE_V17_A_WORKSPACE`, `INTRIGUE_V17_B_EMAIL`, `INTRIGUE_V17_B_PASSWORD`, `INTRIGUE_V17_B_WORKSPACE` as temporary process variables. **Never put test passwords in git or command history.**
- Set `INTRIGUE_V17_STAGING_ATTESTATION=I_VERIFIED_ISOLATED_STAGING` only after independently confirming isolation from production.
- Run `node tools/intrigue-audit/staging-rls.mjs`.

This runner uses normal authenticated client sessions (never service role), and **only SELECT HEAD count queries** against a second user's workspace. `ZERO_ROWS` / `DENIED` are expected; any `DATA_LEAK` is critical. `REVIEW_SCHEMA` means a table name or schema does not match, and is **not a pass**. Explicitly test privileged RPCs and APIs later; this is a limited subset.

## Deployment policy

Do not enable autonomous sending or destructive data lifecycle features until P0 tests pass on staging. Keep Gmail/Outlook/Calendar/Vapi integrations operational. The local worker can remain the development model until paying customers justify always-on hosting.

Next build sequence: V17.0 RBAC/RLS test coverage -> V17.1 Automation Centre -> V17.2 industry-neutral AI actions -> V17.3 live Zoho CRM connector -> V17.4 receptionist -> V17.5 GDPR lifecycle -> V17.6 billing.
