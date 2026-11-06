# INTRIGUE Sprint 1 RC2.3 | Onboarding and text encoding

## Changes

1. Replaces broken UTF-8/mojibake in dashboard and AI Receptionist UI source.
2. Adds guided onboarding: company profile -> upload/knowledge -> product catalog -> AI settings -> optional team -> review. Successful form saves advance steps when the tutorial is active; each stage has Previous/Continue controls. Does **not** activate production readiness or change roles.
3. For labeled TXT/Markdown documents, parses directly without an OpenRouter request. Structured text is still passed through the existing authenticated `intrigue_onboarding_import` RPC, preserving its atomic merge/dedup behavior. A knowledge-only fallback skips AI and deliberately does NOT create CRM/catalog rows.
4. Company settings now include a preferred response language. The selection is propagated to AI Assistant preference context; it does **not** translate the dashboard or change Vapi's separate configuration.

## Safety notes

- This package contains no destructive migration and does not change workspace RLS. The language migration is required **before** deploying the modified source.
- This direct parser is narrow. Generic unstructured documents still need OpenRouter (which can time out); select 'Save as company knowledge only' when you want reliable archival without extraction. Unsupported product lines produce review warnings.
- SKU and stock are recorded in catalog description because the current `workspace_services` table does not have dedicated inventory columns. Do not claim stock tracking is implemented.
- The 'Staging only' messages in the dashboard remain relevant; this package is not an assurance of launch readiness.
- Continue to keep `INTRIGUE_RC2_DELETION_ENABLED=false` and do not include test customer secrets in uploads.

## Install

1. Make a local Git snapshot or backup of changed files. Run `install-rc23.ps1` from extracted ZIP. Installer preflights **all** reviewed source checksums before replacing any file and backs up originals outside Git.
2. Run `node --test tests/rc23.contract.test.cjs` and `npm run build`. Do NOT deploy if either fails.
3. Apply the complete `sql/INTRIGUE_SPRINT1_RC23_ONBOARDING_LANGUAGE.sql` using existing Supabase `Ai_automation` SQL Editor; it only adds a workspace-scoped preferred language column and allowlist check.
4. Stage only RC2.3 files, commit and push to your existing GitHub main after verifying the Vercel production deletion flag remains false.
5. Test in ORBIT THREADS QA with the labeled text dataset and a TXT upload. Check product catalog, knowledge entries, customers, and no data leaking into Northline Auto.

## Limitations

This code has source-level checks and deterministic parser tests. A full Next.js build against the current Windows project and authenticated end-to-end import against live Supabase have **not** run in the packaging environment. Do not treat static test success as real production verification.
