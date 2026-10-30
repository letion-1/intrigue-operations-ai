-- INTRIGUE V15.1 configuration audit. READ ONLY.
WITH checks AS (
  SELECT 'Pilot table exists' AS check_name,
    to_regclass('public.workspace_pilot_requests') IS NOT NULL AS passed
  UNION ALL SELECT 'Pilot RLS enabled', EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='workspace_pilot_requests' AND c.relrowsecurity
  )
  UNION ALL SELECT 'Anonymous cannot read pilot requests',
    NOT has_table_privilege('anon','public.workspace_pilot_requests','SELECT')
  UNION ALL SELECT 'Owners have read policy', EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workspace_pilot_requests'
      AND policyname='v151_owner_read_pilot'
  )
  UNION ALL SELECT 'Only submitted requests can be edited', EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workspace_pilot_requests'
      AND policyname='v151_owner_edit_submitted_pilot'
      AND qual LIKE '%submitted%' AND with_check LIKE '%submitted%'
  )
  UNION ALL SELECT 'Users cannot update status',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','status','UPDATE')
  UNION ALL SELECT 'Users cannot update workspace ID',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','workspace_id','UPDATE')
)
SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY check_name;
