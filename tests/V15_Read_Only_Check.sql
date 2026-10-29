-- V15.0 | Read-only configuration check. Expected four PASS rows.
WITH checks AS (
  SELECT 'Plan-interest RLS enabled' AS check_name,
    (SELECT relrowsecurity FROM pg_class WHERE oid='public.workspace_plan_interest'::regclass) AS ok
  UNION ALL SELECT 'Anonymous SELECT denied',
    NOT has_table_privilege('anon','public.workspace_plan_interest','SELECT')
  UNION ALL SELECT 'Owner policies installed (3)',
    (SELECT count(*)=3 FROM pg_policies WHERE schemaname='public'
     AND tablename='workspace_plan_interest'
     AND policyname IN ('v15_plan_interest_owner_read','v15_plan_interest_owner_insert','v15_plan_interest_owner_update'))
  UNION ALL SELECT 'No direct authenticated DELETE grant',
    NOT has_table_privilege('authenticated','public.workspace_plan_interest','DELETE')
)
SELECT check_name,CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY check_name;
