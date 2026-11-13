-- INTRIGUE Data Management: READ-ONLY production preflight.
-- It does not call prepare / download / execute and makes no data changes.
-- Run in Supabase SQL Editor. Review all results and STOP if any check fails.
WITH expected(name) AS (VALUES
 ('intrigue_dm_preview'),
 ('intrigue_dm_prepare'),
 ('intrigue_dm_download'),
 ('intrigue_dm_execute')
), functions AS (
 SELECT e.name,p.oid,p.prosecdef,p.pronargs,
        has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
        pg_get_function_identity_arguments(p.oid) AS signature
 FROM expected e
 LEFT JOIN pg_proc p ON p.proname=e.name AND p.pronamespace='public'::regnamespace
)
SELECT name,oid IS NOT NULL AS exists,COALESCE(prosecdef,false) AS security_definer,
       COALESCE(anon_execute,false) AS anon_can_execute,
       COALESCE(authenticated_execute,false) AS signed_in_can_execute,
       COALESCE(signature,'MISSING') AS function_args
FROM functions ORDER BY name;

-- RLS and table security (if table exists).  No table contents are read.
SELECT table_schema,table_name,row_security AS rls_enabled
FROM information_schema.tables t
LEFT JOIN LATERAL (
 SELECT c.relrowsecurity AS row_security FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=t.table_schema AND c.relname=t.table_name
) x ON true
WHERE t.table_schema IN ('private','public')
  AND t.table_name IN ('intrigue_dm_backups','intrigue_dm_audit','intrigue_receptionist_calls')
ORDER BY 1,2;

-- Do not infer owner-scoped behavior from presence or RLS alone.
-- Review function definitions for authenticated owner checks, pinned search_path,
-- workspace_id filters, backup ownership and transactional rollback before
-- testing destructive actions. Also test with separate workspace accounts.
