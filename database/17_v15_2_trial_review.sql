-- INTRIGUE V15.2 | Manual pilot review + private audit
-- Apply AFTER V15.1. No billing, trial entitlement, usage limit changes, or live notifications.
-- Company owners can view only their own applicant-facing review message.
BEGIN;

ALTER TABLE public.workspace_pilot_requests
  ADD COLUMN IF NOT EXISTS review_message text NOT NULL DEFAULT '';
ALTER TABLE public.workspace_pilot_requests
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- For installations that already have the columns, this is still safe to reapply.
ALTER TABLE public.workspace_pilot_requests
  DROP CONSTRAINT IF EXISTS v152_pilot_review_message_length;
ALTER TABLE public.workspace_pilot_requests
  ADD CONSTRAINT v152_pilot_review_message_length
  CHECK (char_length(review_message) <= 500);

-- Column-level grants remain limited to the applicant-editable fields introduced in V15.1.
-- In particular, the normal authenticated role cannot modify or insert review status.
REVOKE INSERT (review_message, reviewed_at) ON public.workspace_pilot_requests FROM authenticated;
REVOKE UPDATE (status, review_message, reviewed_at) ON public.workspace_pilot_requests FROM authenticated;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.intrigue_pilot_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'review_changed')),
  old_status text,
  new_status text NOT NULL,
  applicant_message text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS intrigue_pilot_review_events_ws_idx
  ON private.intrigue_pilot_review_events(workspace_id, event_at DESC);
ALTER TABLE private.intrigue_pilot_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_pilot_review_events FROM PUBLIC, anon, authenticated;

-- Trigger records BOTH operator status changes and normal application submissions.
-- It is a trigger-only definer function: no browser role may execute it directly.
CREATE OR REPLACE FUNCTION private.v152_audit_pilot_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO private.intrigue_pilot_review_events
      (workspace_id, actor_user_id, event_type, old_status, new_status, applicant_message)
    VALUES (NEW.workspace_id, auth.uid(), 'submitted', NULL, NEW.status, NEW.review_message);
  ELSIF OLD.status IS DISTINCT FROM NEW.status OR
        OLD.review_message IS DISTINCT FROM NEW.review_message THEN
    INSERT INTO private.intrigue_pilot_review_events
      (workspace_id, actor_user_id, event_type, old_status, new_status, applicant_message)
    VALUES (NEW.workspace_id, auth.uid(), 'review_changed', OLD.status, NEW.status, NEW.review_message);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.v152_audit_pilot_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS v152_pilot_review_audit ON public.workspace_pilot_requests;
CREATE TRIGGER v152_pilot_review_audit
AFTER INSERT OR UPDATE OF status, review_message ON public.workspace_pilot_requests
FOR EACH ROW EXECUTE FUNCTION private.v152_audit_pilot_review();

-- OPERATOR ONLY. SQL Editor's postgres role may invoke; browser roles cannot.
-- Does NOT start trials or grant entitlements. Uses invoker's own SQL privileges.
CREATE OR REPLACE FUNCTION private.v152_review_pilot(
  p_workspace_id uuid, p_new_status text, p_applicant_message text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_existing public.workspace_pilot_requests%ROWTYPE;
  v_note text := pg_catalog.btrim(coalesce(p_applicant_message, ''));
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Only the database operator may review applications';
  END IF;
  IF p_workspace_id IS NULL THEN RAISE EXCEPTION 'Workspace ID required'; END IF;
  IF p_new_status IS NULL OR p_new_status NOT IN ('contacted', 'closed') THEN
    RAISE EXCEPTION 'Review status must be contacted or closed';
  END IF;
  IF pg_catalog.char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'Applicant message must be at most 500 characters';
  END IF;

  SELECT * INTO v_existing FROM public.workspace_pilot_requests
    WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pilot application not found'; END IF;

  IF v_existing.status = 'closed' AND p_new_status <> 'closed' THEN
    RAISE EXCEPTION 'A closed application cannot be reopened with this workflow';
  END IF;
  IF v_existing.status = p_new_status AND v_existing.review_message = v_note THEN
    RETURN pg_catalog.jsonb_build_object('status', v_existing.status, 'changed', false);
  END IF;

  UPDATE public.workspace_pilot_requests
    SET status = p_new_status,
        review_message = v_note,
        reviewed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE workspace_id = p_workspace_id;

  RETURN pg_catalog.jsonb_build_object('status', p_new_status, 'changed', true);
END;
$$;
REVOKE ALL ON FUNCTION private.v152_review_pilot(uuid,text,text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE private.intrigue_pilot_review_events IS
  'Operator-only immutable-by-browser application review history; V15.2.';
COMMIT;
NOTIFY pgrst, 'reload schema';
