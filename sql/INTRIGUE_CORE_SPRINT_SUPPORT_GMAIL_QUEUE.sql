-- INTRIGUE Operations AI: consolidated core stabilization
-- Additive only. Existing customer/follow-up records, quotations and provider tokens untouched.
-- Scope: support enquiry -> internal follow-up; safe team assignment; fair shared queue.
-- IMPORTANT: run in the existing Supabase Ai_automation SQL Editor after local source is installed/tested.
BEGIN;

-- Keep the existing manual follow-ups. Newly routed support tasks carry a verified source.
ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS source_enquiry_id uuid,
  ADD COLUMN IF NOT EXISTS source_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_intent text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- One *automatically generated* task per workspace and originating enquiry.
-- Manual tasks have NULL source_enquiry_id and remain unrestricted by this index.
CREATE UNIQUE INDEX IF NOT EXISTS intrigue_core_followup_source_once
  ON public.follow_ups (workspace_id, source_enquiry_id)
  WHERE source_enquiry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS intrigue_core_followups_assignee
  ON public.follow_ups (workspace_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS intrigue_core_run_events_fairness
  ON public.intrigue_v17_run_events (workspace_id, created_at DESC)
  WHERE event_type = 'claimed';

-- Protect source metadata and prevent assignment to people outside this company.
-- Existing RLS policies still control normal read/insert/update access.
CREATE OR REPLACE FUNCTION public.intrigue_core_followup_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_assignment_changed boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.source_enquiry_id IS DISTINCT FROM OLD.source_enquiry_id
       OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
       OR NEW.source_intent IS DISTINCT FROM OLD.source_intent
    THEN
      RAISE EXCEPTION 'Follow-up workspace/source cannot be modified';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND
     (NEW.source_enquiry_id IS NOT NULL OR NEW.source_run_id IS NOT NULL OR NEW.source_intent IS NOT NULL)
     AND COALESCE((SELECT auth.role()), '') <> 'service_role'
  THEN
    RAISE EXCEPTION 'Only the approved automation worker can link an enquiry';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_assignment_changed := NEW.assigned_to IS NOT NULL;
  ELSE
    v_assignment_changed := NEW.assigned_to IS DISTINCT FROM OLD.assigned_to;
  END IF;
  IF v_assignment_changed THEN
    -- Do not allow Staff/Viewer to assign or unassign tasks.
    IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
      SELECT wm.role INTO v_role
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = NEW.workspace_id AND wm.user_id = (SELECT auth.uid());
      IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only the owner or admin can assign tasks';
      END IF;
    END IF;
    IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.workspace_id = NEW.workspace_id AND wm.user_id = NEW.assigned_to
        AND wm.role IN ('owner','admin','staff')
    ) THEN
      RAISE EXCEPTION 'Assignee must be an active owner/admin/staff member of this workspace';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_core_followup_integrity()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS intrigue_core_followup_integrity_trigger ON public.follow_ups;
CREATE TRIGGER intrigue_core_followup_integrity_trigger
BEFORE INSERT OR UPDATE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION public.intrigue_core_followup_integrity();

-- Called only after a HUMAN-APPROVED internal V17 analysis finishes successfully.
-- Intent must be explicitly exchange or order_status, not a sale.
-- Enquiry must belong to the SAME workspace, and must have a real customer record.
CREATE OR REPLACE FUNCTION public.intrigue_core_create_support_followup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_customer uuid;
  v_enquiry uuid;
  v_task_id uuid;
  v_intent text;
  v_title text;
