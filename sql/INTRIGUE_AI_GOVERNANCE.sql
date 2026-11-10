-- INTRIGUE | AI Governance: managed allowances, BYOK staging, and a service-only ledger.
-- Additive. No account, ticket, or company deletion. Requires V21 + platform controls.
BEGIN;
DO $preflight$
BEGIN
 IF to_regclass('private.intrigue_v21_supported_tables') IS NULL OR
    to_regclass('private.intrigue_platform_workspace_controls') IS NULL OR
    to_regprocedure('public.intrigue_platform_workspace_open(uuid)') IS NULL THEN
   RAISE EXCEPTION 'Install the existing company privacy and private platform migrations first';
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.intrigue_ai_plans (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 text_mode text NOT NULL DEFAULT 'managed' CHECK(text_mode IN ('managed','byok')),
 voice_mode text NOT NULL DEFAULT 'managed' CHECK(voice_mode IN ('managed','byok')),
 text_provider text NOT NULL DEFAULT 'openrouter' CHECK(text_provider IN ('openrouter')),
 voice_provider text NOT NULL DEFAULT 'vapi' CHECK(voice_provider IN ('vapi')),
 text_budget_usd numeric(12,6) NOT NULL DEFAULT 30 CHECK(text_budget_usd BETWEEN 0 AND 100000),
 voice_seconds_limit integer NOT NULL DEFAULT 0 CHECK(voice_seconds_limit BETWEEN 0 AND 36000000),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.intrigue_ai_connections (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('openrouter','vapi')),
 secret_cipher text NOT NULL CHECK(length(secret_cipher) BETWEEN 50 AND 10000),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,provider)
);
CREATE TABLE IF NOT EXISTS public.intrigue_ai_usage_ledger (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 128),
 kind text NOT NULL CHECK(kind IN ('text','voice')),
 provider text NOT NULL CHECK(provider IN ('openrouter','vapi')),
 payer text NOT NULL CHECK(payer IN ('managed','byok')),
 period_start date NOT NULL,
 reserved_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK(reserved_usd>=0),
 reserved_seconds integer NOT NULL DEFAULT 0 CHECK(reserved_seconds>=0),
 actual_usd numeric(12,6) CHECK(actual_usd>=0),
 actual_seconds integer CHECK(actual_seconds>=0),
 input_tokens integer CHECK(input_tokens>=0),
 output_tokens integer CHECK(output_tokens>=0),
 provider_ref text,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes',
 PRIMARY KEY (workspace_id,request_key)
);
CREATE INDEX IF NOT EXISTS intrigue_ai_usage_month_idx ON public.intrigue_ai_usage_ledger(workspace_id,period_start,kind,status);
CREATE INDEX IF NOT EXISTS intrigue_ai_usage_recent_idx ON public.intrigue_ai_usage_ledger(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS intrigue_ai_usage_provider_ref_unique
 ON public.intrigue_ai_usage_ledger(workspace_id,provider,provider_ref) WHERE provider_ref IS NOT NULL;

ALTER TABLE public.intrigue_ai_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intrigue_ai_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intrigue_ai_usage_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_ai_plans,public.intrigue_ai_connections,public.intrigue_ai_usage_ledger FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_ai_plans,public.intrigue_ai_connections,public.intrigue_ai_usage_ledger TO service_role;

-- Existing workspaces: activate a conservative text allowance and zero managed voice minutes.
-- This does NOT turn on a new assistant or redirect the existing worker.
INSERT INTO public.intrigue_ai_plans(workspace_id)
 SELECT id FROM public.workspaces WHERE intrigue_erasure_state='active'
 ON CONFLICT(workspace_id) DO NOTHING;

-- Update the established owner-erasure registry, so future deletions include this data.
INSERT INTO private.intrigue_v21_supported_tables(relation_name) VALUES
 ('public.intrigue_ai_plans'),('public.intrigue_ai_connections'),('public.intrigue_ai_usage_ledger')
 ON CONFLICT(relation_name) DO NOTHING;

-- Prevent writes to companies already in closing/erasure state.
DO $guard$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'public.intrigue_ai_plans','public.intrigue_ai_connections','public.intrigue_ai_usage_ledger'
 ] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON %s',t::regclass);
   EXECUTE format('CREATE TRIGGER intrigue_v21_stop_closing_writes BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace()',t::regclass);
 END LOOP;
END $guard$;

