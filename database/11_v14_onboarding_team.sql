-- INTRIGUE V14.1: company configuration, private invitation-based team access.
-- Compatible with V13.9. Apply in a STAGING Supabase project first.
-- Staff have READ-ONLY access to core operational tables. AI and actions remain owner-only.
-- Additive; no existing workspace/customer data is removed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.v14_is_workspace_member(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = (SELECT auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION private.v14_is_workspace_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.v14_is_workspace_member(uuid) TO authenticated;

-- Allow employees to read ONE workspace and its operational records, never write them.
DROP POLICY IF EXISTS v14_workspace_member_read ON public.workspaces;
CREATE POLICY v14_workspace_member_read ON public.workspaces FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(id)));

DROP POLICY IF EXISTS v14_members_read_customers ON public.customers;
CREATE POLICY v14_members_read_customers ON public.customers FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_enquiries ON public.enquiries;
CREATE POLICY v14_members_read_enquiries ON public.enquiries FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_quotations ON public.quotations;
CREATE POLICY v14_members_read_quotations ON public.quotations FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_followups ON public.follow_ups;
CREATE POLICY v14_members_read_followups ON public.follow_ups FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_knowledge_notes ON public.knowledge_entries;
CREATE POLICY v14_members_read_knowledge_notes ON public.knowledge_entries FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_documents ON public.knowledge_documents;
CREATE POLICY v14_members_read_documents ON public.knowledge_documents FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_members_read_document_chunks ON public.knowledge_document_chunks;
CREATE POLICY v14_members_read_document_chunks ON public.knowledge_document_chunks FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));

CREATE TABLE IF NOT EXISTS public.workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  industry text NOT NULL DEFAULT 'Other' CHECK (char_length(industry) BETWEEN 2 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  contact_email text NOT NULL DEFAULT '' CHECK (char_length(contact_email) <= 254),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 60),
  website text NOT NULL DEFAULT '' CHECK (char_length(website) <= 255),
  business_hours text NOT NULL DEFAULT '' CHECK (char_length(business_hours) <= 350),
  timezone text NOT NULL DEFAULT 'Europe/Berlin' CHECK (char_length(timezone) <= 80),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD','GBP','KES')),
  ai_name text NOT NULL DEFAULT 'INTRIGUE Assistant' CHECK (char_length(ai_name) BETWEEN 2 AND 80),
  ai_tone text NOT NULL DEFAULT 'Professional' CHECK (ai_tone IN ('Professional','Friendly','Concise','Formal')),
  ai_role text NOT NULL DEFAULT 'Operations assistant' CHECK (char_length(ai_role) BETWEEN 4 AND 160),
  ai_guidance text NOT NULL DEFAULT '' CHECK (char_length(ai_guidance) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workspace_settings TO authenticated;
DROP POLICY IF EXISTS v14_settings_read ON public.workspace_settings;
CREATE POLICY v14_settings_read ON public.workspace_settings FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v14_settings_insert ON public.workspace_settings;
CREATE POLICY v14_settings_insert ON public.workspace_settings FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS v14_settings_update ON public.workspace_settings;
CREATE POLICY v14_settings_update ON public.workspace_settings FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role = 'member'),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  accepted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS v14_invitations_workspace_idx
ON public.workspace_invitations (workspace_id,created_at DESC);
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_invitations TO authenticated;
DROP POLICY IF EXISTS v14_invites_owner_read ON public.workspace_invitations;
CREATE POLICY v14_invites_owner_read ON public.workspace_invitations FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));

