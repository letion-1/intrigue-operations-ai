-- INTRIGUE Operations AI — one additive, fail-closed voice governance migration.
-- Apply in Supabase SQL Editor. Does not activate any phone numbers.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('public.intrigue_ai_plans') IS NULL
 OR to_regclass('public.intrigue_ai_usage_ledger') IS NULL
 OR to_regclass('public.intrigue_ai_connections') IS NULL
 OR to_regclass('private.intrigue_v21_supported_tables') IS NULL
 OR to_regprocedure('public.intrigue_platform_workspace_open(uuid)') IS NULL
 OR to_regprocedure('public.intrigue_ai_budget_notice_emit(uuid,text)') IS NULL THEN
  RAISE EXCEPTION 'STOP: prior AI Governance, notices, freeze and erasure migrations required';
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.intrigue_ai_voice_routes (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 phone_number_id uuid NOT NULL UNIQUE,
 assistant_id uuid NOT NULL,
 token_sha256 text NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
 provider_mode text NOT NULL CHECK (provider_mode IN ('managed','byok')),
 reservation_seconds integer NOT NULL DEFAULT 600 CHECK (reservation_seconds BETWEEN 60 AND 1800),
 active boolean NOT NULL DEFAULT false,
 verified_at timestamptz,
 last_attempt_at timestamptz,
 last_denial text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id, phone_number_id)
);
CREATE INDEX IF NOT EXISTS intrigue_ai_voice_routes_workspace_idx
 ON public.intrigue_ai_voice_routes(workspace_id,active);
ALTER TABLE public.intrigue_ai_voice_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_ai_voice_routes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_ai_voice_routes TO service_role;
INSERT INTO private.intrigue_v21_supported_tables(relation_name)
 VALUES('public.intrigue_ai_voice_routes') ON CONFLICT(relation_name) DO NOTHING;
DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON public.intrigue_ai_voice_routes;
CREATE TRIGGER intrigue_v21_stop_closing_writes
 BEFORE INSERT OR UPDATE ON public.intrigue_ai_voice_routes
 FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace();

