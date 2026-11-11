-- INTRIGUE AI budget notifications: additive and workspace-scoped.
-- Run in Supabase SQL Editor, not PowerShell. Requires existing AI Governance and support notifications.
BEGIN;
DO $check$
BEGIN
 IF to_regclass('public.intrigue_ai_plans') IS NULL
 OR to_regclass('public.intrigue_support_notifications') IS NULL
 OR to_regclass('private.intrigue_v21_supported_tables') IS NULL
 OR to_regprocedure('public.intrigue_platform_is_operator(uuid)') IS NULL
 OR to_regprocedure('public.intrigue_platform_workspace_open(uuid)') IS NULL
 THEN RAISE EXCEPTION 'AI Governance, Help Center and platform authorization migrations required'; END IF;
END;
$check$;

CREATE TABLE IF NOT EXISTS public.intrigue_ai_budget_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('text','voice')),
 period_start date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (workspace_id,kind,period_start)
);
CREATE INDEX IF NOT EXISTS intrigue_ai_budget_notices_recent_idx
 ON public.intrigue_ai_budget_notices (created_at DESC,workspace_id);
ALTER TABLE public.intrigue_ai_budget_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_ai_budget_notices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.intrigue_ai_budget_notices TO service_role;

CREATE TABLE IF NOT EXISTS private.intrigue_ai_budget_notice_reads (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notice_id uuid NOT NULL REFERENCES public.intrigue_ai_budget_notices(id) ON DELETE CASCADE,
 seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,notice_id)
);
ALTER TABLE private.intrigue_ai_budget_notice_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_ai_budget_notice_reads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.intrigue_ai_budget_notice_reads TO service_role;

INSERT INTO private.intrigue_v21_supported_tables(relation_name)
 VALUES ('public.intrigue_ai_budget_notices')
 ON CONFLICT(relation_name) DO NOTHING;
DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON public.intrigue_ai_budget_notices;
CREATE TRIGGER intrigue_v21_stop_closing_writes
 BEFORE INSERT OR UPDATE ON public.intrigue_ai_budget_notices
 FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace();

-- Service-role only. One alert per company/kind/month even with many denied jobs.
CREATE OR REPLACE FUNCTION public.intrigue_ai_budget_notice_emit(p_workspace uuid,p_kind text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_rows bigint := 0;
BEGIN
 IF p_workspace IS NULL OR p_kind IS NULL OR p_kind NOT IN ('text','voice') THEN
   RAISE EXCEPTION 'Invalid allowance notification' USING ERRCODE='22023';
 END IF;
 IF NOT public.intrigue_platform_workspace_open(p_workspace) THEN RETURN false; END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.intrigue_ai_plans p
   WHERE p.workspace_id=p_workspace AND (
     (p_kind='text' AND p.text_mode='managed') OR
     (p_kind='voice' AND p.voice_mode='managed')
   )
 ) THEN RETURN false; END IF;
 INSERT INTO public.intrigue_ai_budget_notices(workspace_id,kind,period_start)
 VALUES(p_workspace,p_kind,date_trunc('month',now() AT TIME ZONE 'UTC')::date)
 ON CONFLICT(workspace_id,kind,period_start) DO NOTHING;
 GET DIAGNOSTICS v_rows = ROW_COUNT;
 RETURN v_rows > 0;
END;
$fn$;