-- Use a private SECURITY DEFINER function for invitation creation, never browser writes.
-- 2 independent random UUIDs give ample invite entropy; store only an MD5 digest of
-- that unpredictable token (plus exact verified email match is mandatory to accept).
CREATE OR REPLACE FUNCTION private.v14_create_invitation(p_workspace_id uuid,p_email text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
  v_token text;
  v_count integer;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_user
  ) THEN RAISE EXCEPTION 'Only the company owner can invite staff'; END IF;
  IF pg_catalog.length(v_email) < 5 OR pg_catalog.length(v_email)>254
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships m JOIN auth.users u ON u.id=m.user_id
    WHERE m.workspace_id=p_workspace_id AND pg_catalog.lower(u.email)=v_email
  ) THEN RAISE EXCEPTION 'That account is already a team member'; END IF;
  SELECT count(*) INTO v_count FROM public.workspace_memberships WHERE workspace_id=p_workspace_id;
  IF v_count>=10 THEN RAISE EXCEPTION 'Staging limit: up to 10 team members'; END IF;
  UPDATE public.workspace_invitations SET status='revoked'
    WHERE workspace_id=p_workspace_id AND invited_email=v_email AND status='pending';
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','') ||
             pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO public.workspace_invitations
    (workspace_id,invited_email,role,token_hash,created_by,expires_at)
    VALUES (p_workspace_id,v_email,'member',pg_catalog.md5(v_token),v_user,now()+INTERVAL '7 days');
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_create_invitation(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.v14_create_invitation(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_intrigue_team_invite(p_workspace_id uuid,p_email text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.v14_create_invitation(p_workspace_id,p_email);
$$;
REVOKE ALL ON FUNCTION public.create_intrigue_team_invite(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_intrigue_team_invite(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.v14_accept_invitation(p_token text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.workspace_invitations%ROWTYPE;
BEGIN
  IF v_user IS NULL OR p_token IS NULL OR length(p_token)<>64 OR p_token !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
  SELECT pg_catalog.lower(email) INTO v_email FROM auth.users
    WHERE id=v_user AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Confirm your email before accepting the invitation'; END IF;
  SELECT * INTO v_inv FROM public.workspace_invitations
    WHERE token_hash=pg_catalog.md5(p_token) FOR UPDATE;
  IF NOT FOUND OR v_inv.status<>'pending' OR v_inv.expires_at<=now()
    OR v_inv.invited_email<>v_email
  THEN RAISE EXCEPTION 'Invitation is invalid, expired, or belongs to another email'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=v_user)
    OR EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=v_user)
  THEN RAISE EXCEPTION 'This account already belongs to a workspace. Use a separate staff account'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=v_inv.workspace_id FOR UPDATE;
  IF (SELECT count(*) FROM public.workspace_memberships WHERE workspace_id=v_inv.workspace_id)>=10
  THEN RAISE EXCEPTION 'Team member limit reached'; END IF;
  INSERT INTO public.workspace_memberships(workspace_id,user_id,role)
    VALUES(v_inv.workspace_id,v_user,'member');
  UPDATE public.workspace_invitations SET status='accepted',accepted_by=v_user,
    accepted_at=now() WHERE id=v_inv.id;
  RETURN v_inv.workspace_id;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_accept_invitation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.v14_accept_invitation(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_intrigue_team_invite(p_token text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.v14_accept_invitation(p_token);
$$;
REVOKE ALL ON FUNCTION public.accept_intrigue_team_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_intrigue_team_invite(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.v14_revoke_invitation(p_invitation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  UPDATE public.workspace_invitations i SET status='revoked'
  WHERE i.id=p_invitation_id AND i.status='pending'
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=i.workspace_id AND w.owner_id=v_user);
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending invitation not found or access denied'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_revoke_invitation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.v14_revoke_invitation(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.revoke_intrigue_team_invite(p_invitation_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.v14_revoke_invitation(p_invitation_id);
$$;
REVOKE ALL ON FUNCTION public.revoke_intrigue_team_invite(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_intrigue_team_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.v14_remove_member(p_workspace_id uuid,p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Only owners can remove staff'; END IF;
  DELETE FROM public.workspace_memberships
    WHERE workspace_id=p_workspace_id AND user_id=p_member_id AND role<>'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_remove_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v14_remove_member(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.remove_intrigue_team_member(p_workspace_id uuid,p_member_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT private.v14_remove_member(p_workspace_id,p_member_id);
$$;
REVOKE ALL ON FUNCTION public.remove_intrigue_team_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.remove_intrigue_team_member(uuid,uuid) TO authenticated;

-- Team directory: never expose auth.users directly to browsers.
CREATE OR REPLACE FUNCTION private.v14_team_directory(p_workspace_id uuid)
RETURNS TABLE(member_user_id uuid,email text,role text,joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Only owners can view the team directory'; END IF;
  RETURN QUERY SELECT m.user_id,u.email::text,m.role,m.created_at
    FROM public.workspace_memberships m JOIN auth.users u ON u.id=m.user_id
    WHERE m.workspace_id=p_workspace_id ORDER BY m.created_at;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_team_directory(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v14_team_directory(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.list_intrigue_team(p_workspace_id uuid)
RETURNS TABLE(member_user_id uuid,email text,role text,joined_at timestamptz)
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT * FROM private.v14_team_directory(p_workspace_id);
$$;
REVOKE ALL ON FUNCTION public.list_intrigue_team(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_intrigue_team(uuid) TO authenticated;

-- Prevent a staff member from creating another owner workspace with the V13 RPC.
CREATE OR REPLACE FUNCTION public.create_intrigue_company(p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_user uuid := auth.uid(); v_name text := pg_catalog.btrim(coalesce(p_name,'')); v_workspace uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in first'; END IF;
  IF pg_catalog.char_length(v_name)<2 OR pg_catalog.char_length(v_name)>100
    THEN RAISE EXCEPTION 'Company name must be 2 to 100 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=v_user)
    OR EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=v_user)
    THEN RAISE EXCEPTION 'This account already belongs to a workspace'; END IF;
  INSERT INTO public.workspaces(owner_id,name) VALUES(v_user,v_name) RETURNING id INTO v_workspace;
  RETURN v_workspace;
END;
$$;
REVOKE ALL ON FUNCTION public.create_intrigue_company(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_intrigue_company(text) TO authenticated;

-- V14 protection: older demo initialization must not grant staff a second workspace.
-- The V14 onboarding flow uses create_intrigue_company instead.
REVOKE EXECUTE ON FUNCTION public.initialize_demo_workspace() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.v14_before_workspace_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.owner_id IS NULL OR NEW.owner_id<>auth.uid()
    OR EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=NEW.owner_id)
  THEN RAISE EXCEPTION 'Account is already a workspace member or invalid owner'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v14_before_workspace_insert() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS v14_one_workspace_per_account ON public.workspaces;
CREATE TRIGGER v14_one_workspace_per_account BEFORE INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.v14_before_workspace_insert();

COMMIT;
NOTIFY pgrst,'reload schema';
