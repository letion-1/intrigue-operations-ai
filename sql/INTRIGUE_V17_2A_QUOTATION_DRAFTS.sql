-- INTRIGUE Operations AI V17.2A: Approval-gated enquiry quotation drafting.
-- Apply only AFTER V17.1A + V17.1B in a separate STAGING Supabase project.
-- Preserves all customer, quotation, V11 and V17.1B data and audit workflows.
-- Does not email, WhatsApp, call customers, or schedule meetings.
-- PRECONDITION: public.intrigue_quote_save_draft must exist and work already.
BEGIN;

-- V17.1A explicitly allowed ONLY audit_event. Extend that one check, nothing else.
ALTER TABLE public.intrigue_v17_workflows
  DROP CONSTRAINT IF EXISTS intrigue_v17_workflows_action_type_check;
ALTER TABLE public.intrigue_v17_workflows
  ADD CONSTRAINT intrigue_v17_workflows_action_type_check
  CHECK (action_type IN ('audit_event','quotation_draft'));

-- Ensure at most one special-purpose quotation workflow exists per company.
CREATE UNIQUE INDEX IF NOT EXISTS intrigue_v172_quote_workflow_workspace_idx
  ON public.intrigue_v17_workflows(workspace_id)
  WHERE action_type='quotation_draft';

-- One quotation draft per successfully analyzed run, enforced transactionally.
-- The existing public.quotations and public.quotation_line_items remain the source of truth.
CREATE TABLE IF NOT EXISTS public.intrigue_v172_draft_links (
  run_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  quotation_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intrigue_v172_links_run_workspace_fk
    FOREIGN KEY (run_id, workspace_id)
    REFERENCES public.intrigue_v17_runs(id,workspace_id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, quotation_id)
);
ALTER TABLE public.intrigue_v172_draft_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_v172_draft_links FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.intrigue_v172_draft_links TO service_role;

