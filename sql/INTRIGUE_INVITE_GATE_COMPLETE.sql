-- INTRIGUE Operations AI: independent secure employee invitation system.
-- Production migration. Existing company/customer/member records are untouched.
-- This replaces (and revokes) legacy client-facing invite RPCs.
-- IMPORTANT: Verified DB backup first. If preflight raises STOP, do not deploy.
BEGIN;

DO $preflight$
DECLARE v_required text;
BEGIN
  IF to_regclass('public.workspaces') IS NULL OR
     to_regclass('public.workspace_memberships') IS NULL OR
     to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'STOP: Required workspace/auth schema missing';
  END IF;
  IF to_regclass('public.intrigue_secure_team_invitations') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: Secure invitation table already exists; inspect migration history before rerunning';
  END IF;
  IF COALESCE((SELECT NOT relrowsecurity FROM pg_class WHERE oid='public.workspaces'::regclass),true)
     OR COALESCE((SELECT NOT relrowsecurity FROM pg_class WHERE oid='public.workspace_memberships'::regclass),true) THEN
    RAISE EXCEPTION 'STOP: Workspace and membership RLS must be enabled';
  END IF;
  FOREACH v_required IN ARRAY ARRAY['id','owner_id'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.workspaces'::regclass
      AND attname=v_required AND attnum>0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'STOP: Missing workspace column %',v_required;
    END IF;
  END LOOP;
  FOREACH v_required IN ARRAY ARRAY['workspace_id','user_id','role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.workspace_memberships'::regclass
      AND attname=v_required AND attnum>0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'STOP: Missing membership column %',v_required;
    END IF;
  END LOOP;
  -- The secure acceptance routine writes only the 3 verified membership fields.
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.workspace_memberships'::regclass
      AND attnum>0 AND NOT attisdropped AND attnotnull
      AND attname NOT IN ('workspace_id','user_id','role')
      AND NOT atthasdef AND attidentity='' AND attgenerated=''
  ) THEN
    RAISE EXCEPTION 'STOP: Membership table contains other required fields; adapt the guarded insert first';
  END IF;
  IF to_regprocedure('public.create_intrigue_company(text)') IS NULL THEN
    RAISE EXCEPTION 'STOP: Expected company creation RPC missing or has changed signature';
  END IF;
END;
$preflight$;

-- Never store raw invitation tokens. A new 64-hex token is generated for each
-- invitation, hashed with SHA256. Only the hash is retained in Postgres.
CREATE TABLE public.intrigue_secure_team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','staff','viewer')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX intrigue_secure_invites_workspace_status
  ON public.intrigue_secure_team_invitations(workspace_id,status,created_at DESC);
ALTER TABLE public.intrigue_secure_team_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.intrigue_secure_team_invitations FROM PUBLIC, anon, authenticated;

-- Owner only: create an expiring invitation and receive a one-time token.
CREATE OR REPLACE FUNCTION public.create_intrigue_secure_team_invite(
  p_workspace_id uuid, p_email text, p_role text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $create$
DECLARE v_user uuid; v_email text; v_token text;
BEGIN
  v_user := (SELECT auth.uid());
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR v_user IS NULL OR
     NOT EXISTS (SELECT 1 FROM public.workspaces w
                 WHERE w.id=p_workspace_id AND w.owner_id=v_user) THEN
    RAISE EXCEPTION 'Only the company owner may invite employees';
  END IF;
  v_email := lower(btrim(coalesce(p_email,'')));
  IF length(v_email)<3 OR length(v_email)>254 OR
     v_email !~* '^[^@ ]+@[^@ ]+\.[^@ ]+$' THEN
    RAISE EXCEPTION 'Invalid invitation email';
  END IF;
  IF p_role NOT IN ('admin','staff','viewer') THEN
    RAISE EXCEPTION 'Invalid invited role';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u
    JOIN public.workspace_memberships m ON m.user_id=u.id
    WHERE m.workspace_id=p_workspace_id AND lower(u.email)=v_email) THEN
    RAISE EXCEPTION 'This email is already a member of the workspace';
  END IF;
  IF EXISTS (SELECT 1 FROM public.intrigue_secure_team_invitations i
    WHERE i.workspace_id=p_workspace_id AND i.invited_email=v_email
      AND i.status='pending' AND i.expires_at>now()) THEN
    RAISE EXCEPTION 'A pending invitation already exists for this email';
  END IF;
  -- Two independent random UUIDv4 values yield ~244 bits of randomness.
  v_token := replace(pg_catalog.gen_random_uuid()::text,'-','') ||
             replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO public.intrigue_secure_team_invitations
    (workspace_id,invited_email,role,token_hash,created_by,expires_at)
  VALUES (p_workspace_id,v_email,p_role,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),'hex'),
    v_user, now()+interval '7 days');
  RETURN v_token;
