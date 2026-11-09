-- INTRIGUE V21: owner-initiated company data erasure.
-- The only destructive operation is intrigue_v21_erase_company, which requires
-- a previously staged case, the exact owner identity and an exact confirmation.
-- NEVER execute that RPC against a real company while testing.
-- Take a verified database backup before applying this ADDITIVE migration.
BEGIN;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS intrigue_erasure_state text NOT NULL DEFAULT 'active';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.workspaces'::regclass AND conname='intrigue_v21_workspace_state_check') THEN
  ALTER TABLE public.workspaces ADD CONSTRAINT intrigue_v21_workspace_state_check
    CHECK (intrigue_erasure_state IN ('active','closing'));
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS private.intrigue_v21_legal_holds (
 tenant_uuid uuid PRIMARY KEY,
 legal_basis text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS private.intrigue_v21_erasure_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_uuid uuid,
 actor_uuid uuid,
 company_label text,
 state text NOT NULL CHECK (state IN ('staged','cancelled','db_erased')),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 deleted_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
 completion_notes text
);
CREATE UNIQUE INDEX IF NOT EXISTS intrigue_v21_open_case_unique
 ON private.intrigue_v21_erasure_cases(tenant_uuid) WHERE state='staged';
ALTER TABLE private.intrigue_v21_erasure_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.intrigue_v21_legal_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_v21_erasure_cases, private.intrigue_v21_legal_holds FROM PUBLIC,anon,authenticated;

-- Guard ordinary writes to *all* current workspace-scoped tables after an owner
-- stages closure. Uses a row lock to serialize with the state transition.
CREATE OR REPLACE FUNCTION public.intrigue_v21_guard_closing_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_tenant uuid; v_state text;
BEGIN
 v_tenant := NEW.workspace_id;
 IF current_user IN ('postgres','supabase_admin') AND
    current_setting('intrigue.v21_erasing_workspace',true)=v_tenant::text THEN
    RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.workspace_id IS NOT NULL AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
   IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND intrigue_erasure_state='closing') THEN
     RAISE EXCEPTION 'Cannot move records out of a closing company' USING ERRCODE='55000';
   END IF;
 END IF;
 IF v_tenant IS NULL THEN RETURN NEW; END IF;
 SELECT intrigue_erasure_state INTO v_state FROM public.workspaces WHERE id=v_tenant FOR SHARE;
 IF v_state='closing' THEN
   RAISE EXCEPTION 'Company closure is in progress. New writes are blocked.' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_guard_closing_workspace() FROM PUBLIC,anon,authenticated;

-- Prevent ordinary signed-in users from flipping a closing company's state back.
CREATE OR REPLACE FUNCTION public.intrigue_v21_protect_workspace_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF NEW.intrigue_erasure_state IS DISTINCT FROM OLD.intrigue_erasure_state
    AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN
   RAISE EXCEPTION 'Only the secured company lifecycle may change deletion state' USING ERRCODE='42501';
 END IF;
 IF OLD.intrigue_erasure_state='closing' AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN
   RAISE EXCEPTION 'Company is closing; workspace changes are blocked' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_protect_workspace_state() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS intrigue_v21_protect_workspace_state ON public.workspaces;
CREATE TRIGGER intrigue_v21_protect_workspace_state BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_protect_workspace_state();


