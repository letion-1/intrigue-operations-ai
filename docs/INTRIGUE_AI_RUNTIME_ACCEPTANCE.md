# INTRIGUE AI Runtime Integration: rollout and acceptance

## Scope
- Existing signed-in `/api/agent` and `/api/assistant` routes can route their OpenRouter chat requests through the workspace budget ledger, without changing the business tools or approval behavior.
- Semantic embeddings created by these routes use the same workspace budget gate when enabled. Other embedding callers without an authenticated workspace fail closed when the gate is enabled.
- Existing Vapi webhook can optionally record end-of-call cost and duration **only** if the validated `intrigue_vapi_inbound` RPC response supplies a trusted `workspace_id`/`tenant_id`, and the event contains numeric cost and timestamps. It never trusts the workspace from the external call payload.
- The existing V17 quotation worker is not modified: `tools/intrigue-v17/quotation-analysis.mjs` was absent from the collected archive. Therefore worker requests remain outside the new budget gate.

## Flags (default OFF)
- `INTRIGUE_AI_BROWSER_METERING_ENABLED=true` routes two verified dashboard endpoints and their embeddings through `intrigue_ai_reserve`/`intrigue_ai_settle`.
- `INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED=true` enables BEST-EFFORT recording of completed Vapi calls. This **does not** enforce a maximum number of incoming calls or call minutes.
- Keep `INTRIGUE_AI_BYOK_ACTIVATION_ENABLED=false` and `INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=false` until the worker, embedding writers, call-routing and company billing are tested end to end.

## Deployment & acceptance
1. Confirm governance SQL already passed (8/8); **do not rerun it**. Confirm encryption key exists in Vercel.
2. Run installer from the current clean project checkout. The installer checks file hashes and refuses to overwrite unknown local changes.
3. Ensure full Next.js production build passes. Confirm GitHub push and Vercel **Ready**.
4. With both runtime flags still OFF, confirm normal agent/assistant and receptionist tools continue working.
5. Set an extremely small AI allowance for a fictional workspace using private Admin, not a real client. Verify only its own workspace is affected.
6. Turn on browser metering for controlled testing (a global flag affects every dashboard AI workspace, so do this when client traffic is absent). Test a chat, an agent tool call, semantic search and a rejected budget. Confirm no provider call occurs on rejection and usage ledger costs settle.
7. Test a second workspace and frozen-workspace denial. Verify open workspaces are unaffected.
8. For Vapi, verify trusted `intrigue_vapi_inbound` response actually returns a workspace ID. If not, leave voice postcall flag OFF. If yes, test a fake/isolated call and verify idempotent ledger entry. Still do NOT claim a voice cap.
9. Collect `tools/intrigue-v17/quotation-analysis.mjs`, Vapi provisioning/assistant assignment and all embedding writers. The missing code must be reviewed before BYOK or mandatory budget enforcement can be enabled.

## Known gaps
- `INTRIGUE_AI_BROWSER_METERING_ENABLED` covers only two inspected dashboard routes and their embedding requests. Some other routes and the worker may still use provider credentials. Not a platform-wide cap yet.
- Post-call Vapi metering depends on the trusted RPC returning a workspace identifier, which this archive cannot prove. If missing, no ledger record is written.
- Voice caps cannot be hard enforced using an end-of-call webhook: billing has already occurred before it fires. Real enforcement needs call-creation/routing controls and preflight reservations, plus an appropriate fallback.
- OpenRouter provider costs not returned immediately remain reserved for reconciliation. Provider actual costs can exceed preauthorizations; provider-level spending controls remain necessary.
- The existing `consume_intrigue_ai_quota` remains in the UI routes as an independent anti-abuse/legacy quota.
- Do not market the application as unlimited or fully metered until all execution paths are included.
