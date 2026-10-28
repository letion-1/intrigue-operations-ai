# INTRIGUE V12: Private staging-cloud deployment

**Status:** Deployment kit only. Nothing is deployed automatically. The existing V10/V11 dashboard and business logic remain unchanged. Use **fictional demo records only**. **Do not invite customers yet**.

## What the kit changes
- Updates `workers/intrigue-worker.mjs`: continuous processing, graceful shutdown, heartbeat, capped polling/backoff, demo-only safeguards.
- Adds `database/08_worker_heartbeat.sql` for worker heartbeat monitoring. No old data is deleted.
- Adds `render.yaml`, a paid continuous worker definition in the Frankfurt region. It is not a web service.
- Adds `check-deploy-safety.ps1` and `.gitignore` exclusions to help prevent committing local secrets and backups.
- Does not add email sending, CRM, Vapi, billing, or multi-tenant provisioning.

## Part A: local installation and security

1. Extract V12 ZIP. In PowerShell, run `powershell -NoProfile -ExecutionPolicy Bypass -File "<extracted-folder>\install-v12.ps1"` or use the auto-install command from ChatGPT.
2. In Supabase **Ai_automation** → **SQL Editor**, paste **only** `database/08_worker_heartbeat.sql` and run it. No other new SQL is required.
3. Stop any local continuous worker before launching the cloud worker. It is safe to run the worker twice for the demo queue, but it complicates diagnosing which instance processed a test job.
4. Ensure Git is installed. In VS Code PowerShell:

   ```powershell
   cd "$HOME\Projects\intrigue-operations-ai"
   git init
   git add -A
   .\check-deploy-safety.ps1
   ```

   **Do not push if the check fails.** Additional files can contain credentials that the checker won't detect. Review `git status --short`, and never upload `.env.local`, `.env.local.backup`, secret files, or your email/password exports. If a secret has *ever* been pushed, removing the file is not enough: rotate that credential.
5. Create a **private** GitHub repository, e.g. `intrigue-operations-ai-staging`. Push the project using the instructions GitHub gives you, or authenticate with GitHub CLI. Do not share repository access publicly.

## Part B: Render worker (always-on)

1. Open https://dashboard.render.com and connect your **private** GitHub repository.
2. Create a **Blueprint** using the repository's root `render.yaml`, and review pricing before authorizing deployment. This is a **paid background worker** even for a staging test. Alternatively, manually create a Background Worker using the same settings.
3. When Render prompts for secrets, fill in:

   | Render environment variable | Where to get it |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project API URL (public) |
   | `SUPABASE_SECRET_KEY` | Dedicated `sb_secret_...` key from Supabase API Keys (secret) |

   Do not place `SUPABASE_SECRET_KEY` in a Vercel environment variable or a browser bundle. The key bypasses RLS; create a separate one for this worker so it can be rotated independently. **Never paste the key into ChatGPT or GitHub.**
4. Render settings: type `Background Worker`, runtime `Node`, region `Frankfurt`, build `npm ci --omit=dev`, start `node workers/intrigue-worker.mjs`, **1 instance**, `INTRIGUE_WORKER_MODE=demo`.
5. Render logs should show `INTRIGUE V12 worker started (continuous; demo-only)`.

## Part C: Vercel staging dashboard

1. Open https://vercel.com/new → Import the same private GitHub repository as a **Next.js** app. Use **Preview/Deployment Protection** for testing and don't publish its link to clients. For commercial use, Vercel's Hobby plan is not permitted: choose an appropriate paid plan before serving business customers.
2. Add only the variables actually needed by the app (values are from your *existing staging* `.env.local`, never commit it):

   - `NEXT_PUBLIC_SUPABASE_URL` (public URL)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (public key)
   - `OPENROUTER_API_KEY` (server-only; never prefix with `NEXT_PUBLIC_`)
   - `OPENROUTER_MODEL` (your working model ID, if configured)

   **Do not add `SUPABASE_SECRET_KEY` to Vercel.** The current dashboard's customer queries use the signed-in user's Supabase session. Secrets should stay in Render.
3. Choose Deploy and verify the build succeeds. After Vercel gives you its URL, add it to Supabase → Authentication → URL Configuration → **Redirect URLs** (e.g. `https://your-project.vercel.app/**`). Keep localhost allowed too. Update Site URL only when ready to switch the default. Verify sign-in and dashboard access on the hosted domain.
4. Configure preview deployment protection (Vercel) and restrict access to test users in Supabase Auth. The current prototype has owner-only workspace authorization, not a full commercial multi-tenant implementation.

## Part D: verify worker while laptop is OFF

1. In the hosted INTRIGUE staging dashboard, use **Automation Center** to queue an approved fictional quotation that has not yet had a demo receipt job. The queue enforces one receipt job per approved quotation proposal; use a different approved demo quotation if Maria's is already completed.
2. Watch Render → Logs for `Claimed job ...` and `Completed job ...`.
3. Refresh Automation Center. Job should switch from `queued` to `completed` and show one attempt.
4. Stop the local worker and turn off the laptop. Later, use your phone (with authentication) to check the same hosted dashboard and Render status. The worker should keep running independently.
5. In Supabase SQL Editor, inspect fresh heartbeats with:

   ```sql
   select worker_id, status, last_seen,
          now() - last_seen as heartbeat_age,
          completed_jobs, failed_attempts
   from public.automation_worker_heartbeats
   order by last_seen desc;
   ```

   Normal target: at least one `running` worker with last_seen around the past 60 seconds. This is an operational indicator, **not** a guarantee that the service will never fail.
6. Enable Render's built-in service alerts/notifications and monitor error logs and the `automation_jobs` table. This kit doesn't install a 24/7 external alert dispatcher or a production SLA.

## Important limits before paying clients

- V11/V12 process only a harmless demo quotation receipt. No customer emails, invoices or external side effects.
- Service-role secrets bypass RLS. The worker must only call tightly scoped, reviewed functions; do not pass untrusted SQL into admin clients.
- Current Supabase project is shared with development. Create an independent production project before taking real customer data.
- No verified production load testing, autoscaling, customer quotas, incident response, backup restoration, or full multi-tenant security has been completed yet.
- Repeated jobs are **at-least-once**, not automatically exactly-once for future third-party effects. Real connectors require idempotency keys and compensation workflows.

## Troubleshooting

- **No new work is processed:** check Render worker is running and V11 SQL was previously installed in the same Supabase project.
- **Worker starts then exits:** confirm the correct key and URL are in Render environment settings; inspect its logs. Check `INTRIGUE_WORKER_MODE=demo`.
- **Heartbeat fails:** run `08_worker_heartbeat.sql` in Supabase. It doesn't run in VS Code.
- **Next.js site has a login redirect issue:** add your exact Vercel origin to Supabase Auth redirect allowlist.
- **Private repo shows environment files:** stop and do not share; rotate leaked secrets and remove them from Git history.

Verified against V11 file names and worker RPC signatures. Local JavaScript syntax / package static checks are performed as part of packaging, but live cloud deployment must still be tested on your accounts.
