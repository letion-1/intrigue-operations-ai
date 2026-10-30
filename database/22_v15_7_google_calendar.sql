-- INTRIGUE V15.7: direct Google Calendar booking; remains OFF by default.
-- Install after V15.5/V15.6. No changes to Calendly or CRM data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.intrigue_google_connections (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  encrypted_tokens text NOT NULL CHECK (char_length(encrypted_tokens) BETWEEN 24 AND 16000),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.intrigue_google_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_google_connections FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.intrigue_google_booking_settings (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 time_zone text NOT NULL DEFAULT 'Europe/Berlin' CHECK (length(time_zone) BETWEEN 3 AND 80),
 duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes IN (30,60)),
 start_hour integer NOT NULL DEFAULT 9 CHECK (start_hour BETWEEN 0 AND 22),
 end_hour integer NOT NULL DEFAULT 17 CHECK (end_hour BETWEEN 1 AND 23),
 booking_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_hour>start_hour)
);
ALTER TABLE public.intrigue_google_booking_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_google_booking_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.intrigue_google_booking_settings TO authenticated;
DROP POLICY IF EXISTS intrigue_v157_google_select ON public.intrigue_google_booking_settings;
CREATE POLICY intrigue_v157_google_select ON public.intrigue_google_booking_settings FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS intrigue_v157_google_insert ON public.intrigue_google_booking_settings;
CREATE POLICY intrigue_v157_google_insert ON public.intrigue_google_booking_settings FOR INSERT TO authenticated
 WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS intrigue_v157_google_update ON public.intrigue_google_booking_settings;
CREATE POLICY intrigue_v157_google_update ON public.intrigue_google_booking_settings FOR UPDATE TO authenticated
 USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=(SELECT auth.uid())))
 WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id=workspace_id AND w.owner_id=(SELECT auth.uid())));

CREATE TABLE IF NOT EXISTS private.intrigue_google_booking_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 call_id text NOT NULL CHECK(length(call_id) BETWEEN 8 AND 128),
 tool_call_id text NOT NULL CHECK(length(tool_call_id) BETWEEN 6 AND 128),
 start_time timestamptz NOT NULL,
 email_digest text NOT NULL CHECK(email_digest ~ '^[a-f0-9]{64}$'),
 event_id text NOT NULL UNIQUE CHECK(event_id ~ '^intrg[a-f0-9]{32}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','confirmed','failed','uncertain')),
 event_link text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,call_id,tool_call_id),
 UNIQUE(workspace_id,start_time)
);
CREATE INDEX IF NOT EXISTS intrigue_google_attempts_workspace_time
 ON private.intrigue_google_booking_attempts(workspace_id,created_at DESC);
ALTER TABLE private.intrigue_google_booking_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_google_booking_attempts FROM PUBLIC, anon, authenticated;

-- Owner-only encrypted token storage. Never plaintext.
CREATE OR REPLACE FUNCTION public.intrigue_v157_google_owner_connection(
 p_workspace_id uuid,p_action text,p_blob text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v private.intrigue_google_connections%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace_id AND w.owner_id=auth.uid())
 THEN RAISE EXCEPTION 'Company owner required'; END IF;
 IF p_action='store' THEN
   IF p_blob IS NULL OR length(p_blob) NOT BETWEEN 24 AND 16000 THEN RAISE EXCEPTION 'Invalid encrypted credential'; END IF;
   INSERT INTO private.intrigue_google_connections(workspace_id,encrypted_tokens) VALUES(p_workspace_id,p_blob)
   ON CONFLICT(workspace_id) DO UPDATE SET encrypted_tokens=EXCLUDED.encrypted_tokens,updated_at=now();
   RETURN jsonb_build_object('connected',true);
 ELSIF p_action='delete' THEN
   DELETE FROM private.intrigue_google_connections WHERE workspace_id=p_workspace_id;
   UPDATE public.intrigue_google_booking_settings SET booking_enabled=false WHERE workspace_id=p_workspace_id;
   RETURN jsonb_build_object('connected',false);
 ELSIF p_action='get' THEN
   SELECT * INTO v FROM private.intrigue_google_connections WHERE workspace_id=p_workspace_id;
   IF NOT FOUND THEN RETURN jsonb_build_object('connected',false); END IF;
   RETURN jsonb_build_object('connected',true,'encrypted_tokens',v.encrypted_tokens);
 END IF;
 RAISE EXCEPTION 'Invalid connection operation';
