-- INTRIGUE multi-workspace receptionist setup and operator phone-request queue.
-- ADDITIVE ONLY. Does not provision, activate, redirect or purchase any phone numbers.
-- Take a database backup first. Execute in Supabase SQL Editor once.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.workspaces') IS NULL
 OR to_regclass('public.intrigue_ai_voice_routes') IS NULL
 OR to_regclass('private.intrigue_v21_supported_tables') IS NULL THEN
  RAISE EXCEPTION 'STOP: workspace, voice route and erasure migrations required';
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.intrigue_receptionist_workspace_settings (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 calendar_provider text NOT NULL DEFAULT 'google' CHECK (calendar_provider IN ('google','calendly','cal','none')),
 booking_mode text NOT NULL DEFAULT 'disabled' CHECK (booking_mode IN ('disabled','link','direct')),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intrigue_receptionist_workspace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_receptionist_workspace_settings FROM PUBLIC, anon;
GRANT SELECT,INSERT,UPDATE ON public.intrigue_receptionist_workspace_settings TO authenticated;
GRANT ALL ON public.intrigue_receptionist_workspace_settings TO service_role;
DROP POLICY IF EXISTS intrigue_receptionist_settings_owner_select ON public.intrigue_receptionist_workspace_settings;
CREATE POLICY intrigue_receptionist_settings_owner_select
 ON public.intrigue_receptionist_workspace_settings FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS intrigue_receptionist_settings_owner_insert ON public.intrigue_receptionist_workspace_settings;
CREATE POLICY intrigue_receptionist_settings_owner_insert
 ON public.intrigue_receptionist_workspace_settings FOR INSERT TO authenticated
 WITH CHECK (updated_by = (SELECT auth.uid()) AND EXISTS
  (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS intrigue_receptionist_settings_owner_update ON public.intrigue_receptionist_workspace_settings;
CREATE POLICY intrigue_receptionist_settings_owner_update
 ON public.intrigue_receptionist_workspace_settings FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())))
 WITH CHECK (updated_by = (SELECT auth.uid()) AND EXISTS
  (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS public.intrigue_receptionist_phone_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_kind text NOT NULL CHECK(request_kind IN ('new_number','existing_number','client_owned_vapi')),
 provider_mode text NOT NULL CHECK(provider_mode IN ('managed','byok')),
 phone_number_id uuid,
 assistant_id uuid,
 phone_hint varchar(40),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 operator_note varchar(300),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 CONSTRAINT intrigue_receptionist_phone_request_valid CHECK(
  request_kind = 'new_number' OR (phone_number_id IS NOT NULL AND assistant_id IS NOT NULL)
 )
);
CREATE INDEX IF NOT EXISTS intrigue_receptionist_requests_ws_created
 ON public.intrigue_receptionist_phone_requests(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS intrigue_receptionist_requests_pending
 ON public.intrigue_receptionist_phone_requests(status,created_at DESC) WHERE status='pending';
ALTER TABLE public.intrigue_receptionist_phone_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_receptionist_phone_requests FROM PUBLIC,anon;
GRANT SELECT,INSERT ON public.intrigue_receptionist_phone_requests TO authenticated;
GRANT ALL ON public.intrigue_receptionist_phone_requests TO service_role;
DROP POLICY IF EXISTS intrigue_receptionist_requests_owner_select ON public.intrigue_receptionist_phone_requests;
CREATE POLICY intrigue_receptionist_requests_owner_select
 ON public.intrigue_receptionist_phone_requests FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS intrigue_receptionist_requests_owner_insert ON public.intrigue_receptionist_phone_requests;
CREATE POLICY intrigue_receptionist_requests_owner_insert
 ON public.intrigue_receptionist_phone_requests FOR INSERT TO authenticated
 WITH CHECK (requested_by = (SELECT auth.uid()) AND status='pending'
  AND reviewed_by IS NULL AND reviewed_at IS NULL AND operator_note IS NULL
  AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));

INSERT INTO private.intrigue_v21_supported_tables(relation_name)
 VALUES ('public.intrigue_receptionist_workspace_settings'),
        ('public.intrigue_receptionist_phone_requests')
 ON CONFLICT(relation_name) DO NOTHING;
-- No UPDATE policy on requests: only platform operator service-role can approve/reject.
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Read-only verification: all checks should return TRUE.
SELECT
 to_regclass('public.intrigue_receptionist_workspace_settings') IS NOT NULL AS settings_created,
 to_regclass('public.intrigue_receptionist_phone_requests') IS NOT NULL AS requests_created,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.intrigue_receptionist_workspace_settings'::regclass) AS settings_rls,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.intrigue_receptionist_phone_requests'::regclass) AS requests_rls,
 NOT has_table_privilege('authenticated','public.intrigue_receptionist_phone_requests','UPDATE') AS client_cannot_approve,
 EXISTS (SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_receptionist_workspace_settings') AS settings_erasure_registered,
 EXISTS (SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_receptionist_phone_requests') AS requests_erasure_registered;
