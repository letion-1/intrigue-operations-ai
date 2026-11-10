-- PRIVATE PLATFORM ADMINISTRATOR: execute ONLY after creating and verifying a
-- NEW, SEPARATE Supabase Auth user in Authentication > Users. Do not use the
-- email that owns any existing client workspace. This SQL does not create a user.
-- Replace REPLACE_WITH_PRIVATE_ADMIN_EMAIL before running.
BEGIN;
DO $setup$
DECLARE v_email text := lower(trim('REPLACE_WITH_PRIVATE_ADMIN_EMAIL'));
DECLARE v_actor uuid;
BEGIN
 IF v_email='replace_with_private_admin_email' OR position('@' in v_email)=0 THEN
   RAISE EXCEPTION 'Enter the actual, separate administrator email before running.';
 END IF;
 IF to_regclass('private.intrigue_platform_operators') IS NULL THEN
   RAISE EXCEPTION 'Platform operator registry missing. Apply platform migration first.';
 END IF;
 SELECT id INTO v_actor FROM auth.users
 WHERE lower(email)=v_email AND email_confirmed_at IS NOT NULL;
 IF v_actor IS NULL THEN
   RAISE EXCEPTION 'Admin login must be created and email verified in Supabase Auth first.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id=v_actor)
    OR EXISTS(SELECT 1 FROM public.workspaces WHERE owner_id=v_actor) THEN
   RAISE EXCEPTION 'Administrator login is already a company owner/member. Use a separate login.';
 END IF;
 INSERT INTO private.intrigue_platform_operators(user_id,active)
 VALUES(v_actor,true) ON CONFLICT(user_id) DO UPDATE SET active=true;
 UPDATE private.intrigue_platform_operators
 SET active = (user_id=v_actor) WHERE user_id<>v_actor;
END;
$setup$;
-- Defense in depth: even if platform operator membership is misconfigured,
-- no company-owner or company-member identity may be a platform operator.
CREATE OR REPLACE FUNCTION public.intrigue_platform_is_operator(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS (
  SELECT 1 FROM private.intrigue_platform_operators o
  WHERE o.user_id=p_actor AND o.active
   AND NOT EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.user_id=p_actor)
   AND NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.owner_id=p_actor)
 )
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_is_operator(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_is_operator(uuid) TO service_role;
COMMIT;
-- Read-only verification: a dedicated active operator with no company access.
SELECT
 count(*) FILTER (WHERE o.active)=1 AS one_active_platform_admin,
 count(*) FILTER (WHERE o.active AND (m.user_id IS NOT NULL OR w.owner_id IS NOT NULL))=0 AS no_client_membership,
 count(*) FILTER (WHERE o.active AND public.intrigue_platform_is_operator(o.user_id))=1 AS authorization_enabled
FROM private.intrigue_platform_operators o
LEFT JOIN LATERAL(SELECT user_id FROM public.workspace_memberships WHERE user_id=o.user_id LIMIT 1)m ON true
LEFT JOIN LATERAL(SELECT owner_id FROM public.workspaces WHERE owner_id=o.user_id LIMIT 1)w ON true;
