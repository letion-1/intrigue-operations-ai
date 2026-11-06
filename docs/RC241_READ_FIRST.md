# INTRIGUE RC2.4.1 | All selected languages (16)

This package **supersedes the Swahili-only RC2.4 ZIP** and may install over RC2.3 or RC2.4; it retains persistent tutorial skipping and the same SQL migration shipped in RC2.4.

## Scope
- All 16 saved language codes are supported in interface lookup, core navigation, guided setup, company profile and AI language preferences.
- UI copy has a no-network static translation catalog for primary labels, with existing complete Swahili main-dashboard coverage retained.
- **Not yet translated:** some specialist CRM, privacy, receptionist, integration and long-form status strings. These remain English, not falsely auto-translated.
- Arabic sets right-to-left direction for the workspace; thoroughly regression-test the layouts before production.
- Company/customer records, product names, prices, and technical identifiers are never translated.
- AI prompts use the exact saved locale and an explicit human language name. LLM output is best-effort, not guaranteed perfect without real prompts and acceptance tests.

## Install and verify
1. From project root, execute `& "$HOME\Downloads\INTRIGUE_SPRINT1_RC241_ALL_16_LANGUAGES\install-rc241.ps1"`. Installer checks RC2.3 or RC2.4 source hashes and backs up affected files.
2. Run `node --test tests/rc23.contract.test.cjs tests/rc24.contract.test.cjs tests/rc241.languages.contract.test.cjs` and `npm run build`.
3. Apply existing RC2.4 SQL `sql/INTRIGUE_SPRINT1_RC24_TUTORIAL_PROGRESS.sql` **only if not already applied**. This multilingual amendment itself needs no SQL migration: `workspace_settings.preferred_language` already accepts all 16.
4. Git add only manifest paths, commit, push main. Keep GDPR deletion flag off.
5. Verify German, Arabic (RTL), Hindi, Japanese and Swahili saved selection, reload, core navigation and AI replies; inspect missing translation areas.

**Do not present this as fully localized across every module.** It enables the existing 16 languages across core UI and AI, but specialist UI copy still needs translation and native-language QA.
