'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const root=process.cwd();
const source=p=>fs.readFileSync(`${root}/${p}`,'utf8');
test('liveness exposes only non-sensitive status',()=>{
  const code=source('app/api/health/route.ts');
  assert.match(code,/status:\s*'ok'/);
  assert.doesNotMatch(code,/SUPABASE_SERVICE_ROLE_KEY|token:|user_id|workspace_id/);
});
test('platform console has server-side operator authorization',()=>{
  const code=source('app/api/platform/console/route.ts');
  assert.match(code,/mustBeOperator\(ctx\)/);
});
test('company erasure requires verified identity and fresh session',()=>{
  const code=source('app/api/company/erasure/route.ts');
  assert.match(code,/recentlySignedIn/);
  assert.match(code,/identity\(|preview\(/);
});
test('notification API is authenticated',()=>{
  const code=source('app/api/support-notifications/route.ts');
  assert.match(code,/platformAuth|identity\s*\(/);
});
test('default response security headers are installed',()=>{
  const code=source('next.config.ts');
  for(const h of ['X-Content-Type-Options','X-Frame-Options','Referrer-Policy'])assert.ok(code.includes(h),h);
});
test('offline banner and responsive improvements are wired',()=>{
  assert.match(source('app/layout.tsx'),/NetworkConnectionNotice/);
  assert.match(source('app/layout.tsx'),/prelaunch-hardening\.css/);
  assert.match(source('app/prelaunch-hardening.css'),/max-width: 767px/);
});
test('error fallback does not display raw error details',()=>{
  assert.doesNotMatch(source('app/error.tsx'),/error\.message|error\.stack/);
  assert.doesNotMatch(source('app/global-error.tsx'),/error\.message|error\.stack/);
});
test('supervisor invokes existing worker with duplicate-process lock',()=>{
  const code=source('tools/intrigue-prelaunch/worker-supervisor.mjs');
  assert.match(code,/tools\/intrigue-v17\/worker\.mjs/);
  assert.match(code,/openSync\(lock, 'wx'/);
  assert.match(code,/failures>=5/);
});
test('branding is from user PNG and requires deliberate apply',()=>{
  const code=source('tools/intrigue-prelaunch/prepare-brand.mjs');
  assert.match(code,/public\/intrigue-mark\.png/);
  assert.match(code,/--apply/);
  assert.doesNotMatch(code,/imagegen|generate a new logo/i);
});