-- Installation pins a known schema. New workspace-scoped tables require a review
-- before erasure: the erase function refuses unknown tables or missing targets.
CREATE TABLE IF NOT EXISTS private.intrigue_v21_supported_tables (
 relation_name text PRIMARY KEY
);
ALTER TABLE private.intrigue_v21_supported_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_v21_supported_tables FROM PUBLIC,anon,authenticated;
INSERT INTO private.intrigue_v21_supported_tables(relation_name) VALUES
  ('private.intrigue_calendar_connections'),
  ('private.intrigue_crm_contact_references'),
  ('private.intrigue_dm_audit'),
  ('private.intrigue_dm_backups'),
  ('private.intrigue_google_booking_attempts'),
  ('private.intrigue_google_connections'),
  ('private.intrigue_membership_events'),
  ('private.intrigue_pilot_review_events'),
  ('private.intrigue_proposal_ai_usage'),
  ('private.intrigue_vapi_connections'),
  ('private.intrigue_voice_booking_attempts'),
  ('public.action_audit_logs'),
  ('public.action_proposal_edit_logs'),
  ('public.action_proposals'),
  ('public.automation_job_events'),
  ('public.automation_jobs'),
  ('public.customers'),
  ('public.enquiries'),
  ('public.follow_ups'),
  ('public.intrigue_crm_connections'),
  ('public.intrigue_crm_oauth_states'),
  ('public.intrigue_email_preferences'),
  ('public.intrigue_gmail_connections'),
  ('public.intrigue_gmail_oauth_states'),
  ('public.intrigue_google_booking_settings'),
  ('public.intrigue_imported_orders'),
  ('public.intrigue_mail_deliveries'),
  ('public.intrigue_onboarding_batches'),
  ('public.intrigue_onboarding_progress'),
  ('public.intrigue_outlook_connections'),
  ('public.intrigue_outlook_deliveries'),
  ('public.intrigue_outlook_oauth_states'),
  ('public.intrigue_proposal_approval_events'),
  ('public.intrigue_proposal_approvals'),
  ('public.intrigue_proposal_documents'),
  ('public.intrigue_rc2_transfers'),
  ('public.intrigue_receptionist_calls'),
  ('public.intrigue_secure_team_invitations'),
  ('public.intrigue_v17_run_events'),
  ('public.intrigue_v17_runs'),
  ('public.intrigue_v17_workflows'),
  ('public.intrigue_v172_draft_links'),
  ('public.intrigue_v173_contact_import_audit'),
  ('public.intrigue_vapi_call_events'),
  ('public.intrigue_voice_booking_settings'),
  ('public.knowledge_document_chunks'),
  ('public.knowledge_documents'),
  ('public.knowledge_entries'),
  ('public.quotation_line_items'),
  ('public.quotations'),
  ('public.workspace_integration_preferences'),
  ('public.workspace_invitations'),
  ('public.workspace_memberships'),
  ('public.workspace_pilot_requests'),
  ('public.workspace_plan_interest'),
  ('public.workspace_services'),
  ('public.workspace_settings')
ON CONFLICT (relation_name) DO NOTHING;

