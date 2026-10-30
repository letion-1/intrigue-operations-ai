-- INTRIGUE V15.7 read-only structural security inspection.
-- This tests catalog permissions only, NOT actual caller or OAuth access.
SELECT 'google credentials private schema' AS check_name,
  CASE WHEN n.nspname='private' THEN 'PASS' ELSE 'FAIL' END result
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname='intrigue_google_connections'
UNION ALL
SELECT 'google credentials RLS enabled',
  CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_catalog.pg_class c WHERE c.oid='private.intrigue_google_connections'::regclass
UNION ALL
SELECT 'google credentials anonymous SELECT blocked',
 CASE WHEN has_table_privilege('anon','private.intrigue_google_connections','SELECT')=false THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'booking attempts anonymous SELECT blocked',
 CASE WHEN has_table_privilege('anon','private.intrigue_google_booking_attempts','SELECT')=false THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'booking attempts RLS enabled',
 CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_catalog.pg_class c WHERE c.oid='private.intrigue_google_booking_attempts'::regclass
UNION ALL
SELECT 'settings RLS enabled', CASE WHEN c.relrowsecurity THEN 'PASS' ELSE 'FAIL' END
FROM pg_catalog.pg_class c WHERE c.oid='public.intrigue_google_booking_settings'::regclass
UNION ALL
SELECT 'settings public write blocked',
 CASE WHEN has_table_privilege('anon','public.intrigue_google_booking_settings','INSERT')=false THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'google owner connection anon RPC blocked',
 CASE WHEN has_function_privilege('anon','public.intrigue_v157_google_owner_connection(uuid,text,text)','EXECUTE')=false THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 'google Vapi context anon RPC permitted',
 CASE WHEN has_function_privilege('anon','public.intrigue_v157_google_context(text,uuid)','EXECUTE')=true THEN 'PASS' ELSE 'FAIL' END;
