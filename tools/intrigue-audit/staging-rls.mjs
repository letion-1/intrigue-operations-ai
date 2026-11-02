#!/usr/bin/env node
/** Non-destructive, opt-in, staging-only RLS cross-tenant read test.
 *  No service-role key, no writes, no data values returned/logged.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TABLES = ['customers','enquiries','quotations','follow_ups','services','knowledge_entries','intrigue_mail_deliveries','intrigue_outlook_deliveries'];
export function classify({error,count}) {
  if (error) {
    if (/PGRST205|42P01|does not exist|not found|column .* does not exist|42703/i.test(error.code||' '+error.message)) return 'REVIEW_SCHEMA';
    if (/42501|permission denied|not allowed|forbidden/i.test(error.code||' '+error.message)) return 'DENIED';
    return 'REVIEW_ERROR';
  }
  return count===0?'ZERO_ROWS':Number(count)>0?'DATA_LEAK':'REVIEW_RESULT';
}
const isEntry=process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if (isEntry) {
  const { createClient } = await import('@supabase/supabase-js');
  const e=process.env;
  const required=['INTRIGUE_V17_STAGING_URL','INTRIGUE_V17_STAGING_ANON_KEY','INTRIGUE_V17_A_EMAIL','INTRIGUE_V17_A_PASSWORD','INTRIGUE_V17_A_WORKSPACE','INTRIGUE_V17_B_EMAIL','INTRIGUE_V17_B_PASSWORD','INTRIGUE_V17_B_WORKSPACE'];
  if(e.INTRIGUE_V17_STAGING_ATTESTATION!=='I_VERIFIED_ISOLATED_STAGING') {
    console.error('STOP: Explicit isolated staging attestation is required. Production must never be tested.'); process.exit(2);
  }
  if(required.some(k=>!e[k])) {console.error('STOP: Staging-only test credentials and workspace IDs are required.'); process.exit(2);}
  if(e.INTRIGUE_V17_A_WORKSPACE===e.INTRIGUE_V17_B_WORKSPACE || e.INTRIGUE_V17_A_EMAIL.toLowerCase()===e.INTRIGUE_V17_B_EMAIL.toLowerCase()) {console.error('STOP: Need two distinct test users with separate workspaces.');process.exit(2);}
  const url=new URL(e.INTRIGUE_V17_STAGING_URL);
  if(!/^https:$/.test(url.protocol)) {console.error('STOP: HTTPS required.');process.exit(2);}
  // Do not allow the known INTRIGUE production project if available.
  if(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'')===url.href.replace(/\/$/,'')) {
    console.error('STOP: staging URL equals current project URL; use a separate staging Supabase project.');process.exit(2);
  }
  const client=(who)=>createClient(url.href,e.INTRIGUE_V17_STAGING_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'X-INTRIGUE-Audit':'v17-read-only'}}});
  const A=client('A'), B=client('B');
  for (const [name,c,email,password] of [['A',A,e.INTRIGUE_V17_A_EMAIL,e.INTRIGUE_V17_A_PASSWORD],['B',B,e.INTRIGUE_V17_B_EMAIL,e.INTRIGUE_V17_B_PASSWORD]]) {
    const {error}=await c.auth.signInWithPassword({email,password});
    if(error) { console.error(`STOP: Staging user ${name} authentication failed (credentials not logged).`);process.exit(2);}
  }
  let failed=false,review=0;
  for (const [name,c,foreign] of [['A',A,e.INTRIGUE_V17_B_WORKSPACE],['B',B,e.INTRIGUE_V17_A_WORKSPACE]]) {
    for(const table of TABLES) {
      const {error,count}=await c.from(table).select('*',{count:'exact',head:true}).eq('workspace_id',foreign);
      const state=classify({error,count});
      console.log(`${name} -> foreign workspace | ${table}: ${state}`);
      if(state==='DATA_LEAK') failed=true;
      if(state.startsWith('REVIEW')) review++;
    }
  }
  await Promise.all([A.auth.signOut(),B.auth.signOut()]);
  if(failed) {console.error('FAIL: Foreign-workspace rows visible! Do not use with customer data.');process.exitCode=1;}
  else if(review) {console.warn(`INCOMPLETE: ${review} results need manual schema/permission review; not certified.`);process.exitCode=3;}
  else console.log('PASS for the tested table filters only. Review privileged RPCs and all API endpoints separately.');
}
