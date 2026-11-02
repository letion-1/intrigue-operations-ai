-- INTRIGUE V17.0: READ-ONLY DATABASE INVENTORY
-- Safe to run in Supabase SQL Editor: SELECTs only. No changes or deletions.
-- Query 1: table RLS status and policy counts
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  COUNT(p.policyname) AS policy_count,
  CASE
    WHEN NOT c.relrowsecurity THEN 'REVIEW: RLS DISABLED'
    WHEN COUNT(p.policyname) = 0 THEN 'REVIEW: NO EXPLICIT POLICY (MAY BE INTENTIONAL DENY)'
    ELSE 'POLICIES EXIST - TEST REQUIRED'
  END AS assessment
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policies p
  ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')
GROUP BY n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
ORDER BY n.nspname,c.relname;

-- Query 2: RLS policies, roles and predicates (inspect sensitive table names)
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual AS using_expression, with_check AS with_check_expression
FROM pg_catalog.pg_policies
WHERE schemaname IN ('public','private')
ORDER BY schemaname,tablename,policyname;

-- Query 3: SECURITY DEFINER functions, search_path and ACL descriptions.
-- These are candidates for manual reviews, not proof of vulnerabilities.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS argument_signature,
       p.prosecdef AS security_definer,
       COALESCE(array_to_string(p.proconfig,', '),'NOT EXPLICIT') AS function_config,
       COALESCE(array_to_string(p.proacl,', '),'DEFAULT - REVIEW EXECUTE GRANTS') AS grants
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prosecdef IS TRUE
ORDER BY n.nspname,p.proname;

-- Query 4: foreign keys to auth.users, important for account deletion.
SELECT n.nspname AS referencing_schema,
       c.relname AS referencing_table,
       k.conname AS foreign_key_name,
       pg_catalog.pg_get_constraintdef(k.oid) AS foreign_key_definition
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE k.contype='f' AND k.confrelid='auth.users'::regclass
ORDER BY referencing_schema,referencing_table,foreign_key_name;

-- Query 5: workspace-id columns indicating possible tenant-bound tables.
SELECT table_schema,table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema IN ('public','private')
  AND (column_name IN ('workspace_id','owner_id','user_id','actor_id'))
ORDER BY table_schema,table_name,column_name;
