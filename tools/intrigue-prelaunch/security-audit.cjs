/** Read-only local source readiness audit. NEVER prints environment secret values. */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const read=p=>{try{return fs.readFileSync(path.join(root,p),'utf8')}catch{return ''}};
const exists=p=>fs.existsSync(path.join(root,p));
const tests=[];
function add(id,pass,importance,comment){tests.push({id,status:pass?'pass':'review',importance,comment})}
const portal=read('app/api/platform/console/route.ts');
add('platform_server_permission_gate',/mustBeOperator\s*\(/.test(portal),'critical',
 'Private console must reject authenticated non-operators on the server');
add('platform_identity_uses_bearer',/platformAuth\s*\(/.test(portal),'critical',
 'Admin identity comes from verified authorization, not request body');
const erasure=read('app/api/company/erasure/route.ts');
add('company_erasure_owner_and_fresh_session',/recentlySignedIn/.test(erasure)&&/identity|preview/.test(erasure),'critical',
 'Owner erasure must require a fresh verified session');
const notifications=read('app/api/support-notifications/route.ts');
add('notifications_are_authenticated',/platformAuth|identity\s*\(/.test(notifications),'critical',
 'Notification reads must be authenticated and scoped');
const health=read('app/api/health/route.ts');
add('health_does_not_expose_data',/status: 'ok'/.test(health) && !/serviceKey|SUPABASE_SERVICE_ROLE|token/.test(health),'critical',
 'Liveness must not expose secrets or report worker readiness');
const config=read('next.config.ts');
add('web_security_headers',/X-Content-Type-Options/.test(config)&&/X-Frame-Options/.test(config)&&/Referrer-Policy/.test(config),'critical',
 'Response headers should reduce sniffing, framing and referrer leakage');
add('client_error_boundary',exists('app/error.tsx'),'high','Provide actionable error recovery');
add('responsive_polish',exists('app/prelaunch-hardening.css'),'high','Tablets, mobile form sizing and focus states');
add('supervised_worker_script',exists('tools/intrigue-prelaunch/worker-supervisor.mjs'),'high',
 'Supervision is for a running machine only, not always-on cloud hosting');
add('worker_script_present',exists('tools/intrigue-v17/worker.mjs'),'high',
 'Worker source must be deployed and approved-job protections verified');
const layout=read('app/layout.tsx');
add('client_offline_feedback',layout.includes('NetworkConnectionNotice'),'high','Offline changes may not persist');
const secrets=[];
for (const envname of ['.env.local','.env','.env.production']) {
  if(!exists(envname))continue;
  const values=read(envname);
  for(const line of values.split(/\r?\n/)) {
    const name=(line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/)||[])[1];
    if(name && /(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY)/.test(name)) secrets.push(name);
  }
}
add('no_exposed_public_secret_names',secrets.length===0,'critical',
 secrets.length?'Potential private credentials have NEXT_PUBLIC names (values omitted)':'No obvious public secret names found');
// Flag conspicuous starter/test copy in customer-facing UI for editorial review.
const customerUi=['app/layout.tsx','app/page.tsx','app/dashboard/page.tsx','app/platform/page.tsx','app/help-center/page.tsx'];
const customerTraces=[];
for(const item of customerUi){
  const data=read(item);
  if(/Next\.js and Supabase Starter Kit|Demo records in Supabase|not production ready/i.test(data))customerTraces.push(item);
}
add('no_starter_or_demo_copy',customerTraces.length===0,'high',
 customerTraces.length?`Possible unfinished customer-facing wording: ${customerTraces.join(', ')}`:'No known placeholder labels found in audited UI files');
const blockers=tests.filter(t=>t.status==='review'&&t.importance==='critical');
const manuals=[
 'Live freeze must block API writes, worker actions, calendar/email sends and third-party automations.',
 'Owner/Admin/Staff/Viewer RLS must be tested using different real sessions and two workspaces.',
 'Approved proposals must not be emailed or sent without intentional approval.',
 'A local worker cannot run when its host computer is asleep or offline; choose paid always-on hosting before client SLA.',
 'GDPR operational procedures still require retention, historical backup and provider-copy verification.',
 'Customer-controlled logo/favicons are prepared separately with --apply; avoid overwriting original artwork.',
];
const report={product:'INTRIGUE Operations Intelligence',generated_at:new Date().toISOString(),source:'local source and configuration',checks:tests,critical_review_items:blockers.map(x=>x.id),manual_acceptance:manuals};
const out=path.join(root,'reports','INTRIGUE_PRELAUNCH_AUDIT.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log('\nINTRIGUE prelaunch code audit (read-only):');
for(const t of tests)console.log(`${t.status==='pass'?'PASS':'REVIEW'} ${t.id} (${t.importance})`);
console.log(`\nAudit report: ${out}`);
console.log(`Critical static checks needing review: ${blockers.length}`);
console.log('NOTE: Static checks are not proof of tenant isolation, worker uptime or regulatory compliance.');
process.exitCode=blockers.length?2:0;