END;
$create$;
REVOKE ALL ON FUNCTION public.create_intrigue_secure_team_invite(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_intrigue_secure_team_invite(uuid,text,text)
  TO authenticated;

-- Owner only: list token-free invitation metadata for the Team screen.
CREATE OR REPLACE FUNCTION public.list_intrigue_secure_team_invites(p_workspace_id uuid)
RETURNS TABLE(id uuid,invited_email text,role text,status text,
              expires_at timestamptz,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $list$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR
     NOT EXISTS (SELECT 1 FROM public.workspaces w
       WHERE w.id=p_workspace_id AND w.owner_id=(SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  RETURN QUERY SELECT i.id,i.invited_email,i.role,i.status,i.expires_at,i.created_at
    FROM public.intrigue_secure_team_invitations i
    WHERE i.workspace_id=p_workspace_id AND i.status='pending' AND i.expires_at>now()
    ORDER BY i.created_at DESC LIMIT 100;
END;
$list$;
REVOKE ALL ON FUNCTION public.list_intrigue_secure_team_invites(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_intrigue_secure_team_invites(uuid) TO authenticated;

-- Owner only: revoke an unused invitation.
CREATE OR REPLACE FUNCTION public.revoke_intrigue_secure_team_invite(p_invitation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $revoke$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR
     NOT EXISTS (SELECT 1 FROM public.intrigue_secure_team_invitations i
       JOIN public.workspaces w ON w.id=i.workspace_id
       WHERE i.id=p_invitation_id AND w.owner_id=(SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Owner access required';
  END IF;
  UPDATE public.intrigue_secure_team_invitations
    SET status='revoked' WHERE id=p_invitation_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is no longer pending'; END IF;
END;
$revoke$;
REVOKE ALL ON FUNCTION public.revoke_intrigue_secure_team_invite(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_intrigue_secure_team_invite(uuid) TO authenticated;

-- Invitee only: independently validate verified email, expiry, role, workspace,
-- one-time token and membership before atomically inserting membership.
CREATE OR REPLACE FUNCTION public.accept_intrigue_team_invite_secure(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $accept$
DECLARE
  v_user uuid;
  v_email text;
  v_verified timestamptz;
  v_inv public.intrigue_secure_team_invitations%ROWTYPE;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation token';
  END IF;
  v_user := (SELECT auth.uid());
  IF v_user IS NULL OR (SELECT auth.role()) IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Sign in with the invited email';
  END IF;
  SELECT u.email,u.email_confirmed_at INTO v_email,v_verified
    FROM auth.users u WHERE u.id=v_user;
  IF v_email IS NULL OR v_verified IS NULL THEN
    RAISE EXCEPTION 'Confirm the invited email before joining';
  END IF;
  SELECT i.* INTO v_inv FROM public.intrigue_secure_team_invitations i
    WHERE i.token_hash=pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex')
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  IF v_inv.status<>'pending' THEN
    RAISE EXCEPTION 'Invitation already used or revoked';
  END IF;
  IF v_inv.expires_at<=now() THEN RAISE EXCEPTION 'Invitation expired'; END IF;
  IF v_inv.invited_email<>lower(btrim(v_email)) THEN
    RAISE EXCEPTION 'Invitation belongs to a different verified email';
  END IF;
  IF v_inv.role NOT IN ('admin','staff','viewer') THEN
    RAISE EXCEPTION 'Invitation role invalid';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=v_inv.workspace_id) THEN
    RAISE EXCEPTION 'Invitation workspace unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id=v_inv.workspace_id AND m.user_id=v_user) THEN
    RAISE EXCEPTION 'Already a member; invitation cannot be reused';
  END IF;
  INSERT INTO public.workspace_memberships(workspace_id,user_id,role)
    VALUES (v_inv.workspace_id,v_user,v_inv.role);
  UPDATE public.intrigue_secure_team_invitations
    SET status='accepted',accepted_by=v_user,accepted_at=now()
    WHERE id=v_inv.id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation already consumed'; END IF;
  RETURN pg_catalog.jsonb_build_object('joined',true,
    'workspace_id',v_inv.workspace_id,'role',v_inv.role);
END;
$accept$;
REVOKE ALL ON FUNCTION public.accept_intrigue_team_invite_secure(text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_intrigue_team_invite_secure(text)
  TO authenticated;

-- Close every existing legacy invitation-acceptance/issuance endpoint.
DO $lockdown$
DECLARE v_rec record;
BEGIN
  FOR v_rec IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (
      p.proname LIKE 'accept_intrigue_team_invite%' OR
      p.proname LIKE 'create_intrigue_team_invite%' OR
      p.proname LIKE 'revoke_intrigue_team_invite%')
      AND p.proname NOT IN ('accept_intrigue_team_invite_secure')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_rec.signature);
  END LOOP;
  FOR v_rec IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='create_intrigue_company'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',v_rec.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_rec.signature);
  END LOOP;
END;
$lockdown$;

-- Block direct membership/company insertion by normal authenticated users.
REVOKE INSERT ON TABLE public.workspace_memberships FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS intrigue_invite_only_no_membership_insert ON public.workspace_memberships;
CREATE POLICY intrigue_invite_only_no_membership_insert
  ON public.workspace_memberships AS RESTRICTIVE FOR INSERT TO anon,authenticated
  WITH CHECK (false);
REVOKE INSERT ON TABLE public.workspaces FROM PUBLIC,anon,authenticated;
DROP POLICY IF EXISTS intrigue_invite_only_no_workspace_insert ON public.workspaces;
CREATE POLICY intrigue_invite_only_no_workspace_insert
  ON public.workspaces AS RESTRICTIVE FOR INSERT TO anon,authenticated
  WITH CHECK (false);

COMMIT;
NOTIFY pgrst,'reload schema';

-- Read-only verification; all fields should be TRUE.
SELECT
  has_function_privilege('authenticated','public.create_intrigue_secure_team_invite(uuid,text,text)','EXECUTE') AS owner_invite_rpc_accessible,
  has_function_privilege('authenticated','public.accept_intrigue_team_invite_secure(text)','EXECUTE') AS verified_accept_rpc_accessible,
  NOT has_function_privilege('anon','public.accept_intrigue_team_invite_secure(text)','EXECUTE') AS anon_invite_closed,
  NOT has_function_privilege('authenticated','public.create_intrigue_company(text)','EXECUTE') AS free_company_closed,
  EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.workspace_memberships'::regclass
      AND polname='intrigue_invite_only_no_membership_insert' AND NOT polpermissive) AS membership_direct_insert_closed,
  EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.workspaces'::regclass
      AND polname='intrigue_invite_only_no_workspace_insert' AND NOT polpermissive) AS workspace_direct_insert_closed;
