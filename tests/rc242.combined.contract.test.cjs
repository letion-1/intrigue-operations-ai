const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const page = fs.readFileSync('app/dashboard/page.tsx','utf8');
const langs = fs.readFileSync('lib/intrigue-ui-language.ts','utf8');
const source = fs.readFileSync('lib/intrigue-ui-translations.ts','utf8');
const codes = ['en','de','fr','es','pt','it','nl','sw','ar','tr','pl','hi','zh','ja','ko','ru'];
test('all 16 languages remain supported and have localized initial chat greetings', () => {
  for (const code of codes) assert.match(langs, new RegExp(`\\b${code}:`));
  assert.match(langs, /export const ASSISTANT_INTRO/);
  assert.match(source, /CORE_TRANSLATIONS/);
});
test('locale declaration precedes every greeting effect that reads it', () => {
  const declaration = page.indexOf('const locale = availableUiLocale(savedUiLocale)');
  const greetingEffect = page.indexOf('// Only update the untouched initial greeting;');
  assert.ok(declaration > 0 && greetingEffect > declaration, 'The locale declaration must precede greeting effect');
  assert.match(page, /Object.values\(ASSISTANT_INTRO\).includes\(text\)/);
  assert.match(page, /\[locale\]\);/);
});
test('TypeScript and TSX source parses successfully', () => {
  for (const file of ['app/dashboard/page.tsx','app/dashboard/company-onboarding/CompanyOnboarding.tsx','lib/intrigue-ui-language.ts','lib/intrigue-ui-translations.ts','app/api/agent/route.ts','app/api/assistant/route.ts']) {
    const result = ts.transpileModule(fs.readFileSync(file,'utf8'), {
      fileName:file, reportDiagnostics:true,
      compilerOptions: { target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.Preserve, module:ts.ModuleKind.ESNext },
    });
    assert.equal(result.diagnostics?.length ?? 0,0, `${file}: ${result.diagnostics?.map(d=>ts.flattenDiagnosticMessageText(d.messageText, '\\n'))}`);
  }
});
test('persistent skipped and completed tutorial states remain in dashboard', () => {
  assert.match(page, /intrigue_onboarding_progress/);
  assert.match(page, /skipTutorialStep/);
  assert.match(page, /guideState\(i\+1\)/);
  assert.match(fs.readFileSync('sql/INTRIGUE_SPRINT1_RC24_TUTORIAL_PROGRESS.sql','utf8'), /CHECK \(status IN \('skipped','completed'\)\)/);
});
test('selected workspace language applies without changing user data', () => {
  assert.match(page, /setSavedUiLocale\(data\?\.preferred_language/);
  assert.match(page, /uiDirection\(locale\)/);
  assert.match(page, /window.location.reload\(\)/);
  assert.match(fs.readFileSync('app/api/agent/route.ts','utf8'), /preferred_response_language_name/);
  assert.match(fs.readFileSync('app/api/assistant/route.ts','utf8'), /preferred_response_language_name/);
});
