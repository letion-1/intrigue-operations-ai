-- INTRIGUE V13.9: atomic per-account AI request quotas
-- Apply in Supabase SQL Editor BEFORE deploying the V13.9 API code.
-- New schema objects only: no existing customer, proposal or document records changed.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.intrigue_ai_quota_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat', 'index')),
  period text NOT NULL CHECK (period IN ('minute', 'day')),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY(user_id, kind, period, window_start)
);
REVOKE ALL ON private.intrigue_ai_quota_usage FROM PUBLIC, anon, authenticated;

-- Private privilege-bearing function; caller cannot choose an account or quota limit.
CREATE OR REPLACE FUNCTION private.intrigue_consume_ai_quota(p_kind text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_minute_limit integer;
  v_day_limit integer;
  v_count integer;
  v_period text;
  v_start timestamptz;
  v_limit integer;
  v_daily_remaining integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'INTRIGUE_NOT_AUTHENTICATED'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('chat', 'index') THEN
    RAISE EXCEPTION 'INTRIGUE_INVALID_QUOTA_KIND';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.owner_id = v_user
  ) THEN RAISE EXCEPTION 'INTRIGUE_WORKSPACE_REQUIRED'; END IF;

  IF p_kind = 'chat' THEN
    v_minute_limit := 6;
    v_day_limit := 40;
  ELSE
    v_minute_limit := 2;
    v_day_limit := 10;
  END IF;

  -- Both counter increments happen in ONE database transaction. If either limit
  -- is hit, raising an exception rolls back both increments.
  FOR v_period IN SELECT unnest(ARRAY['minute'::text, 'day'::text]) LOOP
    IF v_period = 'minute' THEN
      v_start := pg_catalog.date_trunc('minute', pg_catalog.now());
      v_limit := v_minute_limit;
    ELSE
      v_start := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
      v_limit := v_day_limit;
    END IF;

    INSERT INTO private.intrigue_ai_quota_usage
      (user_id, kind, period, window_start, request_count)
    VALUES (v_user, p_kind, v_period, v_start, 1)
    ON CONFLICT (user_id, kind, period, window_start)
    DO UPDATE SET request_count = private.intrigue_ai_quota_usage.request_count + 1
      WHERE private.intrigue_ai_quota_usage.request_count < v_limit
    RETURNING request_count INTO v_count;

    IF NOT FOUND THEN
      IF v_period = 'minute' THEN
        RAISE EXCEPTION 'INTRIGUE_MINUTE_QUOTA';
      ELSE
        RAISE EXCEPTION 'INTRIGUE_DAILY_QUOTA';
      END IF;
    END IF;
    IF v_period = 'day' THEN v_daily_remaining := v_limit - v_count; END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', true, 'kind', p_kind, 'remaining_today', v_daily_remaining
  );
END;
$$;
REVOKE ALL ON FUNCTION private.intrigue_consume_ai_quota(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.intrigue_consume_ai_quota(text)
  TO authenticated;

-- Public RPC is SECURITY INVOKER; it does NOT bypass table RLS itself.
CREATE OR REPLACE FUNCTION public.consume_intrigue_ai_quota(p_kind text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.intrigue_consume_ai_quota(p_kind);
$$;
REVOKE ALL ON FUNCTION public.consume_intrigue_ai_quota(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_intrigue_ai_quota(text)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
