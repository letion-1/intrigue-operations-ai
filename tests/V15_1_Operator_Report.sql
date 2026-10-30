-- OPERATOR ONLY: Run inside Supabase SQL Editor as a database administrator.
-- Never use this broad company report in browser code or public API routes.
SELECT w.name AS company_name, p.contact_name, p.contact_email, p.estimated_seats,
  p.intended_use, p.success_criteria, p.preferred_start, p.status,
  p.submitted_at, p.updated_at
FROM public.workspace_pilot_requests p
JOIN public.workspaces w ON w.id=p.workspace_id
ORDER BY p.submitted_at DESC;
-- To mark an application as contacted, manually review it and update in Table Editor
-- using an administrator session. Do not expose an update-status browser endpoint.
