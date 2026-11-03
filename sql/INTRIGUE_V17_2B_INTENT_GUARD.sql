-- INTRIGUE V17.2B: additive database-level intent gate.
-- Apply ONLY after V17.2A, on the intended Supabase project.
-- Existing V17.2A draft links and quotations remain unchanged.
-- An older unclassified run cannot save a new draft after this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.intrigue_v172b_guard_new_draft_link()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_status text;
BEGIN
  SELECT r.result, r.status INTO v_result, v_status
  FROM public.intrigue_v17_runs r
  WHERE r.id = NEW.run_id AND r.workspace_id = NEW.workspace_id
  FOR SHARE;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'succeeded'
    OR v_result->>'classification_source' IS DISTINCT FROM 'v17.2b'
    OR v_result->>'intent' IS DISTINCT FROM 'sales_quote'
    OR v_result->>'outcome' IS DISTINCT FROM 'matched'
  THEN
    RAISE EXCEPTION 'V17.2B: only verified new sales enquiries may create quotation drafts';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.intrigue_v172b_guard_new_draft_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS intrigue_v172b_guard_new_draft_link
  ON public.intrigue_v172_draft_links;
CREATE TRIGGER intrigue_v172b_guard_new_draft_link
BEFORE INSERT ON public.intrigue_v172_draft_links
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v172b_guard_new_draft_link();
COMMIT;
NOTIFY pgrst, 'reload schema';
