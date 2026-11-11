# INTRIGUE | Allowance messaging and notification acceptance

This release adds **no new AI provider connections**, **no automatic billable actions**, and **no modification to the monthly budget reservation algorithm**. It makes genuine budget denials comprehensible and notifies authorized company owners and the private administrator.

## Requirements

- Complete `sql/INTRIGUE_AI_BUDGET_NOTICES.sql` in Supabase SQL Editor. Check all six `true` fields before installing code.
- Deploy the source and confirm Vercel **Ready** for the new commit.
- Keep BYOK and voice activation disabled. Use fictional ORBIT THREAD QA data only.
- Keep `INTRIGUE_AI_WORKER_METERING_ENABLED=true` locally for a controlled worker test.
- Never paste service keys, tokens, `.env.local`, or real customer records into chat.

## Test

1. In Admin AI Usage Management, temporarily set ORBIT's managed AI allowance to **$0**. Confirm a save success message.
2. Approve a **new** fictional sales quotation analysis requiring AI. Do not run your worker continuously; use `node --env-file=.env.local .\\tools\\intrigue-v17\\worker.mjs --once` once when the test job is eligible.
3. In Automation Center, verify the job displays **allowance reached** with a human-friendly message, and no quotation is offered for saving. The worker technically records a completed budget gate, not a completed AI analysis; the API presents an allowance-specific outcome. An actual provider HTTP 429 must still retry normally.
4. Verify the client's bell shows **Monthly AI allowance reached**. Clicking should open the dashboard's Security & Usage area. It should have beige/white styling in light mode and navy/gold in dark mode.
5. Sign in as the separate private administrator. Verify the bell displays a usage alert with ORBIT as the workspace. Clicking should open AI Usage Management.
6. Repeat one denied fictional job. Confirm the alert count **doesn't increase** this billing month. Only one alert is created per company/kind/month.
7. Switch to Northline Auto in the admin UI. Its allowance and ledger must be unaffected.
8. Restore ORBIT's previous allowance. Confirm a new approved quotation can succeed. Any earlier `retry_wait` jobs from before this release may still be present; review those manually.
9. Check both themes on a narrow mobile viewport and in desktop. Bell dropdown must stay onscreen, text must be readable and theme button must retain visible contrast.
10. In Admin AI Usage Management, micro-charges above 0 and under $0.01 should display **Less than $0.01** instead of `$0.00`.

## Notes

- Client cost alerts are shown to the **workspace owner**. Other company staff continue to see ticket notifications but not sensitive spending notices.
- A budget denial is *not* an OpenRouter model error. The server identifies it by the governance reservation reason and sends its own `AI_ALLOWANCE_EXHAUSTED` code. No additional provider call is made.
- The underlying worker `intrigue_v17_finish` only supports success/failure retry semantics in the inspected source. A confirmed budget refusal is recorded as a **completed non-billable gate** with `outcome:'allowance_exhausted'`; the API maps this to `allowance_reached` for the dashboard. No quotation can be saved from that result, and new work must be explicitly initiated after adding usage.
- Existing voice Vapi hard call-start protection is still pending. This release does not claim production-wide hard caps.
- No existing support tickets or usage history are modified. A new notification table is included in V21 workspace erasure.
