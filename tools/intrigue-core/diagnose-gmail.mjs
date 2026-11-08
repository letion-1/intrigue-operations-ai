#!/usr/bin/env node
/** Read-only Gmail setup preflight. Never logs client secrets, tokens or passwords. */
const vars=['INTRIGUE_APP_URL','GOOGLE_GMAIL_CLIENT_ID','GOOGLE_GMAIL_CLIENT_SECRET','INTRIGUE_MAIL_ENCRYPTION_KEY','SUPABASE_SERVICE_ROLE_KEY'];
const present = name => Boolean(String(process.env[name] || '').trim());
for(const name of vars) console.log(`${name}: ${present(name) ? 'configured' : 'MISSING'}`);
let invalid = vars.some(name=>!present(name));
try {
  const url = new URL(process.env.INTRIGUE_APP_URL || '');
  if(url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname==='localhost')) throw Error();
  if(url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error();
  console.log('Expected Google OAuth redirect URI:',`${url.origin}/api/mail/google/callback`);
  console.log('Confirm this exact URI is registered in Google Cloud Console for the production OAuth client.');
} catch {
  console.error('INTRIGUE_APP_URL must be the exact HTTPS app origin (no path/query).');
  invalid = true;
}
console.log('Note: this checks local .env.local, not the Vercel production environment.');
if(invalid) process.exitCode=1;
