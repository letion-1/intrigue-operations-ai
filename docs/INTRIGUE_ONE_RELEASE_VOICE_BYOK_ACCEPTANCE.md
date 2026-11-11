# INTRIGUE Operations AI — consolidated AI & Voice acceptance

This release adds the **inbound Vapi call gate**, reserved-minute accounting,
company-verified provider routing, private-operator phone setup, post-call
settlement, and a **read-only provider inventory**. It does **not** silently turn
any existing phone number over to the new gate.

## Before deployment

1. Take a Supabase backup; apply `sql/INTRIGUE_VOICE_GATE_AND_OPERATIONS.sql` in Supabase **SQL Editor**, not PowerShell. All seven checks should be `true` on first install. A later active route makes `no_calls_activated_by_migration` legitimately `false`.
2. Run the complete installer against the current repository and confirm the production build.
3. Confirm Vercel **Ready** on the new commit and all existing integrations remain connected.
4. Keep `INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=false`, `INTRIGUE_AI_BYOK_ACTIVATION_ENABLED=false` until the corresponding provider routing tests pass. For the text assistant/agent, turn on `INTRIGUE_AI_BROWSER_METERING_ENABLED=true` only after a measured test in both workspaces. Keep `INTRIGUE_AI_WORKER_METERING_ENABLED=true` in **every** production worker environment (currently local).
5. Configure `INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED=true` in Vercel for verified, authenticated end-of-call reports. The existing Vapi assistant webhook remains `/api/integrations/vapi/webhook`.

## Vapi inbound call setup (per phone number)

1. In the private administrator `/platform/ai-usage` page choose a fictional test workspace.
2. In **Inbound receptionist protections**, enter the Vapi phone-number ID and **existing** Vapi assistant ID. Select Managed or Company-owned billing and generate a one-time bearer token. Do not paste the token into chat, docs or Git.
3. In **Vapi → Integrations → Server Configuration**, create a Custom Credential → Bearer Token using that token, `Authorization` header, Bearer prefix enabled.
4. Set the **phone-number** Server URL to `https://YOUR_APP/api/integrations/vapi/call-gate` and select that custom credential. **Remove the phone's fixed `assistantId`.** Without dynamic assistant selection Vapi never calls the gate.
5. Keep the **saved assistant** server URL on `https://YOUR_APP/api/integrations/vapi/webhook`, using its original authorized credential, so Google Calendar, Calendly, call history and cost recording keep working.
6. In the Vapi assistant Advanced settings, publish a `maxDurationSeconds` between **60–1800 seconds**. INTRIGUE reserves that full duration before each inbound call (conservative concurrency control). A company with less than one call's maximum duration remaining cannot start another managed call; change the assistant's maximum duration if needed.
7. Configure the Vapi API key for verification. For Managed mode, set `INTRIGUE_VAPI_MANAGED_API_KEY` (or existing `VAPI_API_KEY`) in Vercel. For Company-owned mode, the company must verify & store its own Vapi key via Integrations. These keys are never sent to the browser after saving.
8. Back in the private admin page, choose **Verify Vapi and activate**. The server checks ownership of both phone and assistant, dynamic routing, saved server credential and assistant webhook, and duration limit. Failed checks leave the route inactive.
9. Make **one fictional inbound call**. Verify: allowed before budget exhaustion; booking tools work; once the call finishes, the `vapi:<call-id>` ledger row changes from `reserved` to `settled` with actual seconds and cost; no second row is created. Check Vapi end-of-call reports. **Any pending or expired reservation is a deployment blocker** until reconciled.
10. Set managed minutes to **0** for that test company, call again, and confirm the gate declines the AI assistant *before* a new reservation and emits the monthly voice notice. Set the allowance back afterward.

### Fallback behavior

Vapi may end the call or speak the error message after an `assistant-request` denial. Configure a human or voicemail fallback in Vapi using the documented `call.ending` hook if desired. **Do not assume a free transfer**: telephony/transfer fees may still apply. Test both allowed and denied calls before using live customer numbers.

### Company-owned voice billing

After the owner connects Vapi and the same company's call gate is verified, the private admin can set the phone `provider_mode=byok`. Turn on the global `INTRIGUE_VOICE_BYOK_ACTIVATION_ENABLED=true` only after a managed and BYOK test. Then the company owner may choose **Use my account** in Integrations. BYOK changes who pays *provider charges*; INTRIGUE still enforces workspace access and logs call duration. Confirm the phone and assistant actually exist in that company's Vapi organization. Do not silently move Managed phone numbers to BYOK.

### Text BYOK

The existing text gateway selects the workspace's stored OpenRouter key only when `text_mode=byok` and the BYOK activation flag is enabled. Confirm all background workers have metering enabled; confirm the dashboard assistant, agent, semantic search, proposals and other AI routes use the governed gateway. Run:

```powershell
node .\tools\intrigue-ai\audit-provider-paths.mjs --strict
```

Classify any unrecognized direct provider call before enabling BYOK globally. Then test against a fictional workspace with its own inference key, and check **both provider bills**, not just the usage ledger, to prove that INTRIGUE's managed key was not charged. If a provider cannot prove this, keep BYOK inactive.

### Operations monitoring

- Private admin shows active Vapi routes, reserved minutes, unreconciled calls and old pending reservations.
- Managed monthly voice allowance is counted from settled seconds plus all pending reserved seconds. It is fail-closed and resets by **UTC calendar month**.
- At the end of each call the authenticated **assistant webhook** settles the original reservation. A missing report leaves the reservation held; never auto-cancel uncertain charges.
- Existing inbound numbers with fixed assistants, outbound calls, 3CX/other telephony trunks, and other providers not routed through this gate are **not protected by this release**. Include them in the operator audit and route them through equivalent admission checks before commercial claims of a platform-wide hard limit.
- Validate freeze behavior, 20-workspace isolation, replayed call IDs, concurrent calls near allowance, callback failure, and removal of a provider key. Keep a human support escalation process.

## Verification SQL (read-only)

```sql
SELECT workspace_id,request_key,kind,payer,status,reserved_seconds,actual_seconds,
       actual_usd,created_at,updated_at
FROM public.intrigue_ai_usage_ledger
WHERE kind='voice' ORDER BY created_at DESC LIMIT 30;
```

**No deployment in this ZIP changes your existing voice numbers automatically.** Phone configuration, real call testing, and operator review are necessary to activate and certify this release.
