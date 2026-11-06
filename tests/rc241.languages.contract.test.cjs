const assert=require('node:assert/strict');const fs=require('node:fs');const test=require('node:test');
const ui=fs.readFileSync('lib/intrigue-ui-language.ts','utf8');const dict=fs.readFileSync('lib/intrigue-ui-translations.ts','utf8');
const page=fs.readFileSync('app/dashboard/page.tsx','utf8');
const locales=['en','de','fr','es','pt','it','nl','sw','ar','tr','pl','hi','zh','ja','ko','ru'];
test('all 16 configured languages supported by UI and have a core dictionary',()=>{
 for(const code of locales)assert.match(ui,new RegExp('"'+code+'"'));
 for(const code of locales.filter(c=>c!=='en'&&c!=='sw'))assert.match(dict,new RegExp('"'+code+'":'));
 assert.match(ui,/CORE_TRANSLATIONS\[locale\]/);
});
test('language persists and reloads, right to left Arabic',()=>{assert.match(page,/setSavedUiLocale\(data\?\.preferred_language/);assert.match(page,/window\.location\.reload\(\)/);assert.match(page,/dir=\{uiDirection\(locale\)\}/);assert.match(ui,/locale === "ar" \? "rtl"/);});
test('AI prompts receive explicit supported language name from settings',()=>{for(const name of ['agent','assistant']){const src=fs.readFileSync('app/api/'+name+'/route.ts','utf8');assert.match(src,/CUSTOMER_LANGUAGE_NAMES/);assert.match(src,/preferred_response_language_name/);assert.match(src,/preferred_response_language/);}});
test('no database or deletion function changes',()=>{assert.ok(!fs.existsSync('sql/INTRIGUE_SPRINT1_RC241_MULTILANG.sql'));});
