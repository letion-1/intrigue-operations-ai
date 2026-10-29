-- INTRIGUE: Company membership directory (Supabase SQL Editor ONLY)
-- READ ONLY. SQL Editor is privileged: do NOT expose this query as a public RPC.
-- ACTIVE MEMBERS including the Owner, grouped by company.
SELECT
  w.name AS company_name,
  u.email AS account_email,
  m.role AS company_role,
  m.created_at AS joined_at,
  w.id AS workspace_id
FROM public.workspace_memberships AS m
JOIN public.workspaces AS w ON w.id = m.workspace_id
JOIN auth.users AS u ON u.id = m.user_id
ORDER BY w.name, CASE WHEN m.role='owner' THEN 0 ELSE 1 END, u.email;

-- OPTIONAL: former members with preserved accepted invitation records.
-- Run this separate query if you want to inspect REMOVED access.
-- SELECT w.name AS previous_company, u.email AS former_member_email,
--        i.accepted_at, 'REMOVED / NO CURRENT MEMBERSHIP' AS access_status
-- FROM public.workspace_invitations i
-- JOIN public.workspaces w ON w.id = i.workspace_id
-- JOIN auth.users u ON u.id = i.accepted_by
-- WHERE i.status='accepted' AND i.accepted_by IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM public.workspace_memberships m
--                   WHERE m.workspace_id=i.workspace_id AND m.user_id=i.accepted_by)
-- ORDER BY w.name, i.accepted_at DESC;