-- A signed-in Owner/Admin explicitly chooses to save a verified suggestion.
-- auth.uid() remains the original caller's JWT subject even inside SECURITY DEFINER.
-- This is an internal database write, NEVER an approval to deliver anything to customers.
CREATE OR REPLACE FUNCTION public.intrigue_v172_commit_quote(
  p_workspace_id uuid, p_run_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_run public.intrigue_v17_runs%ROWTYPE;
  v_workflow public.intrigue_v17_workflows%ROWTYPE;
  v_enquiry public.enquiries%ROWTYPE;
  v_items jsonb;
  v_count int;
  v_saved jsonb;
  v_quote_id uuid;
  v_existing uuid;
  v_approved_items int;
BEGIN
  IF v_user IS NULL OR p_workspace_id IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and identifiers are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id AND m.user_id=v_user AND m.role IN ('owner','admin')
  ) OR NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace Owner or Admin permission required';
  END IF;

  SELECT * INTO v_run FROM public.intrigue_v17_runs
  WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run not found in this workspace'; END IF;
  SELECT * INTO v_workflow FROM public.intrigue_v17_workflows
  WHERE id=v_run.workflow_id AND workspace_id=p_workspace_id;
  IF NOT FOUND OR v_workflow.action_type<>'quotation_draft' OR v_workflow.requires_approval<>true
    OR v_run.approved_at IS NULL OR v_run.status<>'succeeded' THEN
    RAISE EXCEPTION 'Quotation analysis must succeed after human approval';
  END IF;

  SELECT quotation_id INTO v_existing FROM public.intrigue_v172_draft_links
    WHERE run_id=p_run_id AND workspace_id=p_workspace_id;
  IF v_existing IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('quotation_id',v_existing,'already_exists',true);
  END IF;

  IF v_run.result->>'kind'<>'quotation_draft' OR v_run.result->>'outcome'<>'matched'
    OR v_run.result->>'currency'<>'EUR' THEN
    RAISE EXCEPTION 'Analysis requires manual review; no quotation saved';
  END IF;
  IF v_run.result->'warnings' IS NULL OR pg_catalog.jsonb_typeof(v_run.result->'warnings')<>'array'
    OR pg_catalog.jsonb_array_length(v_run.result->'warnings')<>0 THEN
    RAISE EXCEPTION 'Unresolved quotation warnings';
  END IF;
  IF v_run.payload->>'enquiry_id' IS DISTINCT FROM v_run.result->>'enquiry_id' THEN
    RAISE EXCEPTION 'Enquiry changed since this workflow was queued';
  END IF;
  SELECT * INTO v_enquiry FROM public.enquiries
  WHERE id=(v_run.payload->>'enquiry_id')::uuid AND workspace_id=p_workspace_id;
  IF NOT FOUND OR v_enquiry.customer_id::text IS DISTINCT FROM v_run.result->>'customer_id' THEN
    RAISE EXCEPTION 'Customer or enquiry mismatch';
  END IF;
  IF pg_catalog.md5(pg_catalog.lower(pg_catalog.btrim(v_enquiry.subject)))
       IS DISTINCT FROM v_run.result->>'subject_md5' THEN
    RAISE EXCEPTION 'Enquiry has changed; prepare a new analysis before saving';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c
    WHERE c.id=v_enquiry.customer_id AND c.workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'Customer is no longer available';
  END IF;

  v_items := v_run.result->'catalog_items';
  IF v_items IS NULL OR pg_catalog.jsonb_typeof(v_items)<>'array'
    OR pg_catalog.jsonb_array_length(v_items) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Invalid or empty catalog item selection';
  END IF;
  -- Lock selected catalog rows until the existing quote-save function has rechecked
  -- and saved them, preventing concurrent catalog-price changes during approval.
  PERFORM 1 FROM public.workspace_services s
    WHERE s.workspace_id=p_workspace_id AND s.id IN (
      SELECT (entry->>'catalog_id')::uuid FROM pg_catalog.jsonb_array_elements(v_items) entry
    ) FOR SHARE;
  -- Verify every selected item against the current, active company catalog;
  -- reject repeated IDs, price changes, and suspicious quantities.
  WITH chosen AS (
    SELECT * FROM pg_catalog.jsonb_to_recordset(v_items)
      AS x(catalog_id uuid,quantity int,unit_price numeric)
  )
  SELECT count(*),count(DISTINCT x.catalog_id) INTO v_count,v_approved_items
  FROM chosen x
  JOIN public.workspace_services s ON s.id=x.catalog_id AND s.workspace_id=p_workspace_id
  WHERE s.is_active=true AND s.currency='EUR' AND s.price>0
    AND s.price=x.unit_price AND x.quantity BETWEEN 1 AND 100;
  IF v_count<>pg_catalog.jsonb_array_length(v_items) OR v_count<>v_approved_items THEN
    RAISE EXCEPTION 'Catalog items or prices changed. Review and start a new analysis';
  END IF;

  -- Save through the EXISTING V16 catalog-price RPC, not via a parallel quote table.
  -- The existing function is expected to revalidate prices and return quotation_id.
  SELECT pg_catalog.to_jsonb(public.intrigue_quote_save_draft(
    p_workspace_id=>p_workspace_id,
    p_customer_id=>v_enquiry.customer_id,
    p_items=>(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'catalog_id',i.catalog_id,'quantity',i.quantity)) FROM pg_catalog.jsonb_to_recordset(v_items)
      AS i(catalog_id uuid,quantity int)),
    p_note=>'Draft prepared from enquiry '||v_enquiry.id::text||'. Review before approval or customer delivery.',
    p_quote_id=>NULL::uuid
  )) INTO v_saved;
  IF v_saved IS NULL OR v_saved->>'quotation_id' IS NULL THEN
    RAISE EXCEPTION 'Existing quotation save function returned no draft ID';
  END IF;
  v_quote_id := (v_saved->>'quotation_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.quotations q
    WHERE q.id=v_quote_id AND q.workspace_id=p_workspace_id
      AND q.customer_id=v_enquiry.customer_id AND q.status='draft') THEN
    RAISE EXCEPTION 'Saved quotation could not be verified';
  END IF;
  INSERT INTO public.intrigue_v172_draft_links(run_id,workspace_id,quotation_id,created_by)
  VALUES(p_run_id,p_workspace_id,v_quote_id,v_user);
  INSERT INTO public.intrigue_v17_run_events(workspace_id,run_id,event_type,details)
  VALUES(p_workspace_id,p_run_id,'quotation_draft_saved',
    pg_catalog.jsonb_build_object('quotation_id',v_quote_id,'actor_id',v_user));
  RETURN pg_catalog.jsonb_build_object('quotation_id',v_quote_id,'already_exists',false);
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_v172_commit_quote(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v172_commit_quote(uuid,uuid) TO authenticated;
COMMIT;
NOTIFY pgrst, 'reload schema';
