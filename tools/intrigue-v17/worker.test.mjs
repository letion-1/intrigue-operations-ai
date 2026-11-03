import test from 'node:test';
import assert from 'node:assert/strict';
import {executeSafeAction} from './worker.mjs';
const fixture = {id:'run',workspace_id:'ws',workflow_id:'wf',lease_token:'lease',approved_at:'2026-11-03T00:00:00Z'};
test('approved run executes only internal audit action',()=>{
  assert.deepEqual(executeSafeAction(fixture), {kind:'audit_event',result:'processed_without_external_side_effects',workflow_id:'wf'});
});
test('unapproved run is blocked',()=>assert.throws(()=>executeSafeAction({...fixture,approved_at:null}),/fail closed/));
test('missing lease is blocked',()=>assert.throws(()=>executeSafeAction({...fixture,lease_token:null}),/Incomplete lease/));
