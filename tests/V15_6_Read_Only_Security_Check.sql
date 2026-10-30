-- INTRIGUE V15.6 read-only configuration check. No writes.
WITH checks AS (
 SELECT 'Voice booking table exists' AS check_name, to_regclass('public.intrigue_voice_booking_settings') IS NOT NULL AS passed
 UNION ALL SELECT 'Voice booking RLS enabled', EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='intrigue_voice_booking_settings' AND c.relrowsecurity)
 UNION ALL SELECT 'Anonymous users cannot read booking settings', NOT has_table_privilege('anon','public.intrigue_voice_booking_settings','SELECT')
 UNION ALL SELECT 'Private attempts table exists', to_regclass('private.intrigue_voice_booking_attempts') IS NOT NULL
 UNION ALL SELECT 'Private attempts RLS enabled', EXISTS (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='private' AND c.relname='intrigue_voice_booking_attempts' AND c.relrowsecurity)
 UNION ALL SELECT 'Authenticated cannot read booking attempts', NOT has_table_privilege('authenticated','private.intrigue_voice_booking_attempts','SELECT')
 UNION ALL SELECT 'No anonymous booking configuration writes', NOT has_table_privilege('anon','public.intrigue_voice_booking_settings','INSERT')
 UNION ALL SELECT 'Voice booking default disabled', EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='intrigue_voice_booking_settings' AND column_name='booking_enabled'
    AND column_default ILIKE '%false%')
 UNION ALL SELECT 'Vapi calendar context not executable by signed-in browser', NOT has_function_privilege('authenticated','public.intrigue_v156_voice_calendar_context(text,uuid)','EXECUTE')
 UNION ALL SELECT 'Vapi booking claim only executable from webhook auth role',
   has_function_privilege('anon','public.intrigue_v156_voice_claim(text,uuid,text,text,timestamptz,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.intrigue_v156_voice_claim(text,uuid,text,text,timestamptz,text)','EXECUTE')
)
SELECT check_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY check_name;
