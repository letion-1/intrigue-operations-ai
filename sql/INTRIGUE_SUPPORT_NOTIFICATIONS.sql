-- INTRIGUE STUDIOS | Help Center notifications
-- Additive migration: no account, ticket, message or workspace deletions.
-- Run after verifying a current database backup. Requires the existing Help Center and V21 registry.
BEGIN;

DO $check$
BEGIN
  IF to_regclass('public.intrigue_platform_support_tickets') IS NULL
     OR to_regclass('public.intrigue_platform_support_messages') IS NULL
     OR to_regclass('private.intrigue_v21_supported_tables') IS NULL THEN
    RAISE EXCEPTION 'Existing Help Center / company erasure registry is required before notification setup';
  END IF;
END;
$check$;

CREATE TABLE IF NOT EXISTS public.intrigue_support_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL,
  audience text NOT NULL CHECK (audience IN ('client','operator')),
  event_type text NOT NULL CHECK (event_type IN ('new_ticket','client_reply','support_reply','status_resolved','status_closed')),
  source_message_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(ticket_id,workspace_id) REFERENCES public.intrigue_platform_support_tickets(id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS intrigue_support_notification_recent
  ON public.intrigue_support_notifications(audience,workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS intrigue_support_notification_ticket
  ON public.intrigue_support_notifications(ticket_id,created_at DESC);
ALTER TABLE public.intrigue_support_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_support_notifications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.intrigue_support_notifications TO service_role;

CREATE TABLE IF NOT EXISTS private.intrigue_support_notification_reads (
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.intrigue_support_notifications(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,notification_id)
);
ALTER TABLE private.intrigue_support_notification_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_support_notification_reads FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON private.intrigue_support_notification_reads TO service_role;

-- The new workspace table must participate in verified company erasure.
INSERT INTO private.intrigue_v21_supported_tables(relation_name)
VALUES ('public.intrigue_support_notifications')
ON CONFLICT(relation_name) DO NOTHING;
DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON public.intrigue_support_notifications;
CREATE TRIGGER intrigue_v21_stop_closing_writes
BEFORE INSERT OR UPDATE ON public.intrigue_support_notifications
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace();

-- Database-generated events cannot be skipped by a UI path or cause duplicate alerts on page reload.
CREATE OR REPLACE FUNCTION public.intrigue_support_ticket_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.intrigue_support_notifications(workspace_id,ticket_id,audience,event_type)
    VALUES (NEW.workspace_id,NEW.id,'operator','new_ticket');
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('resolved','closed') THEN
      INSERT INTO public.intrigue_support_notifications(workspace_id,ticket_id,audience,event_type)
      VALUES (NEW.workspace_id,NEW.id,'client',CASE WHEN NEW.status='resolved' THEN 'status_resolved' ELSE 'status_closed' END);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_support_ticket_notification() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS intrigue_support_ticket_created_notice ON public.intrigue_platform_support_tickets;
CREATE TRIGGER intrigue_support_ticket_created_notice AFTER INSERT ON public.intrigue_platform_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.intrigue_support_ticket_notification();
DROP TRIGGER IF EXISTS intrigue_support_ticket_status_notice ON public.intrigue_platform_support_tickets;
CREATE TRIGGER intrigue_support_ticket_status_notice AFTER UPDATE OF status ON public.intrigue_platform_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.intrigue_support_ticket_notification();

CREATE OR REPLACE FUNCTION public.intrigue_support_message_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
  IF NEW.speaker='operator' THEN
    INSERT INTO public.intrigue_support_notifications(workspace_id,ticket_id,audience,event_type,source_message_id)
    VALUES(NEW.workspace_id,NEW.ticket_id,'client','support_reply',NEW.id)
    ON CONFLICT(source_message_id) DO NOTHING;
  ELSIF NEW.speaker='client' AND EXISTS(
    SELECT 1 FROM public.intrigue_platform_support_messages older
    WHERE older.ticket_id=NEW.ticket_id AND older.id<>NEW.id
  ) THEN
    -- First client message is part of ticket creation, not another support request.
    INSERT INTO public.intrigue_support_notifications(workspace_id,ticket_id,audience,event_type,source_message_id)
    VALUES(NEW.workspace_id,NEW.ticket_id,'operator','client_reply',NEW.id)
    ON CONFLICT(source_message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_support_message_notification() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS intrigue_support_message_notice ON public.intrigue_platform_support_messages;
CREATE TRIGGER intrigue_support_message_notice AFTER INSERT ON public.intrigue_platform_support_messages
FOR EACH ROW EXECUTE FUNCTION public.intrigue_support_message_notification();

-- Authorized server RPC: workspace owners can view their team's cases; others only their own.
-- Operator access is separate and requires the dedicated platform identity.
CREATE OR REPLACE FUNCTION public.intrigue_support_notifications_list(
  p_actor uuid,p_operator boolean,p_workspace uuid DEFAULT NULL,p_limit integer DEFAULT 40
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_items jsonb; v_unread bigint;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
  IF p_operator THEN
    IF NOT public.intrigue_platform_is_operator(p_actor)
      OR EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=p_actor)
      OR EXISTS (SELECT 1 FROM public.workspaces WHERE owner_id=p_actor) THEN
      RAISE EXCEPTION 'Private administrator access required' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p_workspace IS NULL OR NOT public.intrigue_platform_member(p_actor,p_workspace) THEN
      RAISE EXCEPTION 'Company membership required' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT count(*) INTO v_unread
  FROM public.intrigue_support_notifications n
  LEFT JOIN private.intrigue_support_notification_reads r
    ON r.notification_id=n.id AND r.actor_id=p_actor
  WHERE n.audience=CASE WHEN p_operator THEN 'operator' ELSE 'client' END
    AND (p_operator OR (n.workspace_id=p_workspace AND
         public.intrigue_platform_can_view_ticket(p_actor,n.ticket_id,false)))
    AND r.notification_id IS NULL;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_items
  FROM (
    SELECT n.id,n.ticket_id,n.workspace_id,n.event_type,n.created_at,
      t.subject,w.name AS workspace_name,
      (r.notification_id IS NOT NULL) AS is_read
    FROM public.intrigue_support_notifications n
    JOIN public.intrigue_platform_support_tickets t ON t.id=n.ticket_id AND t.workspace_id=n.workspace_id
    JOIN public.workspaces w ON w.id=n.workspace_id
    LEFT JOIN private.intrigue_support_notification_reads r ON r.notification_id=n.id AND r.actor_id=p_actor
    WHERE n.audience=CASE WHEN p_operator THEN 'operator' ELSE 'client' END
      AND (p_operator OR (n.workspace_id=p_workspace AND
           public.intrigue_platform_can_view_ticket(p_actor,n.ticket_id,false)))
    ORDER BY n.created_at DESC,n.id DESC
    LIMIT LEAST(GREATEST(coalesce(p_limit,40),1),60)
  ) x;
  RETURN jsonb_build_object('items',v_items,'unread_count',v_unread);
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_support_notifications_list(uuid,boolean,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_support_notifications_list(uuid,boolean,uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_support_notification_mark_read(
  p_actor uuid,p_notification uuid,p_operator boolean,p_workspace uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE n record;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
  SELECT id,ticket_id,workspace_id,audience INTO n
  FROM public.intrigue_support_notifications WHERE id=p_notification;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_operator THEN
    IF n.audience<>'operator' OR NOT public.intrigue_platform_is_operator(p_actor)
     OR EXISTS(SELECT 1 FROM public.workspace_memberships WHERE user_id=p_actor)
     OR EXISTS(SELECT 1 FROM public.workspaces WHERE owner_id=p_actor) THEN
      RAISE EXCEPTION 'Private administrator access required' USING ERRCODE='42501';
    END IF;
  ELSE
    IF n.audience<>'client' OR n.workspace_id IS DISTINCT FROM p_workspace
       OR NOT public.intrigue_platform_member(p_actor,p_workspace)
       OR NOT public.intrigue_platform_can_view_ticket(p_actor,n.ticket_id,false) THEN
      RAISE EXCEPTION 'Notification access refused' USING ERRCODE='42501';
    END IF;
  END IF;
  INSERT INTO private.intrigue_support_notification_reads(actor_id,notification_id)
  VALUES (p_actor,n.id) ON CONFLICT(actor_id,notification_id) DO NOTHING;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_support_notification_mark_read(uuid,uuid,boolean,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_support_notification_mark_read(uuid,uuid,boolean,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

-- Read-only verification: all six fields should be true.
SELECT
  to_regclass('public.intrigue_support_notifications') IS NOT NULL AS notifications_exist,
  to_regclass('private.intrigue_support_notification_reads') IS NOT NULL AS read_receipts_exist,
  EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables WHERE relation_name='public.intrigue_support_notifications') AS erasure_registry_updated,
  NOT has_table_privilege('authenticated','public.intrigue_support_notifications','SELECT') AS notices_private,
  NOT has_function_privilege('authenticated','public.intrigue_support_notifications_list(uuid,boolean,uuid,integer)','EXECUTE') AS list_rpc_private,
  NOT has_function_privilege('authenticated','public.intrigue_support_notification_mark_read(uuid,uuid,boolean,uuid)','EXECUTE') AS mark_read_rpc_private;
