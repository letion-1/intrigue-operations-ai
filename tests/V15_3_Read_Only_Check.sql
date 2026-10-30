-- V15.3 integration + CRM import readiness (READ ONLY)
SELECT 'Integration preference RLS enabled' check_name,
CASE WHEN EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='workspace_integration_preferences' AND c.relrowsecurity)
THEN 'PASS' ELSE 'FAIL' END result
UNION ALL SELECT 'Integration prefs anonymous reads denied',
CASE WHEN NOT has_table_privilege('anon','public.workspace_integration_preferences','SELECT') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'CRM contact key table private',
CASE WHEN NOT has_table_privilege('authenticated','private.intrigue_crm_contact_references','SELECT') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'Only signed-in users can invoke import RPC',
CASE WHEN NOT has_function_privilege('anon','public.import_intrigue_crm_contacts(uuid,text,jsonb)','EXECUTE')
AND has_function_privilege('authenticated','public.import_intrigue_crm_contacts(uuid,text,jsonb)','EXECUTE')
THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT 'Customer phone field exists',
CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
AND table_name='customers' AND column_name='phone') THEN 'PASS' ELSE 'FAIL' END;
