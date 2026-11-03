// Static defense-in-depth contract checks for the V17.1B audit-only dashboard.
// These are NOT live authentication, RLS or API integration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const api=readFileSync(resolve(root,'app/api/automation/v17/route.ts'),'utf8');
const sql=readFileSync(resolve(root,'sql/INTRIGUE_V17_1B_RUN_CONTROLS.sql'),'utf8');
const ui=readFileSync(resolve(root,'app/dashboard/automation/AutomationCentreV2.tsx'),'utf8');
const dashboard=readFileSync(resolve(root,'app/dashboard/page.tsx'),'utf8');
test('API verifies signed-in user, membership and workspace before privileged operations',()=>{
  assert.match(api,/auth\.getUser\(token\)/);
  assert.match(api,/from\('workspace_memberships'\)/);
  assert.match(api,/\['owner','admin'\]/);
  assert.match(api,/from\('workspaces'\)/);
  assert.match(api,/crossOrigin\(request\)/);
});
test('API is restricted to manual, audit-only, approval-required workflows',()=>{
  assert.match(api,/trigger_type:'manual',action_type:'audit_event'/);
  assert.match(api,/requires_approval:true/);
  assert.match(api,/workflow\.trigger_type!=='manual'/);
  assert.match(api,/workflow\.action_type!=='audit_event'/);
  assert.match(api,/workflow\.requires_approval!==true/);
  assert.doesNotMatch(api,/(?:\/api\/mail\/send|\/api\/integrations\/vapi|fetch\(\s*['"]https:\/\/)/);
});
test('Cancellation and retry stay scoped and remain service-role-only',()=>{
  for(const name of ['cancel','retry']) {
    assert.match(sql,new RegExp(`intrigue_v17_${name}\\(`));
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.intrigue_v17_${name}`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.intrigue_v17_${name}.*TO service_role`,'s'));
  }
  assert.match(sql,/workspace_id=p_workspace_id/);
  assert.match(sql,/approved_at IS NOT NULL/);
  assert.match(sql,/status IN \('awaiting_approval','queued','retry_wait'\)/);
});
test('Dashboard preserves legacy queue, review gate and safe worker mode',()=>{
  assert.match(dashboard,/Previous test jobs/);
  assert.match(dashboard,/<AutomationCentreV2/);
  assert.match(ui,/Awaiting approval/);
  assert.match(ui,/No external messages or customer updates/);
  assert.match(ui,/mode:'audit_only'/);
});

// Prevent the Next.js 16 cacheComponents build failure found during V17.1B rollout.
test('V17 route uses Cache Components compatible route configuration',()=>{
  assert.doesNotMatch(api,/^export\s+const\s+(?:runtime|dynamic|revalidate|fetchCache|preferredRegion|maxDuration)\s*=/m);
  assert.match(api,/Cache-Control.*no-store/);
});
