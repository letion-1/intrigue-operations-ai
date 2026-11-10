# Approved quotation worker: governed AI integration

## What changes
The existing V17 quotation worker retains human-approval requirements, workspace-scoped DB reads, catalog validation, and internal-draft-only outcomes. With the worker-local `INTRIGUE_AI_WORKER_METERING_ENABLED=true` flag, a new sales quotation AI classification calls the existing **private Vercel AI gateway** instead of contacting OpenRouter directly. The gateway reserves a workspace-specific budget amount before calling the provider, and uses the company plan to choose managed or BYOK credentials if the relevant later activation flags permit BYOK.

The worker uses the server-issued approved run workspace ID and stable `quote:<run.id>` request key. If the gateway rejects, times out or returns a duplicate, the worker **fails closed** rather than falling back to the local OpenRouter key. A failed call may leave a reservation pending reconciliation. Non-sales protection can route requests without contacting a model.

## Setup before controlled testing
1. Confirm the earlier governance migration (8/8) remains installed. This release needs **no new SQL**.
2. Confirm the earlier Governance and Runtime Integration packages are deployed and Vercel shows Ready.
3. Add `INTRIGUE_AI_WORKER_TOKEN` (long, random, private) in Vercel **Production**. Add `INTRIGUE_AI_APPROVED_MODEL` set to a verified affordable OpenRouter model supporting `response_format:json_object` and optionally `INTRIGUE_AI_RESERVATION_USD` (default $1). Redeploy if environment changes require it.
4. On your *local worker's* `.env.local`, configure `INTRIGUE_APP_URL=https://intrigue-operations-ai-5ywh.vercel.app` (the **app**, not your marketing website) and the **same** private `INTRIGUE_AI_WORKER_TOKEN`. Do not put secrets in public environment variables or paste them in chat.
5. Keep `INTRIGUE_AI_BYOK_ACTIVATION_ENABLED=false` and `INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=false`. This release does not enable those settings. First test the managed provider route.
6. **Only while testing with fictional QA workspaces**, stop the worker, add `INTRIGUE_AI_WORKER_METERING_ENABLED=true` to the worker environment, and restart the worker.

## Acceptance checks
1. Confirm a fictional approved sales quotation creates **one** request key `quote:<run UUID>` in `intrigue_ai_usage_ledger` for the correct workspace, with managed provider selected.
2. Confirm model result is still only an **internal draft** awaiting the normal human approval; no email, refund, booking or customer update occurs automatically.
3. Confirm non-sales exchange/order status routes continue without paid AI classification where protected by deterministic intent rules.
4. Reduce only the fictional workspace's allowance in private Admin and verify a new paid classification is rejected *before* contacting OpenRouter; another workspace must remain unaffected.
5. Confirm a frozen workspace cannot reserve a new paid call.
6. Confirm same request key cannot be replayed to double-bill. For ambiguous provider timeouts or unknown costs, leave the reservation pending and reconcile it before retrying; do not clear it blindly.
7. Return `INTRIGUE_AI_WORKER_METERING_ENABLED=false` if any discrepancy appears. This restores the previous local worker selector.

## Known unprotected paths and release boundary
- The uploaded Vapi source covers **tool calls and end-of-call reports**, plus calendar and call-history modules. It contains no Vapi phone-number assignment or incoming-call authorization hook that can stop charges **before a call starts**. The post-call ledger recorder is not a hard voice cap. Voice BYOK and voice caps remain **OFF**.
- The full repository has other model/embeddings/proposals paths and potentially third-party workflows. The earlier browser-metering flag covers only inspected routes. Do not advertise global hard spending caps until **every** paid path uses the same gate, reconciles usage, and provider-level spending limits are configured.
- The worker still needs local PC uptime. No always-on hosting is introduced.
- Do not assume reservations equal provider's actual bill: the estimate may undercount; provider-level spending controls are necessary.
