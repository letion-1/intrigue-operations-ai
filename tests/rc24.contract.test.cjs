const fs=require('node:fs');
const assert=require('node:assert/strict');
const test=require('node:test');
const read=p=>fs.readFileSync(p,'utf8');
const dash=read('app/dashboard/page.tsx'), company=read('app/dashboard/company-onboarding/CompanyOnboarding.tsx');
const sql=read('sql/INTRIGUE_SPRINT1_RC24_TUTORIAL_PROGRESS.sql');
test('skip writes to persistent table, distinguishes skipped and completed',()=>{
 assert.match(dash,/intrigue_onboarding_progress/);
 assert.match(dash,/skipTutorialStep/);
 assert.match(dash,/guideState\(i\+1\)/);
 assert.match(dash,/Skipped\. Review/);
 assert.match(sql,/CHECK \(status IN \('skipped','completed'\)\)/);
});
test('RLS owner-only and no staff-write grants',()=>{
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/w\.owner_id = \(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/REVOKE ALL ON public\.intrigue_onboarding_progress FROM PUBLIC, anon, authenticated/);
 assert.doesNotMatch(sql,/GRANT DELETE ON public\.intrigue_onboarding_progress/);
});
test('language persists and reopens interface',()=>{
 assert.match(dash,/setSavedUiLocale\(data\?\.preferred_language \|\| "en"\)/);
 assert.match(dash,/window\.location\.reload\(\)/);
 assert.match(dash,/lang=\{locale\}/);
});
test('onboarding gets locale and AI receives Swahili instruction',()=>{
 assert.match(dash,/locale=\{locale\}/);
 assert.match(company,/uiText\(locale,message\)/);
 assert.match(read('app/api/agent/route.ts'),/fluent Kiswahili/);
 assert.match(read('app/api/assistant/route.ts'),/fluent Kiswahili/);
});
test('no automatic deletion flag changed',()=>{
 assert.doesNotMatch(dash,/INTRIGUE_RC2_DELETION_ENABLED/);
 assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
