-- INTRIGUE Operations AI V17.2D: newest activity first
-- Add-only columns, isolated to the existing workspace records by RLS.
-- Apply to intended Supabase project after a backup and successful local source build.
BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.enquiries ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.follow_ups ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Backfill existing dated rows with their real creation time, NOT migration time.
UPDATE public.customers SET updated_at = coalesce(created_at, now()) WHERE updated_at IS NULL;
UPDATE public.enquiries SET updated_at = coalesce(created_at, now()) WHERE updated_at IS NULL;
UPDATE public.quotations SET updated_at = coalesce(created_at, now()) WHERE updated_at IS NULL;
-- Older follow-ups lack created_at. We cannot reconstruct their edit times.
UPDATE public.follow_ups SET updated_at = now() WHERE updated_at IS NULL;

ALTER TABLE public.customers ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.enquiries ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.quotations ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.follow_ups ALTER COLUMN updated_at SET DEFAULT now();

-- For historical rows and new rows, always have a reliable timestamp.
ALTER TABLE public.customers ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.enquiries ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.quotations ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.follow_ups ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.intrigue_v172d_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Idempotent update triggers. Existing RLS policies remain untouched.
DROP TRIGGER IF EXISTS intrigue_v172d_customers_touch ON public.customers;
CREATE TRIGGER intrigue_v172d_customers_touch
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v172d_touch_updated_at();

DROP TRIGGER IF EXISTS intrigue_v172d_enquiries_touch ON public.enquiries;
CREATE TRIGGER intrigue_v172d_enquiries_touch
BEFORE UPDATE ON public.enquiries
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v172d_touch_updated_at();

DROP TRIGGER IF EXISTS intrigue_v172d_quotations_touch ON public.quotations;
CREATE TRIGGER intrigue_v172d_quotations_touch
BEFORE UPDATE ON public.quotations
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v172d_touch_updated_at();

DROP TRIGGER IF EXISTS intrigue_v172d_followups_touch ON public.follow_ups;
CREATE TRIGGER intrigue_v172d_followups_touch
BEFORE UPDATE ON public.follow_ups
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v172d_touch_updated_at();

CREATE INDEX IF NOT EXISTS intrigue_v172d_customers_recent_idx
  ON public.customers (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS intrigue_v172d_enquiries_recent_idx
  ON public.enquiries (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS intrigue_v172d_quotations_recent_idx
  ON public.quotations (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS intrigue_v172d_followups_recent_idx
  ON public.follow_ups (workspace_id, updated_at DESC);

COMMIT;
NOTIFY pgrst, 'reload schema';