-- SERVER-ONLY, idempotent reservation with tenant-scoped serialized budget check.
-- An expired reservation counts as unknown, NOT safely cancelled; it needs reconciliation.
CREATE OR REPLACE FUNCTION public.intrigue_ai_reserve(
 p_workspace uuid,p_request_key text,p_kind text,p_estimated_usd numeric,p_seconds integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_plan public.intrigue_ai_plans%ROWTYPE;
 v_existing public.intrigue_ai_usage_ledger%ROWTYPE;
 v_start date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
 v_used numeric;v_seconds bigint;v_mode text;v_provider text;
BEGIN
 IF p_workspace IS NULL OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_.:-]{8,128}$' OR
    p_kind IS NULL OR p_kind NOT IN ('text','voice') OR p_estimated_usd IS NULL OR p_estimated_usd < 0 OR p_estimated_usd > 100 OR
    p_seconds IS NULL OR p_seconds < 0 OR p_seconds > 7200 THEN
   RAISE EXCEPTION 'Invalid usage reservation request' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace::text, 2811));
 IF NOT public.intrigue_platform_workspace_open(p_workspace) THEN
   RAISE EXCEPTION 'Workspace is unavailable or frozen' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_plan FROM public.intrigue_ai_plans WHERE workspace_id=p_workspace FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company AI allowances have not been configured' USING ERRCODE='55000'; END IF;
 SELECT * INTO v_existing FROM public.intrigue_ai_usage_ledger
  WHERE workspace_id=p_workspace AND request_key=p_request_key;
 IF FOUND THEN
  RETURN jsonb_build_object('approved',false,'duplicate',true,'status',v_existing.status);
 END IF;
 v_mode:=CASE WHEN p_kind='text' THEN v_plan.text_mode ELSE v_plan.voice_mode END;
 v_provider:=CASE WHEN p_kind='text' THEN v_plan.text_provider ELSE v_plan.voice_provider END;
 IF v_mode='byok' AND NOT EXISTS(SELECT 1 FROM public.intrigue_ai_connections
   WHERE workspace_id=p_workspace AND provider=v_provider) THEN
   RAISE EXCEPTION 'Company-owned AI provider is not connected' USING ERRCODE='55000';
 END IF;
 IF v_mode='managed' AND p_kind='text' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_usd
                           WHEN status='reserved' THEN reserved_usd ELSE 0 END),0)
   INTO v_used FROM public.intrigue_ai_usage_ledger
   WHERE workspace_id=p_workspace AND period_start=v_start AND kind='text' AND payer='managed';
   IF v_used+p_estimated_usd>v_plan.text_budget_usd THEN
    RETURN jsonb_build_object('approved',false,'reason','text_allowance_exhausted');
   END IF;
 ELSIF v_mode='managed' AND p_kind='voice' THEN
   SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_seconds
                           WHEN status='reserved' THEN reserved_seconds ELSE 0 END),0)
   INTO v_seconds FROM public.intrigue_ai_usage_ledger
   WHERE workspace_id=p_workspace AND period_start=v_start AND kind='voice' AND payer='managed';
   IF v_seconds+p_seconds>v_plan.voice_seconds_limit THEN
    RETURN jsonb_build_object('approved',false,'reason','voice_allowance_exhausted');
   END IF;
 END IF;
 INSERT INTO public.intrigue_ai_usage_ledger(
  workspace_id,request_key,kind,provider,payer,period_start,reserved_usd,reserved_seconds
 ) VALUES(p_workspace,p_request_key,p_kind,v_provider,v_mode,v_start,p_estimated_usd,p_seconds);
 RETURN jsonb_build_object('approved',true,'provider',v_provider,'payer',v_mode);
END $fn$;

