-- INTRIGUE Sprint 1 RC2: Safe account lifecycle / data-subject requests
-- Additive; no pre-existing company, Auth user, FK, or Storage object is deleted.
-- DO NOT change ON DELETE rules to CASCADE. Back up the database before applying.
BEGIN;

CREATE TABLE IF NOT EXISTS public.intrigue_rc2_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  workspace_label text,
  kind text NOT NULL CHECK (kind IN ('account','workspace','workspace_and_account')),
  status text NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review','processing','workspace_deleted','completed','rejected','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  response_due_at timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  completed_at timestamptz,
  operator_note text
);
CREATE INDEX IF NOT EXISTS intrigue_rc2_requests_requester_idx
  ON public.intrigue_rc2_requests(requested_by, requested_at DESC);
ALTER TABLE public.intrigue_rc2_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_rc2_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.intrigue_rc2_requests TO authenticated;
DROP POLICY IF EXISTS intrigue_rc2_requester_read ON public.intrigue_rc2_requests;
CREATE POLICY intrigue_rc2_requester_read ON public.intrigue_rc2_requests
  FOR SELECT TO authenticated USING (requested_by = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.intrigue_rc2_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  from_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS intrigue_rc2_transfers_to_idx ON public.intrigue_rc2_transfers(to_user,status);
ALTER TABLE public.intrigue_rc2_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_rc2_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.intrigue_rc2_transfers TO authenticated;
DROP POLICY IF EXISTS intrigue_rc2_transfers_participants ON public.intrigue_rc2_transfers;
CREATE POLICY intrigue_rc2_transfers_participants ON public.intrigue_rc2_transfers
 FOR SELECT TO authenticated USING (from_user = (SELECT auth.uid()) OR to_user = (SELECT auth.uid()));

-- Preview all FK dependencies of this caller's account and (if any) owned company.
-- Catalog-driven inspection prevents surprises as new modules are added.
CREATE OR REPLACE FUNCTION public.intrigue_rc2_preview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := (SELECT auth.uid());
  v_email text;
  v_w public.workspaces%ROWTYPE;
  v_fk record;
  v_count bigint;
  v_storage_count bigint;
  v_member_count bigint := 0;
  v_auth_blockers jsonb := '[]'::jsonb;
  v_workspace_refs jsonb := '[]'::jsonb;
  v_workspace_data bigint := 0;
  v_other_members bigint := 0;
  v_owned_count bigint;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = '28000'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=v_user;
  IF v_email IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE='28000'; END IF;
  SELECT count(*) INTO v_owned_count FROM public.workspaces WHERE owner_id=v_user;
  SELECT * INTO v_w FROM public.workspaces WHERE owner_id=v_user ORDER BY created_at LIMIT 1;

  FOR v_fk IN
    SELECT c.conrelid::regclass AS dependent_relation, c.confrelid::regclass AS parent_relation,
           a.attname AS column_name, c.confdeltype AS delete_rule
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND pg_catalog.cardinality(c.conkey)=1
      AND c.confrelid IN ('auth.users'::regclass,'public.workspaces'::regclass)
  LOOP
    IF v_fk.parent_relation = 'public.workspaces'::regclass AND v_w.id IS NULL THEN CONTINUE; END IF;
    EXECUTE pg_catalog.format('SELECT count(*) FROM %s WHERE %I = $1',
      v_fk.dependent_relation, v_fk.column_name)
      INTO v_count USING (CASE WHEN v_fk.parent_relation='auth.users'::regclass THEN v_user ELSE v_w.id END);
    IF v_count > 0 THEN
      IF v_fk.parent_relation = 'auth.users'::regclass AND v_fk.delete_rule IN ('a','r') THEN
        v_auth_blockers := v_auth_blockers || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('resource',v_fk.dependent_relation::text,'count',v_count));
      ELSIF v_fk.parent_relation = 'public.workspaces'::regclass THEN
        v_workspace_refs := v_workspace_refs || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('resource',v_fk.dependent_relation::text,'count',v_count,
            'rule', CASE v_fk.delete_rule WHEN 'c' THEN 'cascade' WHEN 'r' THEN 'restrict' WHEN 'a' THEN 'restrict' ELSE 'other' END));
        IF v_fk.dependent_relation::text NOT IN ('workspace_memberships','public.workspace_memberships',
          'workspace_settings','public.workspace_settings') THEN
          v_workspace_data := v_workspace_data + v_count;
        END IF;
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_storage_count FROM storage.objects WHERE owner_id = v_user::text;
  IF v_w.id IS NOT NULL THEN
    SELECT count(*) INTO v_member_count FROM public.workspace_memberships WHERE workspace_id=v_w.id;
    SELECT count(*) INTO v_other_members FROM public.workspace_memberships
      WHERE workspace_id=v_w.id AND user_id<>v_user;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'email', v_email, 'owned_workspaces', v_owned_count,
    'workspace', CASE WHEN v_w.id IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object('id',v_w.id,'name',v_w.name,'members',v_member_count) END,
    'account_blockers', v_auth_blockers, 'storage_owned', v_storage_count,
    'workspace_references', v_workspace_refs,
    'empty_workspace_eligible', (v_w.id IS NOT NULL AND v_owned_count=1
       AND v_other_members=0 AND v_workspace_data=0 AND v_storage_count=0),
    'account_deletion_eligible', (v_owned_count=0 AND pg_catalog.jsonb_array_length(v_auth_blockers)=0
       AND v_storage_count=0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_preview() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_preview() TO authenticated;

CREATE OR REPLACE FUNCTION public.intrigue_rc2_request(p_kind text,p_workspace_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := (SELECT auth.uid()); v_name text; v_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_kind NOT IN ('account','workspace','workspace_and_account') THEN
    RAISE EXCEPTION 'Invalid request type'; END IF;
  IF p_kind IN ('workspace','workspace_and_account') THEN
    SELECT name INTO v_name FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_user;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Only the verified owner may request company deletion'; END IF;
  ELSIF p_workspace_id IS NOT NULL THEN RAISE EXCEPTION 'Unexpected workspace'; END IF;
  SELECT id INTO v_id FROM public.intrigue_rc2_requests
    WHERE requested_by=v_user AND kind=p_kind
      AND workspace_id IS NOT DISTINCT FROM p_workspace_id
      AND status IN ('needs_review','processing','workspace_deleted')
    ORDER BY requested_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.intrigue_rc2_requests(requested_by,workspace_id,workspace_label,kind)
    VALUES(v_user,p_workspace_id,v_name,p_kind) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_request(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_request(text,uuid) TO authenticated;

-- A freshly created, live session is required for destructive actions and transfers.
-- Called only using the server-side service key, never with arbitrary browser params.
CREATE OR REPLACE FUNCTION public.intrigue_rc2_recent_session(p_actor uuid,p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM auth.sessions s
   WHERE s.id = p_session_id AND s.user_id = p_actor
     AND s.created_at >= now() - interval '10 minutes'
 );
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_recent_session(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_recent_session(uuid,uuid) TO service_role;

-- Ownership transfer is two-party: proposed by current owner and accepted by the recipient.
CREATE OR REPLACE FUNCTION public.intrigue_rc2_offer_transfer(p_actor uuid,p_workspace_id uuid,p_to_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := p_actor; v_id uuid;
BEGIN
  IF v_owner IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner)
    OR p_to_user IS NULL OR p_to_user=v_owner THEN RAISE EXCEPTION 'Invalid transfer'; END IF;
  PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only the current workspace owner can offer a transfer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_memberships
        WHERE workspace_id=p_workspace_id AND user_id=p_to_user AND role IN ('admin','staff','viewer')) THEN
    RAISE EXCEPTION 'New owner must already be an active team member'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=p_to_user) OR EXISTS
    (SELECT 1 FROM public.workspace_memberships WHERE user_id=p_to_user AND workspace_id<>p_workspace_id) THEN
    RAISE EXCEPTION 'Recipient belongs to another company'; END IF;
  UPDATE public.intrigue_rc2_transfers SET status='cancelled'
    WHERE workspace_id=p_workspace_id AND status='pending';
  INSERT INTO public.intrigue_rc2_transfers(workspace_id,from_user,to_user)
    VALUES(p_workspace_id,v_owner,p_to_user) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_offer_transfer(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_offer_transfer(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_rc2_accept_transfer(p_actor uuid,p_transfer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_me uuid := p_actor; v_t public.intrigue_rc2_transfers%ROWTYPE; v_current uuid;
BEGIN
  IF v_me IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_me) THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT * INTO v_t FROM public.intrigue_rc2_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_t.status<>'pending' OR v_t.to_user<>v_me OR v_t.expires_at<=now() THEN
    RAISE EXCEPTION 'Transfer is no longer available'; END IF;
  SELECT owner_id INTO v_current FROM public.workspaces WHERE id=v_t.workspace_id FOR UPDATE;
  IF v_current IS DISTINCT FROM v_t.from_user THEN RAISE EXCEPTION 'Workspace owner changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_memberships WHERE workspace_id=v_t.workspace_id
     AND user_id=v_me AND role IN ('admin','staff','viewer')) THEN
    RAISE EXCEPTION 'Recipient membership missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=v_me) OR EXISTS
    (SELECT 1 FROM public.workspace_memberships WHERE user_id=v_me AND workspace_id<>v_t.workspace_id) THEN
    RAISE EXCEPTION 'Recipient already has another workspace'; END IF;

  -- Move authorship of work items within this company before the old owner is removed.
  UPDATE public.action_proposals SET owner_id=v_me WHERE workspace_id=v_t.workspace_id AND owner_id=v_t.from_user;
  UPDATE public.automation_jobs SET owner_id=v_me WHERE workspace_id=v_t.workspace_id AND owner_id=v_t.from_user;
  UPDATE public.automation_job_events SET owner_id=v_me WHERE workspace_id=v_t.workspace_id AND owner_id=v_t.from_user;
  UPDATE public.workspaces SET owner_id=v_me WHERE id=v_t.workspace_id AND owner_id=v_t.from_user;
  UPDATE public.workspace_memberships SET role='owner' WHERE workspace_id=v_t.workspace_id AND user_id=v_me;
  DELETE FROM public.workspace_memberships WHERE workspace_id=v_t.workspace_id AND user_id=v_t.from_user;
  UPDATE public.intrigue_rc2_transfers SET status='accepted',accepted_at=now() WHERE id=p_transfer_id;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_accept_transfer(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_accept_transfer(uuid,uuid) TO service_role;

-- Fully self-service deletion is allowed ONLY for strictly empty workspaces.
-- Companies containing contacts, jobs, quotations, integration connections, backups,
-- approval history, etc. must use the reviewed erasure request process.
CREATE OR REPLACE FUNCTION public.intrigue_rc2_delete_empty_workspace(p_actor uuid,p_workspace_id uuid,p_phrase text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := p_actor; v_name text; v_c record; v_rows bigint; v_id uuid;
BEGIN
 IF v_user IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_user) THEN RAISE EXCEPTION 'Account not found'; END IF;
 SELECT name INTO v_name FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_user FOR UPDATE;
 IF v_name IS NULL OR p_phrase IS DISTINCT FROM 'DELETE '||v_name THEN
   RAISE EXCEPTION 'Workspace confirmation mismatch'; END IF;
 IF (SELECT count(*) FROM public.workspaces WHERE owner_id=v_user)<>1 THEN
   RAISE EXCEPTION 'Multiple owned workspaces'; END IF;
 IF EXISTS (SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id=p_workspace_id AND user_id<>v_user) THEN
   RAISE EXCEPTION 'Workspace has other team members'; END IF;
 IF EXISTS (SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id<>p_workspace_id AND user_id=v_user) THEN
   RAISE EXCEPTION 'You belong to another company'; END IF;
 IF EXISTS (SELECT 1 FROM storage.objects WHERE owner_id=v_user::text) THEN
   RAISE EXCEPTION 'Storage files require reviewed deletion'; END IF;
 FOR v_c IN
    SELECT c.conrelid::regclass AS rel,a.attname AS col
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.workspaces'::regclass
      AND pg_catalog.cardinality(c.conkey)=1
 LOOP
    -- Only the owner's membership and non-personal default settings may be deleted automatically.
    IF v_c.rel::text IN ('workspace_memberships','public.workspace_memberships',
      'workspace_settings','public.workspace_settings') THEN CONTINUE; END IF;
    EXECUTE pg_catalog.format('SELECT count(*) FROM %s WHERE %I=$1',v_c.rel,v_c.col)
      INTO v_rows USING p_workspace_id;
    IF v_rows>0 THEN RAISE EXCEPTION 'Workspace has protected or business records (%). Request reviewed deletion.',v_c.rel; END IF;
 END LOOP;
 INSERT INTO public.intrigue_rc2_requests(requested_by,workspace_id,workspace_label,kind,status)
  VALUES(v_user,p_workspace_id,v_name,'workspace','processing') RETURNING id INTO v_id;
 DELETE FROM public.workspaces WHERE id=p_workspace_id AND owner_id=v_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deletion did not remove the workspace'; END IF;
 UPDATE public.intrigue_rc2_requests SET status='workspace_deleted',completed_at=now() WHERE id=v_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_rc2_delete_empty_workspace(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_rc2_delete_empty_workspace(uuid,uuid,text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
