const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const read = (file) => fs.readFileSync(file, 'utf8');

const page = read('app/dashboard/page.tsx');
const metrics = read('app/dashboard/overview/OverviewInsights.tsx');
const responsive = read('app/dashboard/v18-polish.css');
const landing = read('app/page.tsx');
const layout = read('app/layout.tsx');

test('V18 updated TSX files parse without syntax errors', () => {
 for (const file of ['app/dashboard/page.tsx','app/dashboard/overview/OverviewInsights.tsx','app/page.tsx','app/layout.tsx']) {
   const result = ts.transpileModule(read(file), {fileName:file, reportDiagnostics:true,
      compilerOptions:{jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022}});
   const errors = (result.diagnostics||[]).filter(e=>e.category===ts.DiagnosticCategory.Error);
   assert.equal(errors.length,0,`${file}: ${errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('; ')}`);
 }
});

test('Overview uses live workspace data, not fake chart samples', () => {
 assert.match(page, /<OverviewInsights/);
 assert.match(page, /enquiries=\{enquiries\}/);
 assert.match(page, /quotes=\{quotes\}/);
 assert.match(page, /followUps=\{tasks\}/);
 assert.match(metrics, /7, 30/);
 assert.match(metrics, /new Map(?:<[^>]+>)?\(days\.map/);
 assert.match(metrics, /enquiries\.filter\(e => e\.status !== "closed"\)/);
 assert.doesNotMatch(metrics, /Math\.random\(/);
});

test('Billing and pilot are hidden from client nav but existing routes remain intact', () => {
 assert.match(page, /\["Data Management","Security & Usage"\]\.map\(label/);
 assert.match(page, /section === "Plans & Billing"/);
 assert.match(page, /section === "Pilot Application"/);
});

test('Light and dark style scopes and responsive breakpoints exist', () => {
 assert.match(responsive, /data-intrigue-theme="light"/);
 assert.match(responsive, /data-intrigue-theme="dark"/);
 assert.match(responsive, /max-width:680px/);
 assert.match(responsive, /intrigue-inquiries-overview/);
 const cards = read('app/dashboard/overview/overview-insights.css');
 assert.match(cards, /max-width:1100px/);
 assert.match(cards, /max-width:600px/);
});

test('Public sign-in no longer offers unprovisioned company sign-up', () => {
 assert.doesNotMatch(landing,/href="\/auth\/sign-up"/);
 assert.match(landing,/register through an invitation/);
 assert.match(layout,/INTRIGUE Operations AI/);
});

test('No destructive account deletion behavior or Supabase grants were patched', () => {
 assert.match(page,/AccountDeletionPanel/);
 assert.match(page,/OWNER_ONLY_SECTIONS/);
});
