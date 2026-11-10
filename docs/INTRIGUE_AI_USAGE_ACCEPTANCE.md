# INTRIGUE | Usage governance acceptance

## What this release installs

- Company-owner-only AI provider panel in **Integrations** (OpenRouter and Vapi key verification and encrypted storage).
- Independent private-operator page at `/platform/ai-usage` to set each workspace's monthly AI USD and voice-minute allowances.
- Service-only, tenant-scoped Supabase tables for plans, credentials and idempotent usage events.
- An internal OpenRouter text gateway that can enforce a workspace budget **when it is called**.
- A worker adapter module for reviewed integration into `tools/intrigue-v17/worker.mjs`.

## What it does NOT activate

- Existing AI assistant, worker and receptionist still use their original paths. The new ledger cannot be assumed to meter those paths until the actual code has been inspected and rerouted.
- BYOK modes remain locked by default, even after provider keys are saved.
- Call minute enforcement cannot be guaranteed from a completed-call webhook alone. Call admission and transfer/voicemail fallback require Vapi routing validation.
- Direct OpenAI, Claude and Retell adapters are deliberately deferred, rather than exposed as nonworking toggles.

## Safe installation order

1. Back up Supabase and save the Git commit reference, then run `sql/INTRIGUE_AI_GOVERNANCE.sql` in Supabase SQL Editor. All eight verification columns must be `true`.
2. Set a new **random 32-byte base64** `INTRIGUE_AI_CREDENTIAL_ENCRYPTION_KEY` in Vercel; copy it safely to `.env.local` only for necessary development. Keep it stable and back it up securely; losing it makes stored provider keys irrecoverable.
3. Install the source package in the existing repository. Build and deploy; confirm Vercel Ready.
4. Sign in as a company Owner. Integrations > **AI providers & usage** should show the company plan. Sign in as a Viewer and confirm the management API returns 403.
5. Check OpenRouter and Vapi key validation with dedicated low-privilege TEST keys; never paste a key into this chat. Both must disappear from the UI immediately after saving and must not appear in network GET responses.
6. Sign in through private admin `/platform/login` and use `/platform/ai-usage` to set budgets for ORBIT THREAD QA and Northline Auto. Confirm only the selected workspace changes.
7. Set `INTRIGUE_AI_WORKER_TOKEN` (random 32+ char string) in Vercel **and** in the local worker environment. Set `INTRIGUE_AI_APPROVED_MODEL` to a separately verified low-cost OpenRouter model slug, and `INTRIGUE_AI_RESERVATION_USD` conservatively (default $1 per request). Test the gateway from a trusted developer test, not from browser code.
8. Verify 409 on repeated request IDs, 429 when the managed allowance is exhausted, and 403 on frozen company. No quota bypass across workspaces. Failed or unknown provider responses stay reserved pending reconciliation.
9. Review source ZIP generated using `tools/intrigue-ai/collect-runtime-sources.ps1` to integrate the existing worker, AI assistant API and Vapi callback. After patching them and passing real end-to-end tests, turn on `INTRIGUE_AI_BYOK_ACTIVATION_ENABLED=true` for text. Only activate `INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=true` after Vapi call routing, key ownership and budget handling are truly working.

## Commercial accuracy

- Dollar-cost ledger is a conservative internal usage view, not a customer invoice. Provider fees, taxes and currency conversion are separate.
- A prepaid allowance can still be exceeded by the actual provider charge for one reserved request. Set provider-level account/key caps as a separate safeguard.
- With external calls and jobs in flight, the 100% threshold is not a mathematically guaranteed provider billing ceiling. Reservations reduce risk but do not replace provider-side limits.
- Never delete new tables without updating the V21 erasure registry. This migration registers all three tables and adds the same closing-workspace triggers.
