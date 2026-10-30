-- INTRIGUE V15.6: Calendly voice scheduling / verified Vapi booking tools.
-- Safe defaults: every workspace has booking DISABLED until its owner enables it.
-- Requires V15.4 Calendly OAuth and V15.5 Vapi webhook/assistant connection.
-- No real bookings or emails are created by applying this SQL.
BEGIN;

CREATE TABLE IF NOT EXISTS public.intrigue_voice_booking_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type_uri text NOT NULL CHECK (event_type_uri ~ '^https://api\.calendly\.com/event_types/[A-Za-z0-9_-]{8,100}$'),
  booking_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intrigue_voice_booking_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_voice_booking_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.intrigue_voice_booking_settings TO authenticated;
DROP POLICY IF EXISTS v156_voice_booking_owner_read ON public.intrigue_voice_booking_settings;
CREATE POLICY v156_voice_booking_owner_read ON public.intrigue_voice_booking_settings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS v156_voice_booking_owner_insert ON public.intrigue_voice_booking_settings;
CREATE POLICY v156_voice_booking_owner_insert ON public.intrigue_voice_booking_settings
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS v156_voice_booking_owner_update ON public.intrigue_voice_booking_settings;
CREATE POLICY v156_voice_booking_owner_update ON public.intrigue_voice_booking_settings
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid())));

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.intrigue_voice_booking_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  call_id text NOT NULL CHECK (char_length(call_id) BETWEEN 8 AND 128),
  tool_call_id text NOT NULL CHECK (char_length(tool_call_id) BETWEEN 6 AND 128),
  event_type_uri text NOT NULL,
  slot_time timestamptz NOT NULL,
  invitee_email_hash text NOT NULL CHECK (invitee_email_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed','uncertain')),
  calendly_invitee_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, call_id, tool_call_id),
  UNIQUE (workspace_id, call_id, slot_time, invitee_email_hash)
);
CREATE INDEX IF NOT EXISTS intrigue_voice_booking_attempts_recent
  ON private.intrigue_voice_booking_attempts (workspace_id, created_at DESC);
ALTER TABLE private.intrigue_voice_booking_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_voice_booking_attempts FROM PUBLIC, anon, authenticated;

