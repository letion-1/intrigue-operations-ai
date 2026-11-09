-- INTRIGUE V21 acceptance counts (read only). Run before and after testing on a
-- DISPOSABLE staging company. Do not delete any existing production workspace.
SELECT w.id AS workspace_id,w.name,w.intrigue_erasure_state,
 (SELECT COUNT(*) FROM public.customers c WHERE c.workspace_id=w.id) AS customers,
 (SELECT COUNT(*) FROM public.enquiries e WHERE e.workspace_id=w.id) AS enquiries,
 (SELECT COUNT(*) FROM public.quotations q WHERE q.workspace_id=w.id) AS quotations,
 (SELECT COUNT(*) FROM public.intrigue_v17_runs r WHERE r.workspace_id=w.id) AS ai_runs,
 (SELECT COUNT(*) FROM public.workspace_memberships m WHERE m.workspace_id=w.id) AS members
FROM public.workspaces w ORDER BY w.name,w.id;

SELECT COUNT(*) AS closing_write_guards
FROM pg_trigger t
WHERE t.tgname='intrigue_v21_stop_closing_writes' AND NOT t.tgisinternal;

SELECT c.id AS receipt_id,c.state,c.finished_at,c.deleted_counts,c.completion_notes
FROM private.intrigue_v21_erasure_cases c
ORDER BY c.created_at DESC LIMIT 10;
