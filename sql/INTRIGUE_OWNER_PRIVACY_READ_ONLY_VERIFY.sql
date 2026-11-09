-- INTRIGUE owner-only company deletion authorization audit
-- READ ONLY: does not alter users, companies, permissions, or functions.
-- Run after deploying; all results must be TRUE. Static checks do not replace
-- a live Staff/Admin API-denial test using actual restricted user sessions.
WITH f AS (
 SELECT
   pg_get_functiondef(to_regprocedure('public.intrigue_rc2_request(text,uuid)')) AS intake,
   pg_get_functiondef(to_regprocedure('public.intrigue_rc2_preview()')) AS preview,
   pg_get_functiondef(to_regprocedure('public.intrigue_rc2_delete_empty_workspace(uuid,uuid,text)')) AS deletion,
   pg_get_functiondef(to_regprocedure('public.intrigue_rc2_offer_transfer(uuid,uuid,uuid)')) AS transfer
)
SELECT 'Intake uses caller identity' AS security_check,
       COALESCE(intake LIKE '%auth.uid()%', FALSE) AS passed FROM f
UNION ALL
SELECT 'Company erasure intake checks owner_id',
       COALESCE(intake LIKE '%owner_id = v_actor%', FALSE) FROM f
UNION ALL
SELECT 'Preview returns only caller-owned company',
       COALESCE(preview LIKE '%owner_id=v_user%', FALSE) FROM f
UNION ALL
SELECT 'Deletion RPC checks company owner',
       COALESCE(deletion LIKE '%owner_id=v_user%', FALSE) FROM f
UNION ALL
SELECT 'Ownership transfer RPC checks company owner',
       COALESCE(transfer LIKE '%owner_id=v_owner%', FALSE) FROM f
UNION ALL
SELECT 'Destructive company deletion RPC inaccessible to staff',
       NOT has_function_privilege('authenticated',
         'public.intrigue_rc2_delete_empty_workspace(uuid,uuid,text)', 'EXECUTE')
UNION ALL
SELECT 'Ownership transfer RPC inaccessible to staff',
       NOT has_function_privilege('authenticated',
         'public.intrigue_rc2_offer_transfer(uuid,uuid,uuid)', 'EXECUTE')
UNION ALL
SELECT 'Personal erasure intake remains accessible',
       has_function_privilege('authenticated',
         'public.intrigue_rc2_request(text,uuid)', 'EXECUTE');
