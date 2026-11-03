-- V17.1B: Atomic cancellation and retry controls for the V17.1A queue.
-- ADDITIVE - requires V17.1A installed. Run in staging first.
-- Both functions are service-role ONLY. Browser requests must go through the
-- authenticated, workspace-scoped /api/automation/v17 endpoint.
BEGIN;

CREATE OR REPLACE FUNCTION public.intrigue_v17_cancel(
  p_workspace_id uuid,
  p_run_id uuid,
  p_actor_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Missing identifiers';
  END IF;
  UPDATE public.intrigue_v17_runs
     SET status='cancelled',
         finished_at=now(),
         lease_token=NULL,
         leased_until=NULL,
         updated_at=now()
   WHERE id=p_run_id
     AND workspace_id=p_workspace_id
     AND status IN ('awaiting_approval','queued','retry_wait')
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.intrigue_v17_run_events(workspace_id,run_id,event_type,details)
  VALUES(p_workspace_id,p_run_id,'cancelled',pg_catalog.jsonb_build_object('actor_id',p_actor_id));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.intrigue_v17_retry(
  p_workspace_id uuid,
  p_run_id uuid,
  p_actor_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_workspace_id IS NULL OR p_run_id IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Missing identifiers';
  END IF;
  UPDATE public.intrigue_v17_runs
     SET status='queued',
         attempts=0,
         lease_token=NULL,
         leased_until=NULL,
         available_at=now(),
         last_error=NULL,
         result=NULL,
         finished_at=NULL,
         updated_at=now()
   WHERE id=p_run_id
     AND workspace_id=p_workspace_id
     AND status='dead_letter'
     AND approved_at IS NOT NULL
   RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  INSERT INTO public.intrigue_v17_run_events(workspace_id,run_id,event_type,details)
  VALUES(p_workspace_id,p_run_id,'manually_retried',pg_catalog.jsonb_build_object('actor_id',p_actor_id));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_v17_cancel(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_v17_retry(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v17_cancel(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_v17_retry(uuid,uuid,uuid) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
