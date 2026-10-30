-- INTRIGUE V15.1: company-owned pilot applications. NO PAYMENTS OR TRIAL ACTIVATION.
-- Run AFTER V15.0. Preserves all company, team, AI and plan-interest records.
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_pilot_requests (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_name text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 100),
  contact_email text NOT NULL CHECK (
    char_length(contact_email) BETWEEN 5 AND 254
    AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  intended_use text NOT NULL CHECK (char_length(btrim(intended_use)) BETWEEN 20 AND 1200),
  success_criteria text NOT NULL CHECK (char_length(btrim(success_criteria)) BETWEEN 10 AND 800),
  estimated_seats integer NOT NULL DEFAULT 1 CHECK (estimated_seats BETWEEN 1 AND 1000),
  preferred_start date,
  request_notes text NOT NULL DEFAULT '' CHECK (char_length(request_notes) <= 500),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','contacted','closed')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_pilot_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_pilot_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_pilot_requests TO authenticated;
-- INSERT is also restricted to application fields. Review status and submission
-- timestamp can only be set through their database defaults or by an operator.
GRANT INSERT (workspace_id, contact_name, contact_email, intended_use,
  success_criteria, estimated_seats, preferred_start, request_notes, updated_at)
ON public.workspace_pilot_requests TO authenticated;
-- A normal user cannot set or change status, workspace_id or submitted_at on UPDATE.
GRANT UPDATE (contact_name, contact_email, intended_use, success_criteria,
  estimated_seats, preferred_start, request_notes, updated_at)
ON public.workspace_pilot_requests TO authenticated;

DROP POLICY IF EXISTS v151_owner_read_pilot ON public.workspace_pilot_requests;
CREATE POLICY v151_owner_read_pilot ON public.workspace_pilot_requests
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_pilot_requests.workspace_id
        AND w.owner_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS v151_owner_submit_pilot ON public.workspace_pilot_requests;
CREATE POLICY v151_owner_submit_pilot ON public.workspace_pilot_requests
  FOR INSERT TO authenticated WITH CHECK (
    status = 'submitted'
    AND EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_pilot_requests.workspace_id
        AND w.owner_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS v151_owner_edit_submitted_pilot ON public.workspace_pilot_requests;
CREATE POLICY v151_owner_edit_submitted_pilot ON public.workspace_pilot_requests
  FOR UPDATE TO authenticated USING (
    status = 'submitted'
    AND EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_pilot_requests.workspace_id
        AND w.owner_id = (SELECT auth.uid()))
  ) WITH CHECK (
    status = 'submitted'
    AND EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_pilot_requests.workspace_id
        AND w.owner_id = (SELECT auth.uid()))
  );

CREATE INDEX IF NOT EXISTS workspace_pilot_requests_status_idx
  ON public.workspace_pilot_requests (status, submitted_at DESC);

COMMENT ON TABLE public.workspace_pilot_requests IS
  'V15.1 private pilot intake for manual operator review only. Not an active trial, subscription, approval entitlement or invitation.';

COMMIT;
NOTIFY pgrst, 'reload schema';