-- Read-only list, with separate private operator vs client-owner authorization.
CREATE OR REPLACE FUNCTION public.intrigue_ai_budget_notice_list(
 p_actor uuid,p_operator boolean,p_workspace uuid DEFAULT NULL,p_limit integer DEFAULT 40
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_items jsonb; v_unread bigint;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF p_operator THEN
   IF NOT public.intrigue_platform_is_operator(p_actor)
     OR EXISTS(SELECT 1 FROM public.workspace_memberships m WHERE m.user_id=p_actor)
     OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.owner_id=p_actor)
   THEN RAISE EXCEPTION 'Private administrator required' USING ERRCODE='42501'; END IF;
 ELSE
   -- Team members who are not the owner continue receiving normal support notices,
   -- but do not receive commercially sensitive company spending alerts.
   IF p_workspace IS NULL OR NOT EXISTS (
     SELECT 1 FROM public.workspaces w
     WHERE w.id=p_workspace AND w.owner_id=p_actor AND w.intrigue_erasure_state='active'
   ) THEN
     RETURN jsonb_build_object('items','[]'::jsonb,'unread_count',0);
   END IF;
 END IF;
 SELECT count(*) INTO v_unread
 FROM public.intrigue_ai_budget_notices n
 LEFT JOIN private.intrigue_ai_budget_notice_reads r
   ON r.notice_id=n.id AND r.actor_id=p_actor
 WHERE (p_operator OR n.workspace_id=p_workspace)
   AND r.notice_id IS NULL;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb)
 INTO v_items FROM (
   SELECT n.id,n.workspace_id,n.created_at,n.kind,
     'ai_allowance_reached'::text AS event_type,
     CASE WHEN n.kind='voice' THEN 'Receptionist allowance reached'
       ELSE 'Monthly AI allowance reached' END::text AS subject,
     w.name AS workspace_name,
     (r.notice_id IS NOT NULL) AS is_read
   FROM public.intrigue_ai_budget_notices n
   JOIN public.workspaces w ON w.id=n.workspace_id
   LEFT JOIN private.intrigue_ai_budget_notice_reads r
     ON r.notice_id=n.id AND r.actor_id=p_actor
   WHERE (p_operator OR n.workspace_id=p_workspace)
   ORDER BY n.created_at DESC,n.id DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit,40),1),60)
 ) x;
 RETURN jsonb_build_object('items',v_items,'unread_count',v_unread);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.intrigue_ai_budget_notice_mark_read(
 p_actor uuid,p_notice uuid,p_operator boolean,p_workspace uuid DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_workspace uuid;
BEGIN
 IF p_actor IS NULL OR p_notice IS NULL THEN RETURN false; END IF;
 SELECT n.workspace_id INTO v_workspace
 FROM public.intrigue_ai_budget_notices n WHERE n.id=p_notice;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_operator THEN
   IF NOT public.intrigue_platform_is_operator(p_actor)
     OR EXISTS(SELECT 1 FROM public.workspace_memberships m WHERE m.user_id=p_actor)
     OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.owner_id=p_actor)
   THEN RETURN false; END IF;
 ELSE
   IF v_workspace IS DISTINCT FROM p_workspace OR NOT EXISTS (
     SELECT 1 FROM public.workspaces w
     WHERE w.id=v_workspace AND w.owner_id=p_actor AND w.intrigue_erasure_state='active'
   ) THEN RETURN false; END IF;
 END IF;
 INSERT INTO private.intrigue_ai_budget_notice_reads(actor_id,notice_id)
 VALUES(p_actor,p_notice) ON CONFLICT(actor_id,notice_id) DO NOTHING;
 RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.intrigue_ai_budget_notice_emit(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_budget_notice_list(uuid,boolean,uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.intrigue_ai_budget_notice_mark_read(uuid,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_budget_notice_emit(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_budget_notice_list(uuid,boolean,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.intrigue_ai_budget_notice_mark_read(uuid,uuid,boolean,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Verification (all six TRUE):
SELECT
 to_regclass('public.intrigue_ai_budget_notices') IS NOT NULL AS notices_exist,
 to_regclass('private.intrigue_ai_budget_notice_reads') IS NOT NULL AS read_receipts_exist,
 EXISTS (SELECT 1 FROM private.intrigue_v21_supported_tables
   WHERE relation_name='public.intrigue_ai_budget_notices') AS erasure_registered,
 NOT has_table_privilege('authenticated','public.intrigue_ai_budget_notices','SELECT') AS client_table_private,
 NOT has_function_privilege('authenticated','public.intrigue_ai_budget_notice_emit(uuid,text)','EXECUTE') AS emit_server_only,
 NOT has_function_privilege('authenticated','public.intrigue_ai_budget_notice_list(uuid,boolean,uuid,integer)','EXECUTE') AS list_server_only;
