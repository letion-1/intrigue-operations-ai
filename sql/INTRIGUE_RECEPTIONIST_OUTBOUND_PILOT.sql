-- INTRIGUE Outbound Pilot V1: additive and disabled in the app until operator flag enabled.
-- This migration does not start any call, grant a client permission to contact people,
-- change numbers, save provider credentials, or create bookings.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.workspaces') IS NULL
    OR to_regclass('public.intrigue_ai_voice_routes') IS NULL
    OR to_regclass('public.intrigue_ai_usage_ledger') IS NULL
    OR to_regprocedure('public.intrigue_ai_reserve(uuid,text,text,numeric,integer)') IS NULL
    OR to_regprocedure('public.intrigue_ai_settle(uuid,text,numeric,integer,integer,integer,text)') IS NULL
    OR to_regclass('private.intrigue_v21_supported_tables') IS NULL
 THEN RAISE EXCEPTION 'STOP: prerequisites missing. Do not proceed.'; END IF;
END
$preflight$;

CREATE TABLE IF NOT EXISTS public.intrigue_receptionist_outbound_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id uuid NOT NULL,
  assistant_id uuid NOT NULL,
  provider_mode text NOT NULL CHECK (provider_mode IN ('managed','byok')),
  recipient_e164 varchar(20) NOT NULL CHECK (recipient_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text NOT NULL CHECK (purpose IN ('requested_callback','appointment_reminder','service_update')),
  consent_reference varchar(250) NOT NULL CHECK (length(btrim(consent_reference))>=8),
  consent_attested_at timestamptz NOT NULL,
  reservation_seconds integer NOT NULL CHECK (reservation_seconds BETWEEN 60 AND 1800),
  status text NOT NULL DEFAULT 'starting' CHECK (status IN ('starting','placed','review_required','settled','failed')),
  provider_call_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One unresolved provider call per company. A timed-out call is never automatically freed.
CREATE UNIQUE INDEX IF NOT EXISTS intrigue_outbound_one_active_per_workspace
  ON public.intrigue_receptionist_outbound_attempts(workspace_id)
  WHERE status IN ('starting','placed','review_required');
CREATE INDEX IF NOT EXISTS intrigue_outbound_workspace_recent
  ON public.intrigue_receptionist_outbound_attempts(workspace_id,created_at DESC);
ALTER TABLE public.intrigue_receptionist_outbound_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_receptionist_outbound_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_receptionist_outbound_attempts TO service_role;
INSERT INTO private.intrigue_v21_supported_tables (relation_name)
 VALUES ('public.intrigue_receptionist_outbound_attempts') ON CONFLICT (relation_name) DO NOTHING;
DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON public.intrigue_receptionist_outbound_attempts;
CREATE TRIGGER intrigue_v21_stop_closing_writes
 BEFORE INSERT OR UPDATE ON public.intrigue_receptionist_outbound_attempts
 FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace();
NOTIFY pgrst,'reload schema';
COMMIT;

-- All four conditions must be true. No client CRUD direct access.
SELECT
 to_regclass('public.intrigue_receptionist_outbound_attempts') IS NOT NULL AS attempts_created,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.intrigue_receptionist_outbound_attempts'::regclass) AS rls_enabled,
 NOT has_table_privilege('authenticated','public.intrigue_receptionist_outbound_attempts','SELECT') AS attempts_private,
 EXISTS (SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_receptionist_outbound_attempts') AS erasure_registered;
