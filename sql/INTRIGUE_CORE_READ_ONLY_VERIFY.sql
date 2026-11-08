-- Read-only confirmation after installing the consolidated migration.
SELECT
  to_regprocedure('public.intrigue_v17_claim_fair(integer)') AS fair_claim,
  to_regprocedure('public.intrigue_core_create_support_followup()') AS auto_followup,
  to_regprocedure('public.intrigue_core_followup_integrity()') AS assignment_guard;

SELECT
  w.name AS workspace,
  f.id AS followup_id,
  f.title,
  f.status,
  f.source_intent,
  f.source_enquiry_id,
  f.assigned_to,
  e.subject AS linked_enquiry
FROM public.follow_ups f
JOIN public.workspaces w ON w.id = f.workspace_id
LEFT JOIN public.enquiries e ON e.id = f.source_enquiry_id AND e.workspace_id = f.workspace_id
WHERE w.name = 'ORBIT THREAD QA'
ORDER BY f.updated_at DESC
LIMIT 30;

-- Should return 0 for any cross-workspace linked follow-up.
SELECT COUNT(*) AS cross_workspace_link_mismatches
FROM public.follow_ups f
JOIN public.enquiries e ON e.id=f.source_enquiry_id
WHERE f.source_enquiry_id IS NOT NULL AND e.workspace_id<>f.workspace_id;
