-- OPERATOR ONLY: run in Supabase SQL Editor (admin privileges), not from the app.
-- Lists workspace plan interest, NOT payments, subscriptions or entitlements.
SELECT w.name AS company,
       owner.email AS owner_email,
       COALESCE(p.requested_tier,'no request') AS requested_plan,
       p.request_notes,
       p.requested_at
FROM public.workspaces w
JOIN auth.users owner ON owner.id=w.owner_id
LEFT JOIN public.workspace_plan_interest p ON p.workspace_id=w.id
ORDER BY p.requested_at DESC NULLS LAST,w.name;
