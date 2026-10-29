-- INTRIGUE V15.0 | Launch preview: owner-only plan INTEREST (NO PAYMENTS)
-- Requires V14.4. This does not change company memberships or AI limits.
-- This is NOT a subscription, entitlement, invoice, or payment authorization.
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_plan_interest (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_tier text NOT NULL CHECK (requested_tier IN ('pilot','growth','scale')),
  request_notes text NOT NULL DEFAULT '' CHECK (char_length(request_notes) <= 500),
  requested_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_plan_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_plan_interest FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workspace_plan_interest TO authenticated;

DROP POLICY IF EXISTS v15_plan_interest_owner_read ON public.workspace_plan_interest;
CREATE POLICY v15_plan_interest_owner_read ON public.workspace_plan_interest
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_plan_interest.workspace_id
      AND w.owner_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS v15_plan_interest_owner_insert ON public.workspace_plan_interest;
CREATE POLICY v15_plan_interest_owner_insert ON public.workspace_plan_interest
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_plan_interest.workspace_id
      AND w.owner_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS v15_plan_interest_owner_update ON public.workspace_plan_interest;
CREATE POLICY v15_plan_interest_owner_update ON public.workspace_plan_interest
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_plan_interest.workspace_id
      AND w.owner_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_plan_interest.workspace_id
      AND w.owner_id = (SELECT auth.uid())
  ));

COMMENT ON TABLE public.workspace_plan_interest IS
  'INTRIGUE staging: non-binding interest in possible plans. No payments or entitlements.';
COMMIT;
NOTIFY pgrst, 'reload schema';
