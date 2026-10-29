-- INTRIGUE V14.2: Service catalog + least-privilege team roles.
-- Apply ONLY after V14.1 on the demo/staging Supabase project.
-- All business-record writes stay subject to RLS; AI/approvals remain owner-only.
-- Existing customer, quotation and team records are preserved.
BEGIN;

-- Old V14.1 member role remains supported as read-only for existing accounts.
ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_role_check;
ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_role_check
  CHECK (role IN ('owner','admin','staff','viewer','member'));
ALTER TABLE public.workspace_invitations
  DROP CONSTRAINT IF EXISTS workspace_invitations_role_check;
ALTER TABLE public.workspace_invitations
  ADD CONSTRAINT workspace_invitations_role_check
  CHECK (role IN ('member','admin','staff','viewer'));

-- Role helper runs with narrow, explicit membership lookups and no client writes.
CREATE OR REPLACE FUNCTION private.v142_can_manage_catalog(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin')
  );
$$;
REVOKE ALL ON FUNCTION private.v142_can_manage_catalog(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v142_can_manage_catalog(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.v142_can_write_ops(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id AND m.user_id=auth.uid()
      AND m.role IN ('owner','admin','staff')
  );
$$;
REVOKE ALL ON FUNCTION private.v142_can_write_ops(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v142_can_write_ops(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  price numeric(12,2) NOT NULL CHECK (price >= 0 AND price <= 999999999),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR','USD','GBP','KES')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,name)
);
CREATE INDEX IF NOT EXISTS workspace_services_workspace_idx ON public.workspace_services(workspace_id,is_active);
ALTER TABLE public.workspace_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_services FROM PUBLIC,anon,authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_services TO authenticated;
DROP POLICY IF EXISTS v142_services_read ON public.workspace_services;
CREATE POLICY v142_services_read ON public.workspace_services FOR SELECT TO authenticated
USING ((SELECT private.v14_is_workspace_member(workspace_id)));
DROP POLICY IF EXISTS v142_services_insert ON public.workspace_services;
CREATE POLICY v142_services_insert ON public.workspace_services FOR INSERT TO authenticated
WITH CHECK ((SELECT private.v142_can_manage_catalog(workspace_id)));
DROP POLICY IF EXISTS v142_services_update ON public.workspace_services;
CREATE POLICY v142_services_update ON public.workspace_services FOR UPDATE TO authenticated
USING ((SELECT private.v142_can_manage_catalog(workspace_id)))
WITH CHECK ((SELECT private.v142_can_manage_catalog(workspace_id)));
DROP POLICY IF EXISTS v142_services_delete ON public.workspace_services;
CREATE POLICY v142_services_delete ON public.workspace_services FOR DELETE TO authenticated
USING ((SELECT private.v142_can_manage_catalog(workspace_id)));

-- Staff can create customer enquiries, but never delete customers or edit quotes.
DROP POLICY IF EXISTS v142_ops_customers_insert ON public.customers;
CREATE POLICY v142_ops_customers_insert ON public.customers FOR INSERT TO authenticated
WITH CHECK ((SELECT private.v142_can_write_ops(workspace_id)));
DROP POLICY IF EXISTS v142_ops_enquiries_insert ON public.enquiries;
CREATE POLICY v142_ops_enquiries_insert ON public.enquiries FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.v142_can_write_ops(workspace_id))
  AND EXISTS (SELECT 1 FROM public.customers c
    WHERE c.id=customer_id AND c.workspace_id=enquiries.workspace_id)
);
DROP POLICY IF EXISTS v142_ops_followups_insert ON public.follow_ups;
CREATE POLICY v142_ops_followups_insert ON public.follow_ups FOR INSERT TO authenticated
WITH CHECK (
  (SELECT private.v142_can_write_ops(workspace_id))
  AND EXISTS (SELECT 1 FROM public.customers c
    WHERE c.id=customer_id AND c.workspace_id=follow_ups.workspace_id)
);
DROP POLICY IF EXISTS v142_ops_followups_update ON public.follow_ups;
CREATE POLICY v142_ops_followups_update ON public.follow_ups FOR UPDATE TO authenticated
USING ((SELECT private.v142_can_write_ops(workspace_id)))
WITH CHECK (
  (SELECT private.v142_can_write_ops(workspace_id))
  AND EXISTS (SELECT 1 FROM public.customers c
    WHERE c.id=customer_id AND c.workspace_id=follow_ups.workspace_id)
);

-- Tenant-integrity guard: a child record must reference a customer in the SAME workspace.
-- Covers owner writes as well as staff writes, even if table RLS would otherwise pass.
CREATE OR REPLACE FUNCTION public.v142_enforce_customer_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
      WHERE c.id=NEW.customer_id AND c.workspace_id=NEW.workspace_id
  ) THEN RAISE EXCEPTION 'Customer must belong to the same workspace'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.v142_enforce_customer_workspace() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS v142_enquiry_customer_integrity ON public.enquiries;
