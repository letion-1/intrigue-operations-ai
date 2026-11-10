-- INTRIGUE PLATFORM: private platform console, workspace freeze and Help Center.
-- Additive: does not erase customer records, accounts, or existing erasure receipts.
-- Requires the existing company-erasure registry. Run only after verifying a database backup.
BEGIN;

DO $$ BEGIN
 IF to_regclass('private.intrigue_v21_supported_tables') IS NULL THEN
   RAISE EXCEPTION 'V21 erasure registry missing. Apply V21 before applying this migration.';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.intrigue_platform_operators (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 active boolean NOT NULL DEFAULT true,
 granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.intrigue_platform_operators ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_platform_operators FROM PUBLIC, anon, authenticated;
-- Seed by a verified existing Supabase Auth email. No UUID configuration needed.
INSERT INTO private.intrigue_platform_operators(user_id)
 SELECT id FROM auth.users WHERE lower(email)='intriguearts1@gmail.com' AND email_confirmed_at IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.intrigue_platform_operators WHERE active) THEN
   RAISE EXCEPTION 'Verified platform operator email intriguearts1@gmail.com not found in auth.users; no platform access provisioned';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.intrigue_platform_workspace_controls (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 frozen boolean NOT NULL DEFAULT false,
 reason text NOT NULL DEFAULT '',
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.intrigue_platform_workspace_controls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_platform_workspace_controls FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.intrigue_platform_operator_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 workspace_ref uuid,
 kind text NOT NULL CHECK (kind IN ('freeze','unfreeze','ticket_status','ticket_reply')),
 detail text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.intrigue_platform_operator_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_platform_operator_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS intrigue_platform_operator_events_recent ON private.intrigue_platform_operator_events(created_at DESC);

CREATE TABLE IF NOT EXISTS public.intrigue_platform_support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 subject text NOT NULL CHECK (char_length(subject) BETWEEN 5 AND 160),
 category text NOT NULL CHECK (category IN ('general','technical','integration','billing','privacy')),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_client','resolved','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,workspace_id)
);
CREATE INDEX IF NOT EXISTS intrigue_platform_ticket_ws_time ON public.intrigue_platform_support_tickets(workspace_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS public.intrigue_platform_support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 speaker text NOT NULL CHECK (speaker IN ('client','operator')),
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(ticket_id,workspace_id) REFERENCES public.intrigue_platform_support_tickets(id,workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS intrigue_platform_msg_ticket_time ON public.intrigue_platform_support_messages(ticket_id,created_at);
ALTER TABLE public.intrigue_platform_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intrigue_platform_support_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_platform_support_tickets,public.intrigue_platform_support_messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_platform_support_tickets,public.intrigue_platform_support_messages TO service_role;

-- Keep the existing erasure schema registry in sync so client erasure remains possible.
INSERT INTO private.intrigue_v21_supported_tables(relation_name) VALUES
 ('private.intrigue_platform_workspace_controls'),
 ('public.intrigue_platform_support_tickets'),
 ('public.intrigue_platform_support_messages')
ON CONFLICT(relation_name) DO NOTHING;
-- Apply existing closing-workspace guard to new company tables.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['private.intrigue_platform_workspace_controls',
  'public.intrigue_platform_support_tickets','public.intrigue_platform_support_messages'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON %s',t::regclass);
  EXECUTE format('CREATE TRIGGER intrigue_v21_stop_closing_writes BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace()',t::regclass);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.intrigue_platform_is_operator(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM private.intrigue_platform_operators WHERE user_id=p_actor AND active)
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_is_operator(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_is_operator(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_is_frozen(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT COALESCE((SELECT frozen FROM private.intrigue_platform_workspace_controls WHERE workspace_id=p_tenant),false)
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_is_frozen(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_is_frozen(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_workspace_open(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_tenant AND intrigue_erasure_state='active')
    AND NOT public.intrigue_platform_is_frozen(p_tenant)
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_workspace_open(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_workspace_open(uuid) TO authenticated,service_role;

-- Restrict direct client access where a permissive RLS policy already grants
-- access. A RESTRICTIVE policy cannot grant access on its own.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT n.nspname,c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=c.oid
  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
   AND a.attname='workspace_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped
   AND c.relname NOT IN ('intrigue_platform_support_tickets','intrigue_platform_support_messages')
 LOOP
  EXECUTE format('DROP POLICY IF EXISTS intrigue_platform_frozen_restrict ON %I.%I',t.nspname,t.relname);
  EXECUTE format('CREATE POLICY intrigue_platform_frozen_restrict ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.intrigue_platform_workspace_open(workspace_id)) WITH CHECK (public.intrigue_platform_workspace_open(workspace_id))',t.nspname,t.relname);
 END LOOP;
END $$;

-- These are the proven server-side processing/write entry tables.
-- service_role bypasses RLS, so block new business writes with triggers too.
CREATE OR REPLACE FUNCTION public.intrigue_platform_guard_frozen_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE tenant uuid;
BEGIN
 tenant:=NEW.workspace_id;
 IF tenant IS NOT NULL AND public.intrigue_platform_is_frozen(tenant) THEN
   RAISE EXCEPTION 'Workspace suspended by platform operator; business writes paused' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_guard_frozen_write() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY[
 'public.intrigue_v17_runs','public.automation_jobs','public.customers',
 'public.enquiries','public.quotations','public.follow_ups',
 'public.intrigue_mail_deliveries','public.intrigue_outlook_deliveries',
 'public.intrigue_vapi_call_events'] LOOP
  IF to_regclass(t) IS NOT NULL THEN
   EXECUTE format('DROP TRIGGER IF EXISTS intrigue_platform_pause_business_write ON %s',t::regclass);
   EXECUTE format('CREATE TRIGGER intrigue_platform_pause_business_write BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION public.intrigue_platform_guard_frozen_write()',t::regclass);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.intrigue_platform_set_freeze(p_actor uuid,p_tenant uuid,p_frozen boolean,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE running integer;
BEGIN
 IF NOT public.intrigue_platform_is_operator(p_actor) THEN RAISE EXCEPTION 'Platform authorization required' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(trim(p_reason))<8 OR length(p_reason)>500 THEN RAISE EXCEPTION 'Reason must have 8-500 characters' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_tenant AND intrigue_erasure_state='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company not found or closing' USING ERRCODE='55000'; END IF;
 IF p_frozen THEN
  SELECT count(*) INTO running FROM public.intrigue_v17_runs
    WHERE workspace_id=p_tenant AND status='running' AND leased_until>now();
  IF running>0 THEN RAISE EXCEPTION 'Wait for in-flight AI jobs to finish before freezing' USING ERRCODE='55000'; END IF;
 END IF;
 INSERT INTO private.intrigue_platform_workspace_controls(workspace_id,frozen,reason,updated_by,updated_at)
 VALUES(p_tenant,p_frozen,trim(p_reason),p_actor,now())
 ON CONFLICT(workspace_id) DO UPDATE SET frozen=EXCLUDED.frozen,reason=EXCLUDED.reason,
 updated_by=EXCLUDED.updated_by,updated_at=now();
 INSERT INTO private.intrigue_platform_operator_events(actor_id,workspace_ref,kind,detail)
 VALUES(p_actor,p_tenant,CASE WHEN p_frozen THEN 'freeze' ELSE 'unfreeze' END,trim(p_reason));
 RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_set_freeze(uuid,uuid,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_set_freeze(uuid,uuid,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_operator_dashboard(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE out jsonb;
BEGIN
 IF NOT public.intrigue_platform_is_operator(p_actor) THEN RAISE EXCEPTION 'Platform authorization required' USING ERRCODE='42501'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC),'[]'::jsonb) INTO out
 FROM (SELECT w.id,w.name,w.created_at,w.intrigue_erasure_state,
 COALESCE(c.frozen,false) AS frozen,c.updated_at AS freeze_updated_at,
 (SELECT count(*) FROM public.customers z WHERE z.workspace_id=w.id) AS customers,
 (SELECT count(*) FROM public.enquiries z WHERE z.workspace_id=w.id) AS enquiries,
 (SELECT count(*) FROM public.quotations z WHERE z.workspace_id=w.id) AS quotations,
 (SELECT count(*) FROM public.intrigue_platform_support_tickets z WHERE z.workspace_id=w.id AND z.status NOT IN ('resolved','closed')) AS open_tickets
 FROM public.workspaces w LEFT JOIN private.intrigue_platform_workspace_controls c ON c.workspace_id=w.id) x;
 RETURN out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_operator_dashboard(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_operator_dashboard(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_member(p_actor uuid,p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.workspace_memberships m WHERE m.user_id=p_actor AND m.workspace_id=p_tenant)
 OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.owner_id=p_actor AND w.id=p_tenant)
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_member(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_member(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_new_ticket(p_actor uuid,p_tenant uuid,p_subject text,p_category text,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE tid uuid;
BEGIN
 IF NOT public.intrigue_platform_member(p_actor,p_tenant) THEN RAISE EXCEPTION 'Workspace membership required' USING ERRCODE='42501'; END IF;
 IF p_subject IS NULL OR length(trim(p_subject)) NOT BETWEEN 5 AND 160 OR
 p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 4000 OR
 p_category NOT IN ('general','technical','integration','billing','privacy') THEN
 RAISE EXCEPTION 'Invalid ticket input' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.intrigue_platform_support_tickets
     WHERE created_by=p_actor AND created_at > now() - interval '1 day') >= 15 THEN
   RAISE EXCEPTION 'Daily support ticket limit reached' USING ERRCODE='54000';
 END IF;
 INSERT INTO public.intrigue_platform_support_tickets(workspace_id,created_by,subject,category)
 VALUES(p_tenant,p_actor,trim(p_subject),p_category) RETURNING id INTO tid;
 INSERT INTO public.intrigue_platform_support_messages(ticket_id,workspace_id,actor_id,speaker,body)
 VALUES(tid,p_tenant,p_actor,'client',trim(p_body));
 RETURN tid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_new_ticket(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_new_ticket(uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_can_view_ticket(p_actor uuid,p_ticket uuid,p_operator boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(
 SELECT 1 FROM public.intrigue_platform_support_tickets t
 WHERE t.id=p_ticket AND (
  (p_operator AND public.intrigue_platform_is_operator(p_actor)) OR
  (NOT p_operator AND public.intrigue_platform_member(p_actor,t.workspace_id) AND
   (t.created_by=p_actor OR EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=t.workspace_id AND w.owner_id=p_actor)))
 ));
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_can_view_ticket(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_can_view_ticket(uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_list_tickets(p_actor uuid,p_tenant uuid DEFAULT NULL,p_operator boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE out jsonb;
BEGIN
 IF p_operator AND NOT public.intrigue_platform_is_operator(p_actor) THEN RAISE EXCEPTION 'Operator required' USING ERRCODE='42501'; END IF;
 IF NOT p_operator AND (p_tenant IS NULL OR NOT public.intrigue_platform_member(p_actor,p_tenant)) THEN
 RAISE EXCEPTION 'Workspace membership required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(z) ORDER BY z.updated_at DESC),'[]'::jsonb) INTO out
 FROM (SELECT t.id,t.workspace_id,t.subject,t.category,t.status,t.created_at,t.updated_at,
 w.name AS workspace_name,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'speaker',m.speaker,'body',m.body,'created_at',m.created_at)
 ORDER BY m.created_at),'[]'::jsonb) FROM public.intrigue_platform_support_messages m WHERE m.ticket_id=t.id) AS messages
 FROM public.intrigue_platform_support_tickets t JOIN public.workspaces w ON w.id=t.workspace_id
 WHERE (p_operator OR (t.workspace_id=p_tenant AND (t.created_by=p_actor OR w.owner_id=p_actor)))
 ORDER BY t.updated_at DESC LIMIT 100) z;
 RETURN out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_list_tickets(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_list_tickets(uuid,uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_reply_ticket(p_actor uuid,p_ticket uuid,p_body text,p_operator boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE t record;
BEGIN
 IF NOT public.intrigue_platform_can_view_ticket(p_actor,p_ticket,p_operator) THEN RAISE EXCEPTION 'Ticket access refused' USING ERRCODE='42501'; END IF;
 IF p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Invalid message length' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.intrigue_platform_support_messages
     WHERE actor_id=p_actor AND created_at>now()-interval '1 hour') >= 45 THEN
   RAISE EXCEPTION 'Support reply limit reached' USING ERRCODE='54000';
 END IF;
 SELECT id,workspace_id,status INTO t FROM public.intrigue_platform_support_tickets WHERE id=p_ticket FOR UPDATE;
 IF t.status='closed' THEN RAISE EXCEPTION 'Ticket is closed' USING ERRCODE='55000'; END IF;
 INSERT INTO public.intrigue_platform_support_messages(ticket_id,workspace_id,actor_id,speaker,body)
 VALUES(t.id,t.workspace_id,p_actor,CASE WHEN p_operator THEN 'operator' ELSE 'client' END,trim(p_body));
 UPDATE public.intrigue_platform_support_tickets SET updated_at=now(),
 status=CASE WHEN p_operator THEN 'waiting_client' ELSE 'open' END WHERE id=t.id;
 IF p_operator THEN INSERT INTO private.intrigue_platform_operator_events(actor_id,workspace_ref,kind)
  VALUES(p_actor,t.workspace_id,'ticket_reply'); END IF;
 RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_reply_ticket(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_reply_ticket(uuid,uuid,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_platform_ticket_status(p_actor uuid,p_ticket uuid,p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE tenant uuid;
BEGIN
 IF NOT public.intrigue_platform_is_operator(p_actor) THEN RAISE EXCEPTION 'Operator required' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN ('open','in_progress','waiting_client','resolved','closed') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='22023'; END IF;
 UPDATE public.intrigue_platform_support_tickets SET status=p_status,updated_at=now()
 WHERE id=p_ticket RETURNING workspace_id INTO tenant;
 IF tenant IS NULL THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO private.intrigue_platform_operator_events(actor_id,workspace_ref,kind,detail)
 VALUES(p_actor,tenant,'ticket_status',p_status);
 RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_platform_ticket_status(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_ticket_status(uuid,uuid,text) TO service_role;

-- Extend the existing owner export to include Help Center records.
CREATE OR REPLACE FUNCTION public.intrigue_v21_export_company(p_actor uuid,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_company text; v_rel text; v_count bigint; v_data jsonb:='{}'::jsonb; v_rows jsonb;
BEGIN
 SELECT name INTO v_company FROM public.workspaces WHERE id=p_tenant AND owner_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only company owner may export' USING ERRCODE='42501'; END IF;
 FOREACH v_rel IN ARRAY ARRAY[
 'public.customers','public.enquiries','public.follow_ups','public.quotations',
 'public.quotation_line_items','public.workspace_services','public.knowledge_entries',
 'public.knowledge_documents','public.knowledge_document_chunks','public.intrigue_imported_orders',
 'public.action_proposals','public.automation_jobs','public.automation_job_events',
 'public.intrigue_proposal_documents','public.intrigue_proposal_approvals',
 'public.intrigue_receptionist_calls','public.intrigue_vapi_call_events',
 'public.intrigue_platform_support_tickets','public.intrigue_platform_support_messages'
 ] LOOP
  IF to_regclass(v_rel) IS NULL THEN RAISE EXCEPTION 'Missing export table: %',v_rel; END IF;
  EXECUTE format('SELECT count(*) FROM %s WHERE workspace_id=$1',v_rel::regclass)
    INTO v_count USING p_tenant;
  IF v_count>2000 THEN RAISE EXCEPTION 'Export exceeds 2000 rows for %. Use paginated export before closure.',v_rel; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) - ''embedding'' - ''vector''),''[]''::jsonb) FROM %s t WHERE workspace_id=$1',v_rel::regclass)
    INTO v_rows USING p_tenant;
  v_data:=v_data||jsonb_build_object(v_rel,v_rows);
 END LOOP;
 RETURN jsonb_build_object('type','intrigue_company_business_export','company',v_company,
  'exported_at',now(),'data',v_data,
  'scope','Listed business and support records only; Auth identities, tokens, provider data, historical backups and other internal metadata excluded.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_export_company(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_export_company(uuid,uuid) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;

-- READ-ONLY postmigration checks: all 9 should be TRUE.
SELECT
 to_regclass('private.intrigue_platform_operators') IS NOT NULL AS operator_table_exists,
 EXISTS(SELECT 1 FROM private.intrigue_platform_operators WHERE active) AS operator_seeded,
 to_regclass('private.intrigue_platform_workspace_controls') IS NOT NULL AS freeze_table_exists,
 to_regclass('public.intrigue_platform_support_tickets') IS NOT NULL AS help_tickets_exists,
 to_regclass('public.intrigue_platform_support_messages') IS NOT NULL AS help_messages_exists,
 (SELECT count(*)=3 FROM private.intrigue_v21_supported_tables WHERE relation_name IN (
  'private.intrigue_platform_workspace_controls','public.intrigue_platform_support_tickets','public.intrigue_platform_support_messages')) AS erasure_registry_updated,
 NOT has_function_privilege('authenticated','public.intrigue_platform_set_freeze(uuid,uuid,boolean,text)','EXECUTE') AS freeze_restricted,
 NOT has_table_privilege('authenticated','public.intrigue_platform_support_tickets','SELECT') AS tickets_directly_private,
 has_function_privilege('service_role','public.intrigue_platform_operator_dashboard(uuid)','EXECUTE') AS backend_dashboard_enabled;
