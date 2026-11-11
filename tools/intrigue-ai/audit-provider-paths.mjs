#!/usr/bin/env node
/** Read-only INTRIGUE provider-call inventory. No API keys/contents are ever printed. */
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const recognized=['https://openrouter.ai/','https://api.openai.com/','https://api.anthropic.com/',
  'https://api.vapi.ai/','https://api.retellai.com/','https://generativelanguage.googleapis.com/'];
const allowed={
 'app/api/ai-runtime/chat/route.ts':'Private worker gateway: confirm worker token, reservations and provider cost settlement',
 'lib/intrigue-ai/governed-provider-fetch.ts':'Browser AI gate: confirm INTRIGUE_AI_BROWSER_METERING_ENABLED=true',
 'lib/intrigue-ai/server.ts':'Credential verification (no inference calls)',
 'lib/intrigue-ai/voice-gate.ts':'Vapi phone/assistant ownership verification (no phone calls)',
 'tools/intrigue-v17/quotation-analysis.mjs':'Legacy direct fallback: confirm INTRIGUE_AI_WORKER_METERING_ENABLED=true on every worker',
 'tools/intrigue-ai/audit-provider-paths.mjs':'Audit tool: provider URL definitions, no network calls',
};
const matches=[];
function walk(dir){
 if(!fs.existsSync(dir))return;
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','.next','.git','dist','reports','coverage'].includes(entry.name))continue;
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())walk(file);
  else if(/\.(?:js|mjs|cjs|ts|tsx)$/.test(entry.name)){
   const rel=path.relative(root,file).replaceAll('\\','/');
   const src=fs.readFileSync(file,'utf8');
   const positions=src.split(/\r?\n/).flatMap((line,index)=>recognized.some(host=>line.includes(host))?[index+1]:[]);
   if(positions.length)matches.push({file:rel,lines:positions,classification:allowed[rel]||'REVIEW: verify company authorization and metering'});
  }
 }
}
for(const dir of ['app','lib','tools'])walk(path.join(root,dir));
const reviews=matches.filter(m=>m.classification.startsWith('REVIEW'));
console.log('INTRIGUE provider-call inventory (file/line only, no secrets):');
for(const m of matches)console.log(`${m.file}:${m.lines.join(',')}  ${m.classification}`);
console.log(`Total: ${matches.length} provider-call files; ${reviews.length} unclassified.`);
console.log('This static audit cannot establish live routing or billing. Verify all sources, including outbound Vapi/3CX, before claiming platform-wide limits.');
if(process.argv.includes('--strict')&&reviews.length)process.exitCode=2;
