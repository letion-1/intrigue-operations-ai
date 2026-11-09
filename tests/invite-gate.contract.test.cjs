"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = p=>fs.readFileSync(path.join(root,p),'utf8');

test('Invitations use the dedicated join flow',()=>{
  const dashboard=read('app/dashboard/page.tsx');
  assert.match(dashboard,/\/join\?token=\$\{data\}/);
  assert.doesNotMatch(dashboard,/\/dashboard\?join=\$\{data\}/);
  assert.doesNotMatch(dashboard,/onSubmit=\{createCompany\}/);
  assert.match(dashboard,/No company workspace assigned/);
});

test('Unauthenticated join is public and pending invites survive confirmation',()=>{
  const proxy=read('lib/supabase/proxy.ts');
  assert.match(proxy,/intrigue_pending_invite/);
  assert.match(proxy,/request\.nextUrl\.pathname !== "\/join"/);
  // A guest must be allowed to POST its invitation before creating a login.
  assert.match(proxy,/request\.nextUrl\.pathname !== "\/api\/invitations\/pending"/);
  assert.match(read('app/auth/confirm/route.ts'),/redirect\(safeNext\)/);
  const join=read('app/join/page.tsx');
  assert.match(join,/accept_intrigue_team_invite_secure/);
  assert.match(join,/emailRedirectTo/);
  assert.match(join,/signInWithPassword/);
  assert.doesNotMatch(join,/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_.*SERVICE_ROLE/);
});

test('Invitation state is a short-lived, protected cookie',()=>{
  const cookie=read('app/api/invitations/pending/route.ts');
  assert.match(cookie,/httpOnly:\s*true/);
  assert.match(cookie,/sameSite:\s*"lax"/);
  assert.match(cookie,/60 \* 60 \* 2/);
  assert.match(cookie,/TOKEN\.test/);
});

test('Generic signup is invite-only',()=>{
  const signup=read('app/auth/sign-up/page.tsx');
  assert.match(signup,/Registration by invitation/);
  assert.doesNotMatch(signup,/SignUpForm/);
});
