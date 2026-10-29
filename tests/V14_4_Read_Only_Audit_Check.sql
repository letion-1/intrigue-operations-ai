-- INTRIGUE V14.4 READ-ONLY verification (Supabase SQL Editor)
-- This file is not a migration. It cannot create/delete customer records or consume quotas.
SELECT 'membership audit table exists' AS test,
  CASE WHEN to_regclass('private.intrigue_membership_events') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT 'membership audit trigger installed',
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='v144_membership_audit' AND NOT tgisinternal) THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'owner audit RPC exists',
  CASE WHEN to_regprocedure('public.get_intrigue_membership_history(uuid,integer)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'anonymous audit RPC blocked',
  CASE WHEN NOT has_function_privilege('anon','public.get_intrigue_membership_history(uuid,integer)','EXECUTE') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'audit table not readable to members',
  CASE WHEN NOT has_table_privilege('authenticated','private.intrigue_membership_events','SELECT') THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'audit table not writable to members',
  CASE WHEN NOT has_table_privilege('authenticated','private.intrigue_membership_events','INSERT') THEN 'PASS' ELSE 'FAIL' END;
