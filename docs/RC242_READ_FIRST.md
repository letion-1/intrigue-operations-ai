# INTRIGUE RC2.4.2 | Consolidated onboarding tutorial + 16 languages + TypeScript repair

**Starting point:** The current working RC2.3, RC2.4 or RC2.4.1 source. Specifically fixes TypeScript TS2448/TS2454 in `app/dashboard/page.tsx` where `locale` was read before declaration. The installer is idempotent and accepts already-installed RC2.4.1 files without requiring an old Swahili-only ZIP.

## Includes
- All 16 core UI language dictionaries: en, de, fr, es, pt, it, nl, sw, ar, tr, pl, hi, zh, ja, ko, ru; English fallbacks remain on unlocalized specialist screens.
- Locally translated introductory AI greeting in each of the 16 supported languages. Existing conversation messages are never retranslated.
- Explicit workspace language guidance passed through both AI agent and assistant routes. Verify with real model calls.
- Persistent tutorial progress (`completed` or `skipped`); skip is not a production-readiness pass.
- Arabic RTL where direction has been integrated.
- Supabase tutorial progress migration included, already existing RC2.4 migration. Run it on the existing `Ai_automation` project ONLY if `intrigue_onboarding_progress` is absent.
- Existing RC2.3 structured-text/knowledge import remains unchanged. No CRM or GDPR deletion changes.

## Installation
1. Extract ZIP into Windows Downloads. Run `install-rc242.ps1` from your existing project terminal. Preflight validates package checksums and known RC2.3, RC2.4 or RC2.4.1 source versions (allowing harmless newline differences). It makes per-file backups outside the repository. It aborts before any edits if unexpected differences are found.
2. Run `node --test tests/rc23.contract.test.cjs tests/rc24.contract.test.cjs tests/rc241.languages.contract.test.cjs tests/rc242.combined.contract.test.cjs` and `npm run build`.
3. Check database with: `select to_regclass('public.intrigue_onboarding_progress');`. If NULL, paste and execute the full SQL from `sql/INTRIGUE_SPRINT1_RC24_TUTORIAL_PROGRESS.sql`. If it exists and RLS is enabled, no migration is needed.
4. Once build and migration checks pass, stage only the paths from `manifest.json`, commit/push main. Confirm the Vercel deployment is Ready.
5. Test ORBIT THREADS QA: skip a step, refresh (Skipped persists), revisit and complete, select German/Swahili/Arabic/Japanese and save, verify translated core UI and AI answers. Inspect Arabic layouts. Specialist UI is not yet fully translated.

## Critical boundaries
- No production deletion or data wipes are enabled or implemented by this update. Keep `INTRIGUE_RC2_DELETION_ENABLED=false`.
- This is a source-level patch and static checks only; a complete production Next.js build must run on the actual Windows project before GitHub push.
- The 16-language translation is **not** application-wide across every component. Specialized CRM, Receptionist, Calendar, Privacy and Integrations screens still have untranslated content and should not be advertised as fully localized.
- Do not upload passwords, database URLs or `.env.local`.
