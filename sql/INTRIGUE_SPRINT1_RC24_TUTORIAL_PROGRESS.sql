-- INTRIGUE RC2.4 · persistent onboarding progress
-- ADDITIVE; no existing customer, company or Auth data changed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.intrigue_onboarding_progress (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  step smallint NOT NULL CHECK (step BETWEEN 1 AND 6),
  status text NOT NULL CHECK (status IN ('skipped','completed')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, step)
);

ALTER TABLE public.intrigue_onboarding_progress ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.intrigue_onboarding_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.intrigue_onboarding_progress TO authenticated;

DROP POLICY IF EXISTS intrigue_onboarding_read_owner ON public.intrigue_onboarding_progress;
CREATE POLICY intrigue_onboarding_read_owner
ON public.intrigue_onboarding_progress FOR SELECT TO authenticated
USING (EXISTS (
 SELECT 1 FROM public.workspaces w
 WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS intrigue_onboarding_add_owner ON public.intrigue_onboarding_progress;
CREATE POLICY intrigue_onboarding_add_owner
ON public.intrigue_onboarding_progress FOR INSERT TO authenticated
WITH CHECK (EXISTS (
 SELECT 1 FROM public.workspaces w
 WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS intrigue_onboarding_update_owner ON public.intrigue_onboarding_progress;
CREATE POLICY intrigue_onboarding_update_owner
ON public.intrigue_onboarding_progress FOR UPDATE TO authenticated
USING (EXISTS (
 SELECT 1 FROM public.workspaces w
 WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
 SELECT 1 FROM public.workspaces w
 WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())
));

-- Keep timestamps accurate even for upserts.
CREATE OR REPLACE FUNCTION public.intrigue_onboarding_touch_changed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_onboarding_touch_changed_at()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS intrigue_onboarding_touch ON public.intrigue_onboarding_progress;
CREATE TRIGGER intrigue_onboarding_touch
BEFORE UPDATE ON public.intrigue_onboarding_progress
FOR EACH ROW EXECUTE FUNCTION public.intrigue_onboarding_touch_changed_at();

COMMIT;
NOTIFY pgrst, 'reload schema';
