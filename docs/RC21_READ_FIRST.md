# INTRIGUE Operations AI | Sprint 1 RC2.1

## Purpose
Allow customers to **submit and confirm an erasure review request** even while
`INTRIGUE_RC2_DELETION_ENABLED=false`. Receiving a request never deletes data.
Actual deletion, empty-workspace deletion and ownership transfer remain behind the
existing RC2 execution flag and its other authorization checks.

## Source baseline
Target: deployed RC2 source from `INTRIGUE_RC2_FRESH_DOWNLOAD.zip`, based on
Sprint 1 RC1 Git commit `b2995c7`. The installer checks SHA-256 hashes of all
three files it replaces and stops before changing anything if they differ.
Do not modify or re-run the RC2 migration to install RC2.1.

## Files patched
- `app/api/account/lifecycle/route.ts`: authenticated non-destructive request intake precedes the execution gate. Requires an exact server-recomputed confirmation phrase and checkbox acknowledgement; creates/returns a private request reference through `intrigue_rc2_request`; new requests begin in `needs_review` and existing pending requests reuse their reference.
- `app/dashboard/account/AccountDeletionPanel.tsx`: request buttons always enabled for the appropriate user; confirmation step with typed phrase and acknowledgement; request receipts and history.
- `app/dashboard/account/account-deletion.css`: scoped styles for the confirmation panel.
- `tests/rc21.contract.test.cjs`: source parsing and mocked API safety tests.

## Installation on Windows (VS Code PowerShell)
From the **existing** repository root, after downloading the ZIP to Downloads:

```powershell
$ErrorActionPreference = 'Stop'
cd "$HOME\Projects\intrigue-operations-ai"
$zip = "$HOME\Downloads\INTRIGUE_SPRINT1_RC21_PRIVACY_REQUESTS.zip"
$folder = "$HOME\Downloads\INTRIGUE_SPRINT1_RC21_PRIVACY_REQUESTS"
if (!(Test-Path -LiteralPath $zip)) { throw 'Download the RC2.1 ZIP first.' }
Expand-Archive -LiteralPath $zip -DestinationPath $folder -Force
& "$folder\install-rc21.ps1"
if (-not $?) { throw 'Installer failed. Do not deploy.' }
node --test tests/rc2.contract.test.cjs tests/rc21.contract.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Contract tests failed. Do not deploy.' }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed. Do not deploy.' }
```

Do **NOT** run `git add -A`. The older unrelated `on ` untracked file must not be committed.
If successful, stage *only* these files:

```powershell
git add -- app/api/account/lifecycle/route.ts app/dashboard/account/AccountDeletionPanel.tsx app/dashboard/account/account-deletion.css tests/rc21.contract.test.cjs docs/RC21_READ_FIRST.md
git --no-pager diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Git validation failed.' }
git commit -m 'Sprint 1 RC2.1 confirmed privacy request flow'
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }
```

## Live acceptance (non-destructive)
1. Verify Vercel deployment `Ready` and `INTRIGUE_RC2_DELETION_ENABLED=false` in Production.
2. In Settings, click `Request account erasure review`. Check the form requires both the acknowledgement and exact `REQUEST ACCOUNT your@email` phrase.
3. Use a **disposable test identity** for end-to-end request submission. Submit; expect a receipt ID, status `needs_review`, and a matching row in privacy history. Refresh and verify persistence.
4. Submit the identical request again; the existing `intrigue_rc2_request` function should return the existing pending reference (do not promise duplicate prevention without checking the real DB).
5. As a company owner, choose `Request company + account deletion`, confirm `REQUEST COMPANY AND ACCOUNT Test Company`; expect a request reference and no data deletion.
6. With only Staff/Viewer access, an attempted company request must receive an authorization error; a personal account request remains permissible.
7. Confirm customer, quotation, CRM, and Knowledge Base data still exist and `Delete my account now` is unavailable while the deletion flag is off.
8. Verify that direct HTTP requests `delete_account`, `delete_empty_workspace`, `offer_transfer`, `accept_transfer` receive HTTP 503 while the flag is off.

## Operating requirement
A `needs_review` request is a **real privacy request**, not a simulated one.
The operator must monitor it, acknowledge it appropriately, evaluate identity and legal retention duties, coordinate with the business data controller, and record the outcome. The app does not send an automatic email, enforce deadlines, revoke third-party tokens or automatically erase backed-up data.

Read-only operator queue:
```sql
SELECT id,kind,status,requested_at,response_due_at,workspace_label
FROM public.intrigue_rc2_requests
WHERE status IN ('needs_review','failed','workspace_deleted')
ORDER BY response_due_at,requested_at;
```

## Rollback
Before installation, installer copies the three replaced files under
`$HOME\INTRIGUE-backups\sprint1-rc21-YYYYMMDD-HHMMSS`.
To roll back, restore them to their same relative paths and rerun the build.
The existing RC2 SQL is unchanged. Do not change any global foreign keys.

## Limitations
This is a customer-facing intake and confirmation workflow, **not** complete
GDPR compliance or a finished erasure processor. Full automated deletion of
business records, retention decisions, Auth/Storage backups, external-provider
revocation, and customer notifications require further implementation and review.
A successful static/mocked test doesn't establish production runtime security.