BEGIN
  IF NEW.status <> 'succeeded' OR OLD.status = 'succeeded'
     OR NEW.approved_at IS NULL
     OR NEW.result IS NULL
     OR NEW.result->>'classification_source' IS DISTINCT FROM 'v17.2b'
     OR NEW.result->>'outcome' IS DISTINCT FROM 'routed'
  THEN RETURN NULL; END IF;

  v_intent := NEW.result->>'intent';
  IF v_intent IS NULL OR v_intent NOT IN ('exchange','order_status','refund_return','stock_check','support') THEN RETURN NULL; END IF;

  -- This is the approved quotation-analysis workflow, NOT an arbitrary run.
  IF NOT EXISTS (
    SELECT 1 FROM public.intrigue_v17_workflows wf
    WHERE wf.id = NEW.workflow_id AND wf.workspace_id = NEW.workspace_id
      AND wf.action_type = 'quotation_draft'
      AND wf.trigger_type = 'manual'
      AND wf.requires_approval = true
  ) THEN RETURN NULL; END IF;

  IF NOT (NEW.payload ? 'enquiry_id') OR
     (NEW.payload->>'enquiry_id') !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  THEN RETURN NULL; END IF;
  v_enquiry := (NEW.payload->>'enquiry_id')::uuid;

  SELECT e.customer_id INTO v_customer
  FROM public.enquiries e
  JOIN public.customers c ON c.id = e.customer_id AND c.workspace_id = e.workspace_id
  WHERE e.id = v_enquiry AND e.workspace_id = NEW.workspace_id;
  IF v_customer IS NULL THEN RETURN NULL; END IF;

  v_title := CASE v_intent
    WHEN 'exchange' THEN 'Review exchange request and verify original order, policy and stock'
    WHEN 'order_status' THEN 'Verify original order and shipment status before replying'
    WHEN 'refund_return' THEN 'Review return or refund request and check order and policy'
    WHEN 'stock_check' THEN 'Verify stock availability and requested variant before replying'
    WHEN 'support' THEN 'Review customer support request and determine next steps'
  END;

  INSERT INTO public.follow_ups(
    workspace_id, customer_id, title, due_at, status, priority,
    source_enquiry_id, source_run_id, source_intent, assigned_to
  ) VALUES (
    NEW.workspace_id, v_customer, v_title, now() + interval '48 hours',
    'pending', 'normal', v_enquiry, NEW.id, v_intent, NULL
  )
  ON CONFLICT (workspace_id, source_enquiry_id)
    WHERE source_enquiry_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_task_id;

  IF v_task_id IS NOT NULL THEN
    INSERT INTO public.intrigue_v17_run_events(workspace_id, run_id, event_type, details)
    VALUES (NEW.workspace_id, NEW.id, 'support_followup_created',
      jsonb_build_object('follow_up_id', v_task_id, 'intent', v_intent));
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_core_create_support_followup()
FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS intrigue_core_auto_support_followup ON public.intrigue_v17_runs;
CREATE TRIGGER intrigue_core_auto_support_followup
AFTER UPDATE OF status, result ON public.intrigue_v17_runs
FOR EACH ROW EXECUTE FUNCTION public.intrigue_core_create_support_followup();

-- Fair claim rotates between workspace queues instead of always taking the
-- oldest job globally (which left ORBIT QA behind older NOVA jobs).
-- Preserve the existing claim's lease expiry, attempt and approval semantics.
CREATE OR REPLACE FUNCTION public.intrigue_v17_claim_fair(p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.intrigue_v17_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_run public.intrigue_v17_runs%ROWTYPE;
BEGIN
  IF p_lease_seconds NOT BETWEEN 30 AND 600 THEN
    RAISE EXCEPTION 'Invalid lease duration';
  END IF;

  WITH expired AS (
    SELECT id FROM public.intrigue_v17_runs
    WHERE status = 'running' AND leased_until < now() AND attempts >= max_attempts
    FOR UPDATE SKIP LOCKED LIMIT 100
  )
  UPDATE public.intrigue_v17_runs r
    SET status='dead_letter',lease_token=NULL,leased_until=NULL,
        last_error='Worker lease expired after final attempt',
        finished_at=now(),updated_at=now()
  FROM expired WHERE r.id=expired.id;

  WITH candidate AS (
    SELECT r.id FROM public.intrigue_v17_runs r
    WHERE (
      (r.status IN ('queued','retry_wait') AND r.available_at <= now()) OR
      (r.status = 'running' AND r.leased_until < now())
    ) AND r.attempts < r.max_attempts AND r.approved_at IS NOT NULL
    ORDER BY COALESCE(
      (SELECT MAX(ev.created_at)
       FROM public.intrigue_v17_run_events ev
       WHERE ev.workspace_id=r.workspace_id AND ev.event_type='claimed'),
      '-infinity'::timestamptz
    ), r.available_at, r.created_at
    FOR UPDATE OF r SKIP LOCKED LIMIT 1
  )
  UPDATE public.intrigue_v17_runs r
     SET status='running', attempts=r.attempts+1,
         lease_token=gen_random_uuid(),
         leased_until=now()+pg_catalog.make_interval(secs=>p_lease_seconds),
         updated_at=now()
  FROM candidate WHERE r.id=candidate.id
  RETURNING r.* INTO v_run;

  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.intrigue_v17_run_events(workspace_id,run_id,event_type,details)
  VALUES(v_run.workspace_id,v_run.id,'claimed',
    jsonb_build_object('attempt',v_run.attempts,'queue_mode','fair'));
  RETURN NEXT v_run;
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_v17_claim_fair(integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v17_claim_fair(integer) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
