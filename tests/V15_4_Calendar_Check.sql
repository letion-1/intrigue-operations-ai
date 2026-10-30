-- INTRIGUE V15.4 installation checks. READ ONLY.
SELECT 'private OAuth storage table exists' AS check_name,
  CASE WHEN to_regclass('private.intrigue_calendar_connections') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'OAuth table RLS enabled', CASE WHEN EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname='intrigue_calendar_connections' AND c.relrowsecurity
) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'Anonymous storage SELECT denied', CASE WHEN NOT has_table_privilege('anon','private.intrigue_calendar_connections','SELECT') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'Authenticated storage SELECT denied', CASE WHEN NOT has_table_privilege('authenticated','private.intrigue_calendar_connections','SELECT') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'Anonymous RPC execute denied', CASE WHEN NOT has_function_privilege('anon','public.intrigue_calendar_connection(uuid,text,text,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'Authenticated RPC execute enabled with owner checks', CASE WHEN has_function_privilege('authenticated','public.intrigue_calendar_connection(uuid,text,text,text)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END;