-- Atomic admission. The server authenticates the bearer token by SHA-256
-- and checks the phone identity before using this privileged RPC.
-- The phone must have dynamic assistant resolution; a fixed assistant bypasses this RPC.
CREATE OR REPLACE FUNCTION public.intrigue_ai_voice_admit(
 p_workspace uuid, p_phone_number uuid, p_assistant uuid,
 p_call uuid, p_token_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 v_route public.intrigue_ai_voice_routes%ROWTYPE;
 v_plan public.intrigue_ai_plans%ROWTYPE;
 v_existing public.intrigue_ai_usage_ledger%ROWTYPE;
 v_used bigint;
 v_period date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
 v_key text;
BEGIN
 IF p_workspace IS NULL OR p_phone_number IS NULL OR p_assistant IS NULL OR p_call IS NULL
 OR p_token_sha256 !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid voice admission inputs' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text,2811));
 SELECT * INTO v_route FROM public.intrigue_ai_voice_routes
 WHERE workspace_id=p_workspace AND phone_number_id=p_phone_number
 AND assistant_id=p_assistant AND token_sha256=p_token_sha256
 AND active=true FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('approved',false,'reason','route_unavailable'); END IF;
 IF NOT public.intrigue_platform_workspace_open(p_workspace) THEN
  RETURN jsonb_build_object('approved',false,'reason','workspace_unavailable');
 END IF;
 SELECT * INTO v_plan FROM public.intrigue_ai_plans WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND OR v_plan.voice_mode<>v_route.provider_mode OR v_plan.voice_provider<>'vapi' THEN
  RETURN jsonb_build_object('approved',false,'reason','voice_mode_mismatch');
 END IF;
 IF v_plan.voice_mode='byok' AND NOT EXISTS (
  SELECT 1 FROM public.intrigue_ai_connections
  WHERE workspace_id=p_workspace AND provider='vapi'
 ) THEN RETURN jsonb_build_object('approved',false,'reason','company_voice_disconnected'); END IF;
 v_key := 'vapi:' || p_call::text;
 SELECT * INTO v_existing FROM public.intrigue_ai_usage_ledger
 WHERE workspace_id=p_workspace AND request_key=v_key;
 IF FOUND THEN
  IF v_existing.status='reserved' AND v_existing.provider='vapi'
  AND v_existing.payer=v_route.provider_mode THEN
   RETURN jsonb_build_object('approved',true,'replay',true,'assistant_id',p_assistant);
  END IF;
  RETURN jsonb_build_object('approved',false,'reason','call_already_finalized');
 END IF;
 IF v_route.provider_mode='managed' THEN
  SELECT COALESCE(sum(CASE
   WHEN status='settled' THEN actual_seconds
   WHEN status='reserved' THEN reserved_seconds
   ELSE 0 END),0)
  INTO v_used FROM public.intrigue_ai_usage_ledger
  WHERE workspace_id=p_workspace AND period_start=v_period
  AND kind='voice' AND payer='managed';
  IF v_plan.voice_seconds_limit < v_used + v_route.reservation_seconds THEN
   RETURN jsonb_build_object('approved',false,'reason','voice_allowance_exhausted');
  END IF;
 END IF;
 INSERT INTO public.intrigue_ai_usage_ledger (
  workspace_id,request_key,kind,provider,payer,period_start,
  reserved_usd,reserved_seconds,status,expires_at
 ) VALUES (p_workspace,v_key,'voice','vapi',v_route.provider_mode,v_period,
  0,v_route.reservation_seconds,'reserved',now()+interval '36 hours');
 RETURN jsonb_build_object('approved',true,'replay',false,'assistant_id',p_assistant,
  'reserved_seconds',v_route.reservation_seconds);
END $fn$;

-- Read-only, operationally safe helper for pending voice reservations.
CREATE OR REPLACE FUNCTION public.intrigue_ai_voice_pending(p_workspace uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT jsonb_build_object(
  'pending_voice',count(*) FILTER(WHERE kind='voice' AND status='reserved'),
  'oldest_pending',min(created_at) FILTER(WHERE kind='voice' AND status='reserved'),
  'pending_seconds',COALESCE(sum(reserved_seconds) FILTER(WHERE kind='voice' AND status='reserved'),0),
  'unreconciled_over_36h',count(*) FILTER(WHERE kind='voice' AND status='reserved'
                                      AND created_at<now()-interval '36 hours')
 ) FROM public.intrigue_ai_usage_ledger WHERE workspace_id=p_workspace;
$fn$;

REVOKE ALL ON FUNCTION public.intrigue_ai_voice_admit(uuid,uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_voice_admit(uuid,uuid,uuid,uuid,text)
 TO service_role;
REVOKE ALL ON FUNCTION public.intrigue_ai_voice_pending(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_voice_pending(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verification: all seven fields should be true.
SELECT
 to_regclass('public.intrigue_ai_voice_routes') IS NOT NULL AS voice_routes_exist,
 (SELECT relrowsecurity FROM pg_class WHERE oid='public.intrigue_ai_voice_routes'::regclass) AS voice_rls_enabled,
 NOT has_table_privilege('authenticated','public.intrigue_ai_voice_routes','SELECT') AS client_route_table_private,
 NOT has_function_privilege('authenticated','public.intrigue_ai_voice_admit(uuid,uuid,uuid,uuid,text)','EXECUTE') AS admit_server_only,
 has_function_privilege('service_role','public.intrigue_ai_voice_admit(uuid,uuid,uuid,uuid,text)','EXECUTE') AS server_can_admit,
 EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_ai_voice_routes') AS erasure_registered,
 NOT EXISTS(SELECT 1 FROM public.intrigue_ai_voice_routes WHERE active=true) AS no_calls_activated_by_migration;
