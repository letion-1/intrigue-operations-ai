-- INTRIGUE V14.3 COMPLETE: Security & Usage + Access Removed
-- For installations currently on V14.2. This file is the ONLY migration to run.
-- It is safe to rerun if V14.3 or V14.3.1 functions were partly applied.
-- Does not remove company, customer, membership, quota or invitation records.
-- Apply in Supabase SQL Editor (not VS Code). Do not run V14.3 test SQL.

BEGIN;

-- PART 1: V14.3 owner AI usage reporting
-- V14.3: owner-only usage reporting. Safe to rerun. No business records changed.
-- This does not change existing V13.9 quota enforcement or reset counters.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.v143_owner_usage()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day timestamptz := pg_catalog.date_trunc('day',pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_minute timestamptz := pg_catalog.date_trunc('minute',pg_catalog.now());
  v_chat_day integer := 0;
  v_chat_minute integer := 0;
  v_index_day integer := 0;
  v_index_minute integer := 0;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE owner_id=v_user
  ) THEN RAISE EXCEPTION 'Owner account required'; END IF;

  SELECT COALESCE(MAX(request_count) FILTER (WHERE kind='chat' AND period='day' AND window_start=v_day),0),
         COALESCE(MAX(request_count) FILTER (WHERE kind='chat' AND period='minute' AND window_start=v_minute),0),
         COALESCE(MAX(request_count) FILTER (WHERE kind='index' AND period='day' AND window_start=v_day),0),
         COALESCE(MAX(request_count) FILTER (WHERE kind='index' AND period='minute' AND window_start=v_minute),0)
  INTO v_chat_day,v_chat_minute,v_index_day,v_index_minute
  FROM private.intrigue_ai_quota_usage WHERE user_id=v_user;

  RETURN pg_catalog.jsonb_build_object(
    'chat_today',v_chat_day,'chat_this_minute',v_chat_minute,
    'index_today',v_index_day,'index_this_minute',v_index_minute,
    'chat_day_limit',40,'chat_minute_limit',6,
    'index_day_limit',10,'index_minute_limit',2,
    'reset_utc',pg_catalog.to_char(v_day + INTERVAL '1 day','YYYY-MM-DD HH24:MI')
  );
END;
$$;
REVOKE ALL ON FUNCTION private.v143_owner_usage() FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.v143_owner_usage() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_intrigue_ai_usage()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.v143_owner_usage();
$$;
REVOKE ALL ON FUNCTION public.get_intrigue_ai_usage() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_intrigue_ai_usage() TO authenticated;

-- PART 2: V14.3.1 former-member access notice
-- INTRIGUE V14.3.1: Former staff access notice
-- Read-only RPC; no customer data, membership changes, or destructive migrations.
-- Uses the accepted invitation history retained by V14.1/V14.2.

CREATE OR REPLACE FUNCTION private.v1431_previous_access_notice()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'revoked', true,
    'company_name', w.name,
    'contact_email', COALESCE(NULLIF(s.contact_email, ''), '')
  )
  FROM public.workspace_invitations i
  JOIN public.workspaces w ON w.id = i.workspace_id
  LEFT JOIN public.workspace_settings s ON s.workspace_id = w.id
  WHERE i.accepted_by = (SELECT auth.uid())
    AND i.status = 'accepted'
    AND (SELECT auth.uid()) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.workspace_id = i.workspace_id
        AND m.user_id = (SELECT auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = (SELECT auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.workspaces owned
      WHERE owned.owner_id = (SELECT auth.uid())
    )
  ORDER BY i.accepted_at DESC NULLS LAST, i.created_at DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION private.v1431_previous_access_notice() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.v1431_previous_access_notice() TO authenticated;

-- Public RPC is invoker-only; privileged lookup remains in non-exposed private schema.
CREATE OR REPLACE FUNCTION public.get_intrigue_access_notice()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $function$
  SELECT private.v1431_previous_access_notice();
$function$;
REVOKE ALL ON FUNCTION public.get_intrigue_access_notice() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_intrigue_access_notice() TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
