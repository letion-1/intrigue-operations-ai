-- INTRIGUE V15.5: Configuration-only verification. Does not simulate a call.
WITH checks AS (
 SELECT 'private connection table exists' AS check_name,
   to_regclass('private.intrigue_vapi_connections') IS NOT NULL AS passed
 UNION ALL SELECT 'call receipts table exists',
   to_regclass('public.intrigue_vapi_call_events') IS NOT NULL
 UNION ALL SELECT 'call receipts RLS enabled',
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='intrigue_vapi_call_events' AND c.relrowsecurity)
 UNION ALL SELECT 'anonymous call receipt SELECT denied',
   NOT has_table_privilege('anon','public.intrigue_vapi_call_events','SELECT')
 UNION ALL SELECT 'authenticated receipt INSERT denied',
   NOT has_table_privilege('authenticated','public.intrigue_vapi_call_events','INSERT')
 UNION ALL SELECT 'owner management RPC restricted from anon',
   NOT has_function_privilege('anon','public.intrigue_vapi_manage(uuid,text,uuid)','EXECUTE')
 UNION ALL SELECT 'owner management RPC available to authenticated',
   has_function_privilege('authenticated','public.intrigue_vapi_manage(uuid,text,uuid)','EXECUTE')
 UNION ALL SELECT 'webhook RPC callable by anon after token verification',
   has_function_privilege('anon','public.intrigue_vapi_inbound(text,uuid,text,text,text)','EXECUTE')
 UNION ALL SELECT 'webhook RPC has explicit security definer mode',
   EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.intrigue_vapi_inbound(text,uuid,text,text,text)') AND prosecdef)
 UNION ALL SELECT 'owner call-log read policy installed',
   EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='intrigue_vapi_call_events' AND policyname='v155_owner_view_call_events')
)
SELECT check_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result FROM checks ORDER BY check_name;
