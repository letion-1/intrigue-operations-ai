-- INTRIGUE V15.2 | DATABASE OPERATOR ONLY (Supabase SQL Editor as postgres)
-- Do NOT paste these statements into the browser or application source.
-- Keep real client details out of staging until privacy/security readiness passes.

-- 1. View submitted applications (operator-only, database administrator).
SELECT w.id AS workspace_id, w.name AS company_name, p.contact_email,
       p.estimated_seats, p.status, p.submitted_at, p.reviewed_at, p.review_message
FROM public.workspace_pilot_requests p
JOIN public.workspaces w ON w.id=p.workspace_id
ORDER BY p.submitted_at DESC;

-- 2. To mark ONE application as contacted, supply its exact workspace_id:
-- SELECT private.v152_review_pilot(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'contacted',
--   'We will contact you to discuss a fictional evaluation.'
-- );

-- 3. To close ONE application (does NOT approve or activate anything):
-- SELECT private.v152_review_pilot(
--   '00000000-0000-0000-0000-000000000000'::uuid,
--   'closed',
--   'This preview application has been closed.'
-- );

-- 4. Read the private audit history as database operator:
SELECT w.name, e.event_at, e.event_type, e.old_status,
       e.new_status, e.applicant_message
FROM private.intrigue_pilot_review_events e
JOIN public.workspaces w ON w.id=e.workspace_id
ORDER BY e.event_at DESC LIMIT 50;