END;$$;
REVOKE ALL ON FUNCTION public.intrigue_v157_google_owner_connection(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v157_google_owner_connection(uuid,text,text) TO authenticated;

-- Vapi token validated before any access to per-company Google encryption blobs.
CREATE OR REPLACE FUNCTION public.intrigue_v157_google_context(p_token text,p_assistant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_workspace uuid; v_blob text; v_settings public.intrigue_google_booking_settings%ROWTYPE;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL THEN RETURN jsonb_build_object('authorized',false); END IF;
 SELECT workspace_id INTO v_workspace FROM private.intrigue_vapi_connections
   WHERE assistant_id=p_assistant_id AND token_hash=md5(p_token);
 IF v_workspace IS NULL THEN RETURN jsonb_build_object('authorized',false); END IF;
 SELECT encrypted_tokens INTO v_blob FROM private.intrigue_google_connections WHERE workspace_id=v_workspace;
 SELECT * INTO v_settings FROM public.intrigue_google_booking_settings WHERE workspace_id=v_workspace;
 RETURN jsonb_build_object('authorized',true,'workspace_id',v_workspace,'connected',v_blob IS NOT NULL,
  'encrypted_tokens',v_blob,'enabled',COALESCE(v_settings.booking_enabled,false),
  'time_zone',COALESCE(v_settings.time_zone,'Europe/Berlin'),
  'duration_minutes',COALESCE(v_settings.duration_minutes,30),
  'start_hour',COALESCE(v_settings.start_hour,9),'end_hour',COALESCE(v_settings.end_hour,17));
END;$$;
REVOKE ALL ON FUNCTION public.intrigue_v157_google_context(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v157_google_context(text,uuid) TO anon;

CREATE OR REPLACE FUNCTION public.intrigue_v157_google_refresh(p_token text,p_assistant_id uuid,p_expected text,p_next text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_workspace uuid;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL OR
 p_next IS NULL OR length(p_next) NOT BETWEEN 24 AND 16000 THEN RETURN false; END IF;
 SELECT workspace_id INTO v_workspace FROM private.intrigue_vapi_connections
 WHERE assistant_id=p_assistant_id AND token_hash=md5(p_token);
 IF v_workspace IS NULL THEN RETURN false; END IF;
 UPDATE private.intrigue_google_connections SET encrypted_tokens=p_next,updated_at=now()
 WHERE workspace_id=v_workspace AND encrypted_tokens=p_expected;
 RETURN FOUND;
END;$$;
REVOKE ALL ON FUNCTION public.intrigue_v157_google_refresh(text,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v157_google_refresh(text,uuid,text,text) TO anon;

CREATE OR REPLACE FUNCTION public.intrigue_v157_google_claim(
 p_token text,p_assistant_id uuid,p_call_id text,p_tool_call_id text,p_start_time timestamptz,p_email_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_workspace uuid; v_id uuid; v_existing private.intrigue_google_booking_attempts%ROWTYPE; v_event_id text;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL OR
 p_call_id IS NULL OR length(p_call_id) NOT BETWEEN 8 AND 128 OR
 p_tool_call_id IS NULL OR length(p_tool_call_id) NOT BETWEEN 6 AND 128 OR
 p_start_time <= now()+interval '1 minute' OR p_start_time > now()+interval '31 days' OR
 p_email_digest IS NULL OR p_email_digest !~ '^[a-f0-9]{64}$'
 THEN RETURN jsonb_build_object('claimed',false,'reason','Invalid booking attempt'); END IF;
 SELECT c.workspace_id INTO v_workspace FROM private.intrigue_vapi_connections c
 JOIN private.intrigue_google_connections g ON g.workspace_id=c.workspace_id
 JOIN public.intrigue_google_booking_settings s ON s.workspace_id=c.workspace_id AND s.booking_enabled=true
 WHERE c.assistant_id=p_assistant_id AND c.token_hash=md5(p_token);
 IF v_workspace IS NULL THEN RETURN jsonb_build_object('claimed',false,'reason','Google booking not enabled'); END IF;
 v_id=gen_random_uuid();
 v_event_id='intrg'||replace(v_id::text,'-','');
 INSERT INTO private.intrigue_google_booking_attempts(id,workspace_id,call_id,tool_call_id,start_time,email_digest,event_id)
 VALUES(v_id,v_workspace,p_call_id,p_tool_call_id,p_start_time,p_email_digest,v_event_id)
 ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN jsonb_build_object('claimed',true,'attempt_id',v_id,'event_id',v_event_id); END IF;
 SELECT * INTO v_existing FROM private.intrigue_google_booking_attempts
 WHERE workspace_id=v_workspace AND (start_time=p_start_time OR (call_id=p_call_id AND tool_call_id=p_tool_call_id))
 ORDER BY created_at LIMIT 1;
 RETURN jsonb_build_object('claimed',false,'reason','This slot has already been attempted. Ask owner to verify before retrying.',
   'status',COALESCE(v_existing.status,'unknown'),'event_id',v_existing.event_id);
END;$$;
REVOKE ALL ON FUNCTION public.intrigue_v157_google_claim(text,uuid,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v157_google_claim(text,uuid,text,text,timestamptz,text) TO anon;

CREATE OR REPLACE FUNCTION public.intrigue_v157_google_complete(
 p_token text,p_assistant_id uuid,p_attempt_id uuid,p_status text,p_event_link text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_workspace uuid;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL OR
 p_status NOT IN ('confirmed','failed','uncertain') THEN RETURN false; END IF;
 SELECT workspace_id INTO v_workspace FROM private.intrigue_vapi_connections
 WHERE assistant_id=p_assistant_id AND token_hash=md5(p_token);
 IF v_workspace IS NULL THEN RETURN false; END IF;
 IF p_event_link IS NOT NULL AND p_event_link !~ '^https://(calendar\.google\.com/|www\.google\.com/calendar/)' THEN RETURN false; END IF;
 UPDATE private.intrigue_google_booking_attempts
 SET status=p_status,event_link=CASE WHEN p_status='confirmed' THEN left(p_event_link,1500) ELSE NULL END,updated_at=now()
 WHERE id=p_attempt_id AND workspace_id=v_workspace AND status='pending';
 RETURN FOUND;
END;$$;
REVOKE ALL ON FUNCTION public.intrigue_v157_google_complete(text,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v157_google_complete(text,uuid,uuid,text,text) TO anon;
COMMIT;
NOTIFY pgrst,'reload schema';
