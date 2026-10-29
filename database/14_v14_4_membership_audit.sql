-- INTRIGUE V14.4 | Membership audit trail
-- Requires V14.3 Complete; additive and safe to re-run.
-- Run this one migration in Supabase SQL Editor. No customer data is changed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.intrigue_membership_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workspace_name text NOT NULL,
  actor_id uuid,
  member_user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('joined','role_changed','removed')),
  old_role text,
  new_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intrigue_membership_events_workspace_idx
 ON private.intrigue_membership_events (workspace_id,created_at DESC);
ALTER TABLE private.intrigue_membership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.intrigue_membership_events FROM PUBLIC,anon,authenticated;

-- A trigger, not a browser-writable log. The owner can inspect its own audit history.
CREATE OR REPLACE FUNCTION private.v144_record_membership_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 v_ws uuid;
 v_name text;
 v_kind text;
 v_old text;
 v_new text;
 v_subject uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ws := NEW.workspace_id;
    v_subject := NEW.user_id;
    v_kind := 'joined';
    v_new := NEW.role;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
    v_ws := NEW.workspace_id;
    v_subject := NEW.user_id;
    v_kind := 'role_changed';
    v_old := OLD.role;
    v_new := NEW.role;
  ELSE
    v_ws := OLD.workspace_id;
    v_subject := OLD.user_id;
    v_kind := 'removed';
    v_old := OLD.role;
  END IF;
  -- Avoid blocking workspace deletion on cascading membership deletes.
  SELECT w.name INTO v_name FROM public.workspaces w WHERE w.id = v_ws;
  IF v_name IS NOT NULL THEN
    INSERT INTO private.intrigue_membership_events
      (workspace_id,workspace_name,actor_id,member_user_id,event_type,old_role,new_role)
    VALUES (v_ws,v_name,auth.uid(),v_subject,v_kind,v_old,v_new);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION private.v144_record_membership_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS v144_membership_audit ON public.workspace_memberships;
CREATE TRIGGER v144_membership_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION private.v144_record_membership_event();

-- Restrict privileged reads to the actual company owner. Never trust a client-supplied workspace ID.
CREATE OR REPLACE FUNCTION private.v144_owner_membership_history(p_workspace_id uuid,p_limit integer)
RETURNS TABLE (
  event_at timestamptz,
  event_type text,
  member_email text,
  actor_email text,
  old_role text,
  new_role text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF auth.uid() IS NULL OR p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id=p_workspace_id AND w.owner_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Company owner required'; END IF;
  RETURN QUERY
  SELECT e.created_at,e.event_type,
    COALESCE(u.email::text, 'Account ' || e.member_user_id::text),
    COALESCE(a.email::text, CASE WHEN e.actor_id IS NULL THEN 'System / database administrator' ELSE 'Account '||e.actor_id::text END),
    e.old_role,e.new_role
  FROM private.intrigue_membership_events e
  LEFT JOIN auth.users u ON u.id=e.member_user_id
  LEFT JOIN auth.users a ON a.id=e.actor_id
  WHERE e.workspace_id=p_workspace_id
  ORDER BY e.created_at DESC,e.event_id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit,30),1),100);
END;
$fn$;
REVOKE ALL ON FUNCTION private.v144_owner_membership_history(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.v144_owner_membership_history(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_intrigue_membership_history(
  p_workspace_id uuid,p_limit integer DEFAULT 30
) RETURNS TABLE (
  event_at timestamptz,
  event_type text,
  member_email text,
  actor_email text,
  old_role text,
  new_role text
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
  SELECT * FROM private.v144_owner_membership_history(p_workspace_id,p_limit);
$fn$;
REVOKE ALL ON FUNCTION public.get_intrigue_membership_history(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_intrigue_membership_history(uuid,integer) TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