CREATE TRIGGER v142_enquiry_customer_integrity BEFORE INSERT OR UPDATE ON public.enquiries
  FOR EACH ROW EXECUTE FUNCTION public.v142_enforce_customer_workspace();
DROP TRIGGER IF EXISTS v142_quote_customer_integrity ON public.quotations;
CREATE TRIGGER v142_quote_customer_integrity BEFORE INSERT OR UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.v142_enforce_customer_workspace();
DROP TRIGGER IF EXISTS v142_followup_customer_integrity ON public.follow_ups;
CREATE TRIGGER v142_followup_customer_integrity BEFORE INSERT OR UPDATE ON public.follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.v142_enforce_customer_workspace();

-- Staged RBAC: only owner grants and changes roles; no non-owner can elevate themselves.
CREATE OR REPLACE FUNCTION private.v142_create_invitation(p_workspace_id uuid,p_email text,p_role text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
  v_token text;
  v_count integer;
BEGIN
  IF p_role NOT IN ('admin','staff','viewer') OR p_role IS NULL THEN
    RAISE EXCEPTION 'Role must be admin, staff or viewer'; END IF;
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_user
  ) THEN RAISE EXCEPTION 'Only the workspace owner can invite staff'; END IF;
  IF pg_catalog.length(v_email) < 5 OR pg_catalog.length(v_email) > 254
    OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN RAISE EXCEPTION 'Enter a valid email'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships m JOIN auth.users u ON u.id=m.user_id
    WHERE m.workspace_id=p_workspace_id AND pg_catalog.lower(u.email)=v_email
  ) THEN RAISE EXCEPTION 'Already a team member'; END IF;
  SELECT count(*) INTO v_count FROM public.workspace_memberships WHERE workspace_id=p_workspace_id;
  IF v_count>=10 THEN RAISE EXCEPTION 'Staging limit: 10 seats'; END IF;
  UPDATE public.workspace_invitations SET status='revoked'
    WHERE workspace_id=p_workspace_id AND invited_email=v_email AND status='pending';
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','') ||
             pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
  INSERT INTO public.workspace_invitations
    (workspace_id,invited_email,role,token_hash,created_by,expires_at)
    VALUES (p_workspace_id,v_email,p_role,pg_catalog.md5(v_token),v_user,now()+interval '7 days');
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION private.v142_create_invitation(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v142_create_invitation(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_intrigue_team_invite_v142(p_workspace_id uuid,p_email text,p_role text)
RETURNS text LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.v142_create_invitation(p_workspace_id,p_email,p_role);
$$;
REVOKE ALL ON FUNCTION public.create_intrigue_team_invite_v142(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_intrigue_team_invite_v142(uuid,text,text) TO authenticated;

-- Replace the V14.1 accept implementation so role is taken ONLY from the verified,
-- locked invitation row; the invited browser cannot choose its own role.
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
  IF v_email IS NULL THEN RAISE EXCEPTION 'Verify your email before joining'; END IF;
  SELECT * INTO v_inv FROM public.workspace_invitations
    WHERE token_hash=pg_catalog.md5(p_token) FOR UPDATE;
  IF NOT FOUND OR v_inv.status<>'pending' OR v_inv.expires_at<=now()
    OR v_inv.invited_email<>v_email OR v_inv.role NOT IN ('admin','staff','viewer','member')
  THEN RAISE EXCEPTION 'Invalid, expired or wrong-email invitation'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=v_user)
    OR EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=v_user)
  THEN RAISE EXCEPTION 'This account already belongs to a workspace'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=v_inv.workspace_id FOR UPDATE;
  IF (SELECT count(*) FROM public.workspace_memberships WHERE workspace_id=v_inv.workspace_id)>=10
  THEN RAISE EXCEPTION 'Team member limit reached'; END IF;
  INSERT INTO public.workspace_memberships(workspace_id,user_id,role)
    VALUES(v_inv.workspace_id,v_user,v_inv.role);
  UPDATE public.workspace_invitations SET status='accepted',accepted_by=v_user,
    accepted_at=now() WHERE id=v_inv.id;
  RETURN v_inv.workspace_id;
END;
$$;
REVOKE ALL ON FUNCTION private.v14_accept_invitation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v14_accept_invitation(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.v142_change_role(p_workspace_id uuid,p_member_id uuid,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid := auth.uid();
BEGIN
  IF p_role NOT IN ('admin','staff','viewer') OR p_role IS NULL
  THEN RAISE EXCEPTION 'Invalid staff role'; END IF;
  IF v_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.owner_id=v_owner
  ) THEN RAISE EXCEPTION 'Only owners may change team roles'; END IF;
  UPDATE public.workspace_memberships SET role=p_role
    WHERE workspace_id=p_workspace_id AND user_id=p_member_id AND role<>'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.v142_change_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.v142_change_role(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.change_intrigue_team_role(p_workspace_id uuid,p_member_id uuid,p_role text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.v142_change_role(p_workspace_id,p_member_id,p_role);
$$;
REVOKE ALL ON FUNCTION public.change_intrigue_team_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_intrigue_team_role(uuid,uuid,text) TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
