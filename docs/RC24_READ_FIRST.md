# INTRIGUE Sprint 1 RC2.4 | Guided setup progress & Swahili foundation

Release tested against source files in RC2.3. This is a targeted source patch, not an autonomous code deployment.

## Included
- Workspace-scoped tutorial progress persisted in `public.intrigue_onboarding_progress` with owner-only RLS.
- Skip step, revisit, and completion statuses. Skipped items receive a checked marker but **are not presented as completed business readiness**.
- Guide remembers the next step after the language-setting reload.
- Dashboard waits for settings language to load before rendering, preventing an English flash on a Swahili account.
- **Swahili localization foundation:** key dashboard navigation, guided setup, Settings, Knowledge Base upload UI, and many inline dashboard labels. English remains the fallback for untranslated screens/strings. Other language choices currently guide AI responses only; a full 16-locale interface localization is **not** shipped. Do not advertise all UI surfaces or all 16 languages as fully localized.
- AI Assistant and business Q&A system prompts explicitly honor workspace communication language, including Swahili by default, unless user specifies another.
- No new paid hosting, no customer deletes, no changes to GDPR deletion flag.

## Install order
1. Keep backup copies (installer backs up each replaced file outside repo); do not push or deploy before checks.
2. Run `install-rc24.ps1` in the ZIP from VS Code PowerShell, from project root. If baseline mismatches beyond harmless whitespace, **STOP**.
3. `node --test tests/rc23.contract.test.cjs tests/rc24.contract.test.cjs` followed by `npm run build`. Existing RC2.* tests should also pass.
4. In existing `Ai_automation` Supabase SQL Editor, apply `sql/INTRIGUE_SPRINT1_RC24_TUTORIAL_PROGRESS.sql` completely. The SQL is additive but do not apply it without accepting the risk of operating without a verified backup.
5. Verify RLS via `select relrowsecurity from pg_class where oid='public.intrigue_onboarding_progress'::regclass;` -> true. Verify owner can mark skip and another company's account cannot write to it.
6. After local checks, commit only the files in manifest, push and confirm Vercel Ready.
7. In ORBIT THREADS QA: open tutorial, skip step 3, observe a Skipped check, refresh, observe same status. Revisit and create product, expect Complete. Select Swahili in Settings, save, expect workspace reload and translated primary UI. Ask AI Assistant in English for a price but not for a different language: answer should use Swahili by default, with original product names and pricing intact.

## Important limits
- The dashboard still has English-only components and some unlocalized content in CRM, receptionist, privacy center, calendar, external provider panels. Static dictionaries for those are separate future work. The title should NOT claim complete application-wide multilingual support.
- The UI progress table does not enable features and is not a substitute for production security review.
- Language settings are per-workspace, not per-member. The owner changing it affects the company's default language.
- No full production build or live Supabase test was available in the packaging environment. Tests are source-level and parser checks, not proof of server-side permissions.
- Keep `INTRIGUE_RC2_DELETION_ENABLED=false`; the actual erasure engine remains incomplete.
