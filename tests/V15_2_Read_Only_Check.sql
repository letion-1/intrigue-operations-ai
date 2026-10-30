-- INTRIGUE V15.2 configuration check: READ ONLY. No test writes.
WITH checks AS (
  SELECT 'RLS enabled on applications' AS check_name, EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='workspace_pilot_requests' AND c.relrowsecurity
  ) AS passed
  UNION ALL SELECT 'Anonymous cannot read applications',
    NOT has_table_privilege('anon','public.workspace_pilot_requests','SELECT')
  UNION ALL SELECT 'Applicants cannot change status',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','status','UPDATE')
  UNION ALL SELECT 'Applicants cannot set review message',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','review_message','UPDATE')
  UNION ALL SELECT 'Applicants cannot change reviewed timestamp',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','reviewed_at','UPDATE')
  UNION ALL SELECT 'Applicants cannot insert review message',
    NOT has_column_privilege('authenticated','public.workspace_pilot_requests','review_message','INSERT')
  UNION ALL SELECT 'Private review events have RLS', EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relname='intrigue_pilot_review_events' AND c.relrowsecurity
  )
  UNION ALL SELECT 'No authenticated access to private audit history',
    NOT has_table_privilege('authenticated','private.intrigue_pilot_review_events','SELECT')
  UNION ALL SELECT 'Review function is not browser-executable',
    NOT has_function_privilege('authenticated',
      'private.v152_review_pilot(uuid,text,text)','EXECUTE')
  UNION ALL SELECT 'Anonymous cannot call review function',
    NOT has_function_privilege('anon','private.v152_review_pilot(uuid,text,text)','EXECUTE')
  UNION ALL SELECT 'Review audit trigger exists', EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname='v152_pilot_review_audit' AND NOT tgisinternal
  )
  UNION ALL SELECT 'Owner-only pilot read policy still installed', EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workspace_pilot_requests'
      AND policyname='v151_owner_read_pilot' AND qual LIKE '%owner_id%'
  )
)
SELECT check_name, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY check_name;
