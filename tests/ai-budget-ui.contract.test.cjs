const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const get=p=>fs.readFileSync(path.join(root,p),'utf8');
function has(p,...patterns){const s=get(p);for(const pat of patterns)assert.match(s,pat,`Expected ${pat} in ${p}`);}
test('Dedicated workspace budget notice and unique monthly alerts',()=>{
 has('sql/INTRIGUE_AI_BUDGET_NOTICES.sql',/UNIQUE \(workspace_id,kind,period_start\)/,/ON CONFLICT\(workspace_id,kind,period_start\) DO NOTHING/,/intrigue_v21_supported_tables/);
});
test('Budget notifications stay service-only and separate private identity',()=>{
 has('sql/INTRIGUE_AI_BUDGET_NOTICES.sql',/ENABLE ROW LEVEL SECURITY/,/REVOKE ALL ON public\.intrigue_ai_budget_notices FROM PUBLIC,anon,authenticated/,/GRANT EXECUTE ON FUNCTION public\.intrigue_ai_budget_notice_emit\(uuid,text\) TO service_role/,/public\.intrigue_platform_is_operator\(p_actor\)/,/w\.owner_id=p_actor/);
});
test('Worker only treats explicit internal budget code as allowance exhaustion',()=>{
 has('tools/intrigue-v17/quotation-analysis.mjs',/res\.status===429/,/failure\?\.code==='AI_ALLOWANCE_EXHAUSTED'/,/throw new AiAllowanceExhaustedError\(\)/);
 has('tools/intrigue-v17/worker.mjs',/instanceof AiAllowanceExhaustedError/,/outcome:'allowance_exhausted'/);
});
test('Never fallback to free unmetered provider after rejected budget',()=>{
 const s=get('tools/intrigue-v17/quotation-analysis.mjs');assert.match(s,/if\(metered\)\{/);assert.match(s,/\}else\{\s*res=await fetcher\('https:\/\/openrouter\.ai/);
});
test('Both governed request paths return explicit budget code and emit alert only on denial',()=>{
 has('app/api/ai-runtime/chat/route.ts',/reserved\?\.reason==='text_allowance_exhausted'/,/intrigue_ai_budget_notice_emit/,/code:'AI_ALLOWANCE_EXHAUSTED'/);
 has('lib/intrigue-ai/governed-provider-fetch.ts',/data\?\.reason==='text_allowance_exhausted'/,/intrigue_ai_budget_notice_emit/,/code:'AI_ALLOWANCE_EXHAUSTED'/);
});
test('Client and operator notification API enforces server-side identities',()=>{
 has('app/api/support-notifications/route.ts',/platformAuth\(req\)/,/mustBeOperator\(ctx\)/,/intrigue_ai_budget_notice_list/,/intrigue_ai_budget_notice_mark_read/);
});
test('Allowances cannot be committed to a quotation as fake success',()=>{
 has('app/api/automation/v17/route.ts',/analysis\.result\?\.classification_source!=='v17\.2b'/,/analysis\.result\?\.outcome!=='matched'/);
});
test('Notification component is responsive and theme-aware, no inline navy palette',()=>{
 has('app/dashboard/SupportNotifications.tsx',/SupportNotifications\.module\.css/,/source:item\.source/,/aria-haspopup="dialog"/);
 has('app/dashboard/SupportNotifications.module.css',/data-intrigue-theme="light"/,/overflow-wrap:anywhere/,/max-height:calc\(100dvh - 95px\)/);
});
test('Appearance control is compatible with local dashboard theme',()=>{
 has('app/dashboard/page.tsx',/data-intrigue-theme=\{appearance\}/,/intrigue-theme-button/);
 has('app/dashboard/client-shell.css',/data-intrigue-theme="light"\] \.intrigue-theme-button/);
});
test('Do not misreport a nonzero microcharge as zero',()=>{
 has('app/platform/ai-usage/page.tsx',/Less than \$0\.01/,/formatUsage\(detail\.usage\.text_usd\)/);
});
test('No Next cacheComponents incompatible route runtime configuration introduced',()=>{
 for(const p of ['app/api/ai-runtime/chat/route.ts','app/api/support-notifications/route.ts','app/api/automation/v17/route.ts'])assert.doesNotMatch(get(p),/export const (runtime|dynamic)\s*=/);
});

test('Allowance result stays unsavable and can be explicitly reanalyzed after renewal',()=>{
 has('app/api/automation/v17/route.ts',/previousAllowanceGate/,/previousManualReview/,/result:\{kind:'budget_notice',outcome:'allowance_exhausted'\}/);
});
