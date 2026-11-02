#!/usr/bin/env node
/** INTRIGUE V17.0 non-destructive source security baseline. Node 20+; no dependencies. */
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs|cjs|sql)$/i;
const EXCLUDE = new Set(['.git', '.next', 'node_modules', '.vercel', '.turbo', 'coverage', 'dist', 'build', '.output', 'backups']);
const SENSITIVE_FILE = /(^|\/)(\.env(?:\.|$)|\.env\.local$|.*\.pem$|.*\.key$|.*\.p12$)/i;

export function listSources(root, dir=root, output=[]) {
  for (const item of readdirSync(dir, {withFileTypes:true})) {
    if (item.isSymbolicLink() || EXCLUDE.has(item.name)) continue;
    const path = join(dir,item.name);
    if (item.isDirectory()) listSources(root,path,output);
    else if (item.isFile() && SOURCE_EXT.test(item.name) && !SENSITIVE_FILE.test(relative(root,path).replaceAll('\\','/'))) output.push(path);
  }
  return output;
}
export function findRouteMethods(source) {
  const regex=/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g;
  return [...source.matchAll(regex)].map(x=>x[1]);
}
export function classifyRoute(source) {
  const methods=findRouteMethods(source);
  const hasAuth=/(?:auth\.getUser\s*\(|getUser\s*\(|require(?:User|Auth|Owner|Workspace)|authenticate|withAuth)/i.test(source);
  const hasWorkspace=/(?:workspace_id|workspaceId|workspaces|workspace_memberships|workspace_access)/i.test(source);
  const elevated=/(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|service_role|createAdminClient)/i.test(source);
  const mutation=methods.some(x=>['POST','PUT','PATCH','DELETE'].includes(x));
  return {methods,hasAuth,hasWorkspace,elevated,mutation,needsManualReview:mutation && (!hasAuth || !hasWorkspace || elevated)};
}
export function analyzeProject(root) {
  if (!existsSync(join(root,'package.json'))) throw new Error('Run from INTRIGUE project root containing package.json');
  const scanPaths=listSources(root);
  const files=new Map(scanPaths.map(p=>[relative(root,p).replaceAll('\\','/'), readFileSync(p,'utf8')]));
  const get=(path)=>files.get(path)||'';
  const findings=[];
  const add=(id,severity,evidence,description,next)=>findings.push({id,severity,evidence,description,next});
  let packageJson={};
  try {packageJson=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));}
  catch {add('PACKAGE_JSON_INVALID','P0','package.json','Unable to parse package manifest','Fix manifest and rerun audit');}
  const deps={...(packageJson.dependencies||{}),...(packageJson.devDependencies||{})};
  const latest=Object.entries(deps).filter(([,v])=>v==='latest').map(([n])=>n);
  if(latest.length) add('DEPENDENCY_LATEST','P1','package.json',`Unbounded dependency ranges: ${latest.join(', ')}`,'Pin tested dependency versions after a clean-build regression');
  if(!packageJson.scripts?.test) add('NO_TEST_SCRIPT','P1','package.json','No npm test command defined','Add unit, integration, authorization and browser tests');
  if(!packageJson.scripts?.['typecheck']) add('NO_TYPECHECK_SCRIPT','P2','package.json','No explicit typecheck command','Add tsc --noEmit as a CI gate');
  const config=get('next.config.ts');
  if(/cacheComponents\s*:\s*true/.test(config) && !/partialPrefetching\s*:/.test(config)) add('CACHE_CONFIG','P2','next.config.ts','cacheComponents enabled without an explicit partialPrefetching setting','Evaluate caching and set partialPrefetching explicitly after testing');
  if(/Next\.js and Supabase Starter Kit/i.test(existsSync(join(root,'README.md'))?readFileSync(join(root,'README.md'),'utf8'):'')) add('README_STALE','P2','README.md','Root README describes the Supabase starter template','Replace with INTRIGUE deployment and security documentation');
  const worker=get('workers/intrigue-worker.mjs');
  if(/demo.only|INTRIGUE_WORKER_MODE.*demo|no external side effects/i.test(worker)) add('AUTOMATION_DEMO_ONLY','P1','workers/intrigue-worker.mjs','Worker appears explicitly demonstration-only','Develop tenant-bound workflow runner with approvals, idempotency, monitoring and failure handling');
  const agent=get('app/api/agent/route.ts');
  if(/brake inspection[\s\S]{0,200}cabin air filter replacement/i.test(agent)) add('AI_AUTOMOTIVE_ONLY','P1','app/api/agent/route.ts','AI approval tool uses automotive-specific services','Replace with validated catalog-based, industry-neutral action schema');
  const receptionist=[...files.entries()].filter(([p])=>/ReceptionistPanel\.tsx$/i.test(p));
  for (const [p,content] of receptionist) {
    if(/Dial Pad|coming soon|not yet supported|disabled/i.test(content)) add('RECEPTIONIST_PLACEHOLDERS','P1',p,'Receptionist panel contains possible disabled/future controls','Verify dialer, configuration and retention controls in a staging browser');
  }
  const dashboard=get('app/dashboard/page.tsx');
  if(/Plans & Billing/.test(dashboard) && /plan interest|Private Preview|not.*bill|no.*payment/i.test(dashboard)) add('BILLING_PREVIEW','P1','app/dashboard/page.tsx','Billing appears to be a non-transactional preview','Implement tested entitlements and provider-signed subscription lifecycle');
  const routes=[];
  for (const [path,source] of files) {
    if(!/^app\/api\/.+\/route\.(?:ts|js)$/.test(path)) continue;
    const info=classifyRoute(source);
    routes.push({path,...info});
  }
  routes.sort((a,b)=>a.path.localeCompare(b.path));
  const candidates=routes.filter(r=>r.needsManualReview);
  if(candidates.length) add('ROUTE_AUTH_REVIEW','P0','app/api/',`${candidates.length} mutating routes need manual auth/workspace/elevated-client review (pattern-based, not proof of vulnerability)`,'Audit every entry point, helper, RPC and RLS boundary against foreign workspace IDs');
  const sqlFunctions=[];
  for (const [path,source] of files) {
    if(!path.endsWith('.sql')) continue;
    const patterns=[...source.matchAll(/\bSECURITY\s+DEFINER\b/gi)];
    if(patterns.length) sqlFunctions.push({path,count:patterns.length,searchPathMentioned:/SET\s+search_path\s*=/i.test(source)});
  }
  if(sqlFunctions.length) add('DEFINER_AUDIT','P0','database/ and SQL migrations',`${sqlFunctions.reduce((a,b)=>a+b.count,0)} SECURITY DEFINER occurrences require independent grant/search_path/tenant authorization review`,'Use supplied read-only pg_catalog inventory SQL on isolated staging; review function body and EXECUTE grants');
  const hasCI=existsSync(join(root,'.github','workflows')) && readdirSync(join(root,'.github','workflows')).some(x=>/\.ya?ml$/.test(x));
  if(!hasCI) add('CI_MISSING','P1','.github/workflows/','No GitHub Actions CI workflow found','Add non-secret checks, npm ci, tests and build before merge');
  const authRlsSqlCount=scanPaths.filter(p=>p.endsWith('.sql')).length;
  return {version:'17.0',timestamp:new Date().toISOString(),projectRoot:root,sourceFiles:scanPaths.length,sqlFiles:authRlsSqlCount,routes,sqlFunctions,findings,notes:[
    'Static pattern detection flags review candidates, not confirmed exploitable vulnerabilities.',
    'No database, external API, production secret, or customer record was accessed.',
    'Live tenant isolation and GDPR compliance cannot be certified from a source scan.',
    'Use separately provisioned staging and test accounts for live authorization tests.'
  ]};
}
export function reportMarkdown(result) {
  const lines=['# INTRIGUE V17.0 — Read-only code baseline','',`Generated: ${result.timestamp}`,'',`Source files scanned: ${result.sourceFiles} | API routes inventoried: ${result.routes.length} | SQL files: ${result.sqlFiles}`,'','## Findings','', '| Severity | ID | Evidence | Finding | Next step |','|---|---|---|---|---|'];
  const cell=(s)=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
  for(const f of result.findings) lines.push(`| ${f.severity} | ${f.id} | ${cell(f.evidence)} | ${cell(f.description)} | ${cell(f.next)} |`);
  lines.push('','## API route inventory','', '| Route | Methods | Auth signal | Workspace signal | Elevated client | Review |','|---|---|---|---|---|---|');
  for(const r of result.routes) lines.push(`| ${cell(r.path)} | ${r.methods.join(',')||'unknown'} | ${r.hasAuth?'yes':'not detected'} | ${r.hasWorkspace?'yes':'not detected'} | ${r.elevated?'yes':'no'} | ${r.needsManualReview?'REVIEW':'still test'} |`);
  lines.push('','## SQL SECURITY DEFINER inventory','');
  if (!result.sqlFunctions.length) lines.push('No SQL SECURITY DEFINER declarations found in files (does not assess live database).');
  for(const x of result.sqlFunctions) lines.push(`- ${x.path}: ${x.count} declarations; search_path mentioned: ${x.searchPathMentioned}`);
  lines.push('','## Limitations','',...result.notes.map(x=>`- ${x}`),'');
  return lines.join('\n');
}
const isEntry=process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if(isEntry) {
  const root=resolve(process.argv[2]||process.cwd());
  const out=resolve(process.argv[3]||join(os.tmpdir(),'intrigue-v17-security-baseline'));
  try {
    const result=analyzeProject(root);
    mkdirSync(out,{recursive:true});
    writeFileSync(join(out,'report.md'),reportMarkdown(result));
    writeFileSync(join(out,'inventory.json'),JSON.stringify(result,null,2)+'\n');
    console.log(`INTRIGUE V17 baseline complete: ${result.routes.length} routes, ${result.findings.length} findings.`);
    console.log(`Report: ${join(out,'report.md')}`);
    console.log(`Inventory: ${join(out,'inventory.json')}`);
    console.log('READ-ONLY: This does not certify security or test a live Supabase database.');
  } catch (error) {console.error('Audit stopped:', error.message); process.exitCode=1;}
}
