-- INTRIGUE Sprint 1 RC2.3
-- Additive company language preference. No workspace/user/customer deletion.
BEGIN;
ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';

-- Idempotently add an allowlist. Do not change RLS or ownership policies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.workspace_settings'::regclass
      AND conname = 'intrigue_rc23_preferred_language_check'
  ) THEN
    ALTER TABLE public.workspace_settings
      ADD CONSTRAINT intrigue_rc23_preferred_language_check
      CHECK (preferred_language IN (
        'en','de','fr','es','pt','it','nl','sw','ar','tr',
        'pl','hi','zh','ja','ko','ru'
      ));
  END IF;
END $$;
COMMIT;
NOTIFY pgrst, 'reload schema';