-- This function is callable with the per-company Vapi bearer secret only.
-- Encrypted calendar credentials are returned ONLY to the Next.js webhook handler;
-- the encryption key stays server-side, never in Vapi or the browser.
CREATE OR REPLACE FUNCTION public.intrigue_v156_voice_calendar_context(p_token text, p_assistant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_connection private.intrigue_vapi_connections%ROWTYPE;
  v_settings public.intrigue_voice_booking_settings%ROWTYPE;
  v_encrypted text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('authorized',false);
  END IF;
  SELECT * INTO v_connection FROM private.intrigue_vapi_connections
    WHERE assistant_id=p_assistant_id AND token_hash=pg_catalog.md5(p_token);
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('authorized',false); END IF;
  SELECT * INTO v_settings FROM public.intrigue_voice_booking_settings
    WHERE workspace_id=v_connection.workspace_id;
  SELECT encrypted_tokens INTO v_encrypted FROM private.intrigue_calendar_connections
    WHERE workspace_id=v_connection.workspace_id AND provider='calendly';
  RETURN pg_catalog.jsonb_build_object(
    'authorized',true, 'workspace_id',v_connection.workspace_id,
    'configured',v_settings.workspace_id IS NOT NULL AND v_encrypted IS NOT NULL,
    'enabled',coalesce(v_settings.booking_enabled,false),
    'event_type_uri',v_settings.event_type_uri,
    'encrypted_tokens',v_encrypted
  );
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_v156_voice_calendar_context(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v156_voice_calendar_context(text,uuid) TO anon;

-- Optimistic update for refresh-token rotation: rejects stale ciphertext.
CREATE OR REPLACE FUNCTION public.intrigue_v156_voice_refresh_tokens(
  p_token text, p_assistant_id uuid, p_expected_encrypted text, p_new_encrypted text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_workspace uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL
    OR p_expected_encrypted IS NULL OR p_new_encrypted IS NULL
    OR char_length(p_new_encrypted) NOT BETWEEN 24 AND 16000 THEN RETURN false; END IF;
  SELECT workspace_id INTO v_workspace FROM private.intrigue_vapi_connections
    WHERE assistant_id=p_assistant_id AND token_hash=pg_catalog.md5(p_token);
  IF v_workspace IS NULL THEN RETURN false; END IF;
  UPDATE private.intrigue_calendar_connections SET encrypted_tokens=p_new_encrypted,updated_at=now()
    WHERE workspace_id=v_workspace AND provider='calendly'
      AND encrypted_tokens=p_expected_encrypted;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_v156_voice_refresh_tokens(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v156_voice_refresh_tokens(text,uuid,text,text) TO anon;

-- Claim-before-send. Unique constraints prevent repeated function calls from
-- accidentally booking the same email/slot in a single Vapi call.
CREATE OR REPLACE FUNCTION public.intrigue_v156_voice_claim(
  p_token text, p_assistant_id uuid, p_call_id text, p_tool_call_id text,
  p_slot_time timestamptz, p_invitee_email_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_workspace uuid; v_event text; v_attempt private.intrigue_voice_booking_attempts%ROWTYPE; v_created uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL
    OR p_call_id IS NULL OR char_length(p_call_id) NOT BETWEEN 8 AND 128
    OR p_tool_call_id IS NULL OR char_length(p_tool_call_id) NOT BETWEEN 6 AND 128
    OR p_invitee_email_hash !~ '^[a-f0-9]{64}$' OR p_slot_time <= now()
    OR p_slot_time > now()+interval '31 days' THEN
    RETURN pg_catalog.jsonb_build_object('claimed',false,'reason','Invalid booking details');
  END IF;
  SELECT c.workspace_id,s.event_type_uri INTO v_workspace,v_event
    FROM private.intrigue_vapi_connections c
    JOIN public.intrigue_voice_booking_settings s ON s.workspace_id=c.workspace_id
    JOIN private.intrigue_calendar_connections cal ON cal.workspace_id=c.workspace_id AND cal.provider='calendly'
    WHERE c.assistant_id=p_assistant_id AND c.token_hash=pg_catalog.md5(p_token)
      AND s.booking_enabled=true;
  IF v_workspace IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('claimed',false,'reason','Live booking is not enabled');
  END IF;
  INSERT INTO private.intrigue_voice_booking_attempts
    (workspace_id,call_id,tool_call_id,event_type_uri,slot_time,invitee_email_hash)
  VALUES (v_workspace,p_call_id,p_tool_call_id,v_event,p_slot_time,p_invitee_email_hash)
  ON CONFLICT DO NOTHING RETURNING id INTO v_created;
  IF v_created IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('claimed',true,'attempt_id',v_created,'status','pending');
  END IF;
  SELECT * INTO v_attempt FROM private.intrigue_voice_booking_attempts a
    WHERE a.workspace_id=v_workspace AND a.call_id=p_call_id
      AND (a.tool_call_id=p_tool_call_id OR (a.slot_time=p_slot_time AND a.invitee_email_hash=p_invitee_email_hash))
    ORDER BY a.created_at LIMIT 1;
  RETURN pg_catalog.jsonb_build_object('claimed',false,'status',coalesce(v_attempt.status,'unknown'),
    'calendly_invitee_uri',v_attempt.calendly_invitee_uri,
    'reason','This appointment has already been attempted; verify before trying again');
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_v156_voice_claim(text,uuid,text,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v156_voice_claim(text,uuid,text,text,timestamptz,text) TO anon;

CREATE OR REPLACE FUNCTION public.intrigue_v156_voice_complete(
  p_token text,p_assistant_id uuid,p_attempt_id uuid,p_status text,p_calendly_invitee_uri text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_workspace uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_assistant_id IS NULL
    OR p_status NOT IN ('confirmed','failed','uncertain') THEN RETURN false; END IF;
  SELECT workspace_id INTO v_workspace FROM private.intrigue_vapi_connections
    WHERE assistant_id=p_assistant_id AND token_hash=pg_catalog.md5(p_token);
  IF v_workspace IS NULL THEN RETURN false; END IF;
  IF p_status='confirmed' AND (
    p_calendly_invitee_uri IS NULL OR
    p_calendly_invitee_uri !~ '^https://api\.calendly\.com/scheduled_events/[A-Za-z0-9_-]+/invitees/[A-Za-z0-9_-]+$'
  ) THEN RETURN false; END IF;
  UPDATE private.intrigue_voice_booking_attempts
    SET status=p_status,calendly_invitee_uri=CASE WHEN p_status='confirmed' THEN p_calendly_invitee_uri ELSE NULL END,
      updated_at=now()
    WHERE id=p_attempt_id AND workspace_id=v_workspace AND status='pending';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_v156_voice_complete(text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_v156_voice_complete(text,uuid,uuid,text,text) TO anon;

COMMENT ON TABLE public.intrigue_voice_booking_settings IS
'V15.6 Calendly event-type allowlist. Bookings disabled until owner explicitly enables.';
COMMENT ON TABLE private.intrigue_voice_booking_attempts IS
'V15.6 idempotency records. Invitee emails are SHA256 hashed; no transcripts/recordings stored.';

COMMIT;
NOTIFY pgrst, 'reload schema';