DO $fn$
DECLARE v_table record;
BEGIN
 FOR v_table IN SELECT n.nspname,c.relname
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname IN ('public','private') AND c.relkind='r'
 AND NOT c.relispartition AND a.attname='workspace_id' AND a.atttypid='uuid'::regtype
 AND NOT a.attisdropped AND (n.nspname||'.'||c.relname) <> 'public.intrigue_rc2_requests'
 LOOP
  IF NOT EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables
       WHERE relation_name=v_table.nspname||'.'||v_table.relname) THEN
    RAISE EXCEPTION 'V21 schema mismatch: unsupported workspace table %.%',v_table.nspname,v_table.relname;
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS intrigue_v21_stop_closing_writes ON %I.%I',v_table.nspname,v_table.relname);
  EXECUTE format('CREATE TRIGGER intrigue_v21_stop_closing_writes BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.intrigue_v21_guard_closing_workspace()',v_table.nspname,v_table.relname);
 END LOOP;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.intrigue_v21_owner_preflight(p_actor uuid,p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_company text; v_record record; v_count bigint; v_tables jsonb:='{}'::jsonb;
 v_total bigint:=0; v_storage bigint; v_holds bigint; v_running bigint; v_state text; v_case uuid;
BEGIN
 SELECT name,intrigue_erasure_state INTO v_company,v_state
 FROM public.workspaces WHERE id=p_tenant AND owner_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner verification failed' USING ERRCODE='42501'; END IF;
 FOR v_record IN SELECT n.nspname,c.relname
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname IN ('public','private') AND c.relkind='r'
  AND a.attname='workspace_id' AND a.atttypid='uuid'::regtype AND NOT a.attisdropped
 LOOP
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE workspace_id=$1',v_record.nspname,v_record.relname)
    INTO v_count USING p_tenant;
  v_tables:=v_tables||jsonb_build_object(v_record.nspname||'.'||v_record.relname,v_count);
  v_total:=v_total+v_count;
 END LOOP;
 SELECT count(*) INTO v_storage FROM storage.objects o
 WHERE o.owner_id=p_actor::text;
 SELECT count(*) INTO v_holds FROM private.intrigue_v21_legal_holds h WHERE h.tenant_uuid=p_tenant;
 SELECT count(*) INTO v_running FROM public.intrigue_v17_runs r
 WHERE r.workspace_id=p_tenant AND r.status='running' AND r.leased_until>now();
 SELECT id INTO v_case FROM private.intrigue_v21_erasure_cases
  WHERE tenant_uuid=p_tenant AND actor_uuid=p_actor AND state='staged' ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('workspace_id',p_tenant,'company_name',v_company,'state',v_state,
   'tables',v_tables,'total_records',v_total,'storage_objects_owned_by_actor',v_storage,
   'legal_holds',v_holds,'in_flight_ai_jobs',v_running,
   'can_stage',v_holds=0 AND v_running=0 AND v_storage=0,'pending_case_id',v_case,
   'important','This counts local records. Provider-side copies and Supabase PITR backups have independent lifecycles.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_owner_preflight(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_owner_preflight(uuid,uuid) TO service_role;

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
 'public.intrigue_receptionist_calls','public.intrigue_vapi_call_events'
 ] LOOP
  IF to_regclass(v_rel) IS NULL THEN RAISE EXCEPTION 'Missing export table: %',v_rel; END IF;
  EXECUTE format('SELECT count(*) FROM %s WHERE workspace_id=$1',v_rel::regclass)
     INTO v_count USING p_tenant;
  IF v_count>2000 THEN RAISE EXCEPTION 'Export exceeds 2000 rows for %. Use a paginated export before closure.',v_rel; END IF;
  -- Never export access/refresh tokens, private connection data or embeddings.
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) - ''embedding'' - ''vector''),''[]''::jsonb) FROM %s t WHERE workspace_id=$1',v_rel::regclass)
     INTO v_rows USING p_tenant;
  v_data:=v_data||jsonb_build_object(v_rel,v_rows);
 END LOOP;
 RETURN jsonb_build_object('type','intrigue_company_business_export',
  'company',v_company,'exported_at',now(),'data',v_data,
  'scope','Business records in the listed tables. OAuth tokens, Auth identities, provider-held records, historical database backups and internal audit logs are excluded.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_export_company(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_export_company(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_v21_stage_company(p_actor uuid,p_tenant uuid,p_phrase text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_company text;v_state text;v_case uuid;v_running bigint;v_storage bigint;
BEGIN
 SELECT name,intrigue_erasure_state INTO v_company,v_state FROM public.workspaces
 WHERE id=p_tenant AND owner_id=p_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only the owner may close this company' USING ERRCODE='42501'; END IF;
 IF p_phrase IS DISTINCT FROM 'DELETE COMPANY '||v_company THEN
    RAISE EXCEPTION 'Exact confirmation required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM private.intrigue_v21_legal_holds WHERE tenant_uuid=p_tenant) THEN
    RAISE EXCEPTION 'A documented legal retention hold requires review before erasure' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_running FROM public.intrigue_v17_runs
 WHERE workspace_id=p_tenant AND status='running' AND leased_until>now();
 IF v_running>0 THEN RAISE EXCEPTION 'Active AI jobs must finish before closure' USING ERRCODE='55000'; END IF;
 SELECT count(*) INTO v_storage FROM storage.objects WHERE owner_id=p_actor::text;
 IF v_storage>0 THEN RAISE EXCEPTION 'Storage objects need explicit ownership mapping and removal before closure' USING ERRCODE='55000'; END IF;
 IF v_state='closing' THEN
  SELECT id INTO v_case FROM private.intrigue_v21_erasure_cases
   WHERE tenant_uuid=p_tenant AND actor_uuid=p_actor AND state='staged';
  IF v_case IS NULL THEN RAISE EXCEPTION 'Closing state requires investigation' USING ERRCODE='55000'; END IF;
  RETURN v_case;
 END IF;
 INSERT INTO private.intrigue_v21_erasure_cases(tenant_uuid,actor_uuid,company_label,state)
 VALUES(p_tenant,p_actor,v_company,'staged') RETURNING id INTO v_case;
 UPDATE public.workspaces SET intrigue_erasure_state='closing' WHERE id=p_tenant;
 RETURN v_case;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_stage_company(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_stage_company(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_v21_cancel_company(p_actor uuid,p_tenant uuid,p_case uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 PERFORM 1 FROM public.workspaces WHERE id=p_tenant AND owner_id=p_actor AND intrigue_erasure_state='closing' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only current owner may resume the workspace' USING ERRCODE='42501'; END IF;
 UPDATE private.intrigue_v21_erasure_cases SET state='cancelled',finished_at=now()
 WHERE id=p_case AND tenant_uuid=p_tenant AND actor_uuid=p_actor AND state='staged';
 IF NOT FOUND THEN RAISE EXCEPTION 'Active case mismatch' USING ERRCODE='42501'; END IF;
 UPDATE public.workspaces SET intrigue_erasure_state='active' WHERE id=p_tenant;
 RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_cancel_company(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_cancel_company(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.intrigue_v21_erase_company(
 p_actor uuid,p_tenant uuid,p_case uuid,p_phrase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_company text; v_count bigint; v_counts jsonb:='{}'::jsonb;
 v_rel record; v_rel_oid oid; v_fk record; v_join text; v_cross boolean;
 v_remaining int;v_found boolean; v_name text; v_total bigint:=0; v_pass int; v_pass_deleted bigint;
BEGIN
 -- All database erasure happens within this single RPC transaction.
 SELECT name INTO v_company FROM public.workspaces
 WHERE id=p_tenant AND owner_id=p_actor AND intrigue_erasure_state='closing' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner or staged workspace not verified' USING ERRCODE='42501'; END IF;
 IF p_phrase IS DISTINCT FROM 'DELETE COMPANY '||v_company THEN
   RAISE EXCEPTION 'Exact confirmation required' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM private.intrigue_v21_erasure_cases
  WHERE id=p_case AND tenant_uuid=p_tenant AND actor_uuid=p_actor AND state='staged' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staged case not verified' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM private.intrigue_v21_legal_holds WHERE tenant_uuid=p_tenant) THEN
  RAISE EXCEPTION 'Legal retention hold present' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.intrigue_v17_runs WHERE workspace_id=p_tenant
   AND status='running' AND leased_until>now()) THEN
  RAISE EXCEPTION 'AI worker still processing' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE owner_id=p_actor::text) THEN
  RAISE EXCEPTION 'Storage objects not mapped for safe erasure' USING ERRCODE='55000'; END IF;

 CREATE TEMP TABLE v21_erasure_targets (
   relation_oid oid PRIMARY KEY,relation_name text NOT NULL,done boolean NOT NULL DEFAULT false
 ) ON COMMIT DROP;
 INSERT INTO pg_temp.v21_erasure_targets(relation_oid,relation_name)
 SELECT c.oid,n.nspname||'.'||c.relname
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname IN ('public','private') AND c.relkind='r' AND NOT c.relispartition
 AND a.attname='workspace_id' AND a.atttypid='uuid'::regtype
 AND NOT a.attisdropped AND n.nspname||'.'||c.relname <> 'public.intrigue_rc2_requests';
 -- Strict pin: neither unexpected tables nor missing supported tables may be ignored.
 IF EXISTS(SELECT 1 FROM pg_temp.v21_erasure_targets t
    WHERE NOT EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables s WHERE s.relation_name=t.relation_name))
 OR EXISTS(SELECT 1 FROM private.intrigue_v21_supported_tables s
    WHERE NOT EXISTS(SELECT 1 FROM pg_temp.v21_erasure_targets t WHERE t.relation_name=s.relation_name)) THEN
  RAISE EXCEPTION 'Workspace schema changed since V21 review. No erasure performed.' USING ERRCODE='55000';
 END IF;

 -- Preflight cross-tenant foreign-key edges. A cascade from target parent to a
 -- different tenant must never destroy records outside the selected company.
 FOR v_fk IN
   SELECT c.conrelid AS child_oid,c.confrelid AS parent_oid,c.conkey,c.confkey,
     EXISTS(SELECT 1 FROM pg_temp.v21_erasure_targets t WHERE t.relation_oid=c.conrelid) AS child_scoped
   FROM pg_constraint c
   WHERE c.contype='f' AND EXISTS(SELECT 1 FROM pg_temp.v21_erasure_targets t WHERE t.relation_oid=c.confrelid)
 LOOP
  SELECT string_agg(format('child.%I = parent.%I',ca.attname,pa.attname),' AND ' ORDER BY x.ord)
  INTO v_join
  FROM unnest(v_fk.conkey,v_fk.confkey) WITH ORDINALITY AS x(child_no,parent_no,ord)
  JOIN pg_attribute ca ON ca.attrelid=v_fk.child_oid AND ca.attnum=x.child_no
  JOIN pg_attribute pa ON pa.attrelid=v_fk.parent_oid AND pa.attnum=x.parent_no;
  IF v_join IS NULL THEN RAISE EXCEPTION 'Uninspectable FK encountered'; END IF;
  IF v_fk.child_scoped THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s child JOIN %s parent ON %s WHERE parent.workspace_id=$1 AND child.workspace_id IS DISTINCT FROM $1)',
      v_fk.child_oid::regclass,v_fk.parent_oid::regclass,v_join)
   INTO v_cross USING p_tenant;
  ELSE
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s child JOIN %s parent ON %s WHERE parent.workspace_id=$1)',
      v_fk.child_oid::regclass,v_fk.parent_oid::regclass,v_join)
   INTO v_cross USING p_tenant;
  END IF;
  IF v_cross THEN
   RAISE EXCEPTION 'Foreign key would affect an unscoped or different company record. STOP.' USING ERRCODE='55000';
  END IF;
 END LOOP;

 -- Trusted internal cleanup may generate audit rows through existing membership
 -- triggers. Permit only this transaction's authenticated executor to write those
 -- rows so they can be removed in the same atomic operation.
 PERFORM set_config('intrigue.v21_erasing_workspace',p_tenant::text,true);
 -- Erase review notes connected to this company's older privacy requests.
 DELETE FROM public.intrigue_rc22_review_events WHERE request_id IN
   (SELECT id FROM public.intrigue_rc2_requests WHERE workspace_id=p_tenant);
 -- Keep minimal request receipts without customer data or the company identifier.
 UPDATE public.intrigue_rc2_requests SET workspace_id=NULL,workspace_label=NULL,
  requested_by=NULL,operator_note=NULL,
  public_message='Workspace closed; eligible active business records erased.',
  status='completed',completed_at=now(),status_updated_at=now()
 WHERE workspace_id=p_tenant;

 -- Delete each tenant-scoped child before its parents. Unknown FK cycles abort.
 LOOP
  SELECT count(*) INTO v_remaining FROM pg_temp.v21_erasure_targets WHERE NOT done;
  EXIT WHEN v_remaining=0;
  SELECT t.relation_oid,t.relation_name INTO v_rel_oid,v_name
  FROM pg_temp.v21_erasure_targets t
  WHERE NOT t.done AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_temp.v21_erasure_targets child ON child.relation_oid=c.conrelid AND NOT child.done
    WHERE c.contype='f' AND c.confrelid=t.relation_oid
      AND c.conrelid<>c.confrelid
  ) ORDER BY t.relation_name LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Circular FK dependency: erasure rolled back' USING ERRCODE='55000'; END IF;
  EXECUTE format('DELETE FROM %s WHERE workspace_id=$1',v_rel_oid::regclass) USING p_tenant;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  v_counts:=v_counts||jsonb_build_object(v_name,v_count);
  v_total:=v_total+v_count;
  UPDATE pg_temp.v21_erasure_targets SET done=true WHERE relation_oid=v_rel_oid;
 END LOOP;

 -- Audit triggers can insert new workspace-scoped records as their parents are
 -- removed. Sweep again, bounded, and demand zero residual rows.
 FOR v_pass IN 1..3 LOOP
  v_pass_deleted:=0;
  FOR v_rel IN SELECT relation_oid,relation_name FROM pg_temp.v21_erasure_targets ORDER BY relation_name LOOP
   EXECUTE format('DELETE FROM %s WHERE workspace_id=$1',v_rel.relation_oid::regclass)
    USING p_tenant;
   GET DIAGNOSTICS v_count=ROW_COUNT;
   IF v_count>0 THEN
    v_counts:=jsonb_set(v_counts,ARRAY[v_rel.relation_name],
        to_jsonb(coalesce((v_counts->>v_rel.relation_name)::bigint,0)+v_count),true);
    v_total:=v_total+v_count;
    v_pass_deleted:=v_pass_deleted+v_count;
   END IF;
  END LOOP;
  EXIT WHEN v_pass_deleted=0;
 END LOOP;
 FOR v_rel IN SELECT relation_oid,relation_name FROM pg_temp.v21_erasure_targets LOOP
  EXECUTE format('SELECT count(*) FROM %s WHERE workspace_id=$1',v_rel.relation_oid::regclass)
   INTO v_count USING p_tenant;
  IF v_count<>0 THEN RAISE EXCEPTION 'Residual workspace records in %. Rollback.',v_rel.relation_name; END IF;
 END LOOP;
 DELETE FROM public.workspaces WHERE id=p_tenant AND owner_id=p_actor AND intrigue_erasure_state='closing';
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace deletion failed' USING ERRCODE='55000'; END IF;
 UPDATE private.intrigue_v21_erasure_cases SET state='db_erased',finished_at=now(),
   tenant_uuid=NULL,actor_uuid=NULL,company_label=NULL,
   deleted_counts=v_counts,
   completion_notes='Live workspace database records erased. Supabase backups and remote providers are separately managed.'
 WHERE id=p_case;
 RETURN jsonb_build_object('database_erased',true,'case_id',p_case,
   'deleted_rows',v_total,'by_table',v_counts,
   'backup_provider_notice','Historical PITR backups and provider-held copies are not erased by this RPC.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.intrigue_v21_erase_company(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v21_erase_company(uuid,uuid,uuid,text) TO service_role;

COMMIT;
NOTIFY pgrst,'reload schema';

-- RUN THIS READ-ONLY VERIFICATION. All function/permission checks should be TRUE.
SELECT
 to_regprocedure('public.intrigue_v21_owner_preflight(uuid,uuid)') IS NOT NULL AS preview_exists,
 to_regprocedure('public.intrigue_v21_export_company(uuid,uuid)') IS NOT NULL AS export_exists,
 to_regprocedure('public.intrigue_v21_stage_company(uuid,uuid,text)') IS NOT NULL AS stage_exists,
 to_regprocedure('public.intrigue_v21_erase_company(uuid,uuid,uuid,text)') IS NOT NULL AS real_erase_exists,
 NOT has_function_privilege('authenticated','public.intrigue_v21_erase_company(uuid,uuid,uuid,text)','EXECUTE') AS employees_cannot_erase,
 has_function_privilege('service_role','public.intrigue_v21_erase_company(uuid,uuid,uuid,text)','EXECUTE') AS server_can_erase,
 (SELECT relrowsecurity FROM pg_class WHERE oid='private.intrigue_v21_erasure_cases'::regclass) AS receipts_protected;