-- Never drop cost information when the provider has already run, including after a freeze.
CREATE OR REPLACE FUNCTION public.intrigue_ai_settle(
 p_workspace uuid,p_request_key text,p_actual_usd numeric,p_actual_seconds integer DEFAULT 0,
 p_input_tokens integer DEFAULT NULL,p_output_tokens integer DEFAULT NULL,p_provider_ref text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_item public.intrigue_ai_usage_ledger%ROWTYPE;
BEGIN
 IF p_actual_usd IS NULL OR p_actual_usd<0 OR p_actual_usd>100000 OR
    p_actual_seconds IS NULL OR p_actual_seconds<0 OR p_actual_seconds>7200 OR
    coalesce(p_input_tokens,0)<0 OR coalesce(p_output_tokens,0)<0 OR
    length(coalesce(p_provider_ref,''))>250 THEN
    RAISE EXCEPTION 'Invalid usage settlement' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_item FROM public.intrigue_ai_usage_ledger
   WHERE workspace_id=p_workspace AND request_key=p_request_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Usage reservation not found' USING ERRCODE='22023'; END IF;
 IF v_item.status='settled' THEN RETURN FALSE; END IF;
 IF v_item.status<>'reserved' THEN RAISE EXCEPTION 'Reservation already cancelled' USING ERRCODE='55000'; END IF;
 UPDATE public.intrigue_ai_usage_ledger SET status='settled',
   actual_usd=p_actual_usd,actual_seconds=p_actual_seconds,
   input_tokens=p_input_tokens,output_tokens=p_output_tokens,
   provider_ref=nullif(p_provider_ref,''),updated_at=now()
 WHERE workspace_id=p_workspace AND request_key=p_request_key;
 RETURN TRUE;
END $fn$;

-- Only cancel if no external provider request was made. Never use for a provider timeout.
CREATE OR REPLACE FUNCTION public.intrigue_ai_cancel(p_workspace uuid,p_request_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 UPDATE public.intrigue_ai_usage_ledger SET status='cancelled',updated_at=now()
 WHERE workspace_id=p_workspace AND request_key=p_request_key AND status='reserved';
 RETURN FOUND;
END $fn$;

-- Strict provider-webhook reconciliation: the caller must have independently
-- verified the provider's authenticity and workspace ownership.
CREATE OR REPLACE FUNCTION public.intrigue_ai_record_voice(
 p_workspace uuid,p_call_id text,p_cost_usd numeric,p_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_payer text;v_plan public.intrigue_ai_plans%ROWTYPE;
BEGIN
 IF p_call_id IS NULL OR p_call_id !~ '^[A-Za-z0-9_-]{8,100}$' OR
    p_cost_usd IS NULL OR p_cost_usd<0 OR p_cost_usd>100000 OR
    p_seconds IS NULL OR p_seconds<0 OR p_seconds>7200 THEN
  RAISE EXCEPTION 'Invalid voice record' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_plan FROM public.intrigue_ai_plans WHERE workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing company plan'; END IF;
 v_payer:=v_plan.voice_mode;
 INSERT INTO public.intrigue_ai_usage_ledger(workspace_id,request_key,kind,provider,payer,
    period_start,reserved_usd,reserved_seconds,actual_usd,actual_seconds,provider_ref,status)
 VALUES(p_workspace,'vapi:'||p_call_id,'voice','vapi',v_payer,
    date_trunc('month',now() AT TIME ZONE 'UTC')::date,0,0,p_cost_usd,p_seconds,p_call_id,'settled')
 ON CONFLICT(workspace_id,request_key) DO NOTHING;
 RETURN FOUND;
END $fn$;

-- Aggregate in the database: supports high-volume workspaces without a 10k-row API limit.
CREATE OR REPLACE FUNCTION public.intrigue_ai_usage_summary(p_workspace uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT jsonb_build_object(
  'text_usd',COALESCE(sum(CASE WHEN payer='managed' AND kind='text' AND status<>'cancelled'
    THEN CASE WHEN status='settled' THEN actual_usd ELSE reserved_usd END ELSE 0 END),0),
  'voice_seconds',COALESCE(sum(CASE WHEN payer='managed' AND kind='voice' AND status<>'cancelled'
    THEN CASE WHEN status='settled' THEN actual_seconds ELSE reserved_seconds END ELSE 0 END),0),
  'byok_usd',COALESCE(sum(CASE WHEN payer='byok' AND status<>'cancelled'
    THEN CASE WHEN status='settled' THEN actual_usd ELSE reserved_usd END ELSE 0 END),0),
  'pending_jobs',count(*) FILTER (WHERE status='reserved'),
  'text_requests',count(*) FILTER (WHERE kind='text' AND status<>'cancelled'),
  'voice_calls',count(*) FILTER (WHERE kind='voice' AND status<>'cancelled')
 )
 FROM public.intrigue_ai_usage_ledger
 WHERE workspace_id=p_workspace AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC')::date
$fn$;

REVOKE ALL ON FUNCTION public.intrigue_ai_reserve(uuid,text,text,numeric,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_settle(uuid,text,numeric,integer,integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_cancel(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_record_voice(uuid,text,numeric,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_usage_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_reserve(uuid,text,text,numeric,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_settle(uuid,text,numeric,integer,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_cancel(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_record_voice(uuid,text,numeric,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_usage_summary(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Read-only verification: every result should be true.
SELECT
 to_regclass('public.intrigue_ai_plans') IS NOT NULL AS plans_exist,
 to_regclass('public.intrigue_ai_connections') IS NOT NULL AS connections_exist,
 to_regclass('public.intrigue_ai_usage_ledger') IS NOT NULL AS usage_ledger_exists,
 NOT has_table_privilege('authenticated','public.intrigue_ai_connections','SELECT') AS secrets_private,
 NOT has_table_privilege('authenticated','public.intrigue_ai_usage_ledger','SELECT') AS usage_private,
 NOT has_function_privilege('authenticated','public.intrigue_ai_reserve(uuid,text,text,numeric,integer)','EXECUTE') AS reserves_server_only,
 NOT has_function_privilege('authenticated','public.intrigue_ai_record_voice(uuid,text,numeric,integer)','EXECUTE') AS voice_record_server_only,
 EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_ai_connections') AS erasure_registry_updated;
