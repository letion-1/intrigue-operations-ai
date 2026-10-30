-- INTRIGUE V15.5: Vapi assistant webhook and metadata-only call receipts.
-- Requires V15.4. No calls initiated, transcripts/recordings/phone numbers saved,
-- and NO calendar booking writes. Install in staging first.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.intrigue_vapi_connections (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assistant_id uuid NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 32),
  configured_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz
);
ALTER TABLE private.intrigue_vapi_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_vapi_connections FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.intrigue_vapi_call_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  assistant_id uuid NOT NULL,
  call_id text NOT NULL CHECK (length(call_id) BETWEEN 8 AND 128),
  event_type text NOT NULL DEFAULT 'end-of-call-report'
    CHECK (event_type = 'end-of-call-report'),
  ended_reason text NOT NULL DEFAULT '' CHECK (length(ended_reason) <= 160),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, call_id, event_type)
);
CREATE INDEX IF NOT EXISTS intrigue_vapi_calls_workspace_recent
  ON public.intrigue_vapi_call_events(workspace_id,received_at DESC);
ALTER TABLE public.intrigue_vapi_call_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_vapi_call_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.intrigue_vapi_call_events TO authenticated;
DROP POLICY IF EXISTS v155_owner_view_call_events ON public.intrigue_vapi_call_events;
CREATE POLICY v155_owner_view_call_events ON public.intrigue_vapi_call_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = intrigue_vapi_call_events.workspace_id
      AND w.owner_id = (SELECT auth.uid())
  ));

-- One owner action issues a strong random per-company credential; plaintext is
-- returned only once. Rotation immediately invalidates the previous credential.
CREATE OR REPLACE FUNCTION public.intrigue_vapi_manage(
  p_workspace_id uuid,
  p_operation text,
  p_assistant_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conn private.intrigue_vapi_connections%ROWTYPE;
  v_token text;
BEGIN
  IF auth.uid() IS NULL OR p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id AND w.owner_id = auth.uid()
  ) THEN RAISE EXCEPTION 'Only the company owner can manage Vapi'; END IF;

  IF p_operation = 'status' THEN
    SELECT * INTO v_conn FROM private.intrigue_vapi_connections
      WHERE workspace_id = p_workspace_id;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('configured',false); END IF;
    RETURN pg_catalog.jsonb_build_object(
      'configured',true,'assistant_id',v_conn.assistant_id,
      'last_verified_at',v_conn.last_verified_at,
      'configured_at',v_conn.configured_at
    );
  ELSIF p_operation = 'issue' THEN
    IF p_assistant_id IS NULL THEN RAISE EXCEPTION 'A saved Vapi Assistant ID is required'; END IF;
    -- 256 bits of unpredictable token material; MD5 is only used as a verifier
    -- for that high-entropy token, never for human passwords.
    v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','') ||
               pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-','');
    INSERT INTO private.intrigue_vapi_connections
      (workspace_id,assistant_id,token_hash,configured_at,last_verified_at)
    VALUES (p_workspace_id,p_assistant_id,pg_catalog.md5(v_token),now(),NULL)
    ON CONFLICT(workspace_id) DO UPDATE SET
      assistant_id=EXCLUDED.assistant_id,
      token_hash=EXCLUDED.token_hash,
      configured_at=now(),last_verified_at=NULL;
    RETURN pg_catalog.jsonb_build_object(
      'configured',true,'assistant_id',p_assistant_id,'credential',v_token
    );
  ELSIF p_operation = 'disconnect' THEN
    DELETE FROM private.intrigue_vapi_connections WHERE workspace_id=p_workspace_id;
    RETURN pg_catalog.jsonb_build_object('configured',false);
  ELSE
    RAISE EXCEPTION 'Unknown Vapi operation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_vapi_manage(uuid,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_vapi_manage(uuid,text,uuid)
  TO authenticated;

-- Public entrypoint only after verifying BOTH the assistant id and 256-bit
-- bearer token. Uses the existing owner-controlled booking URL, not OAuth tokens.
CREATE OR REPLACE FUNCTION public.intrigue_vapi_inbound(
  p_token text,
  p_assistant_id uuid,
  p_kind text,
  p_call_id text DEFAULT NULL,
  p_ended_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_conn private.intrigue_vapi_connections%ROWTYPE;
  v_booking text := '';
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$'
    OR p_assistant_id IS NULL OR p_kind NOT IN ('tool','end-of-call-report')
  THEN RETURN pg_catalog.jsonb_build_object('authorized',false); END IF;
  SELECT * INTO v_conn FROM private.intrigue_vapi_connections
    WHERE assistant_id = p_assistant_id AND token_hash = pg_catalog.md5(p_token);
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('authorized',false); END IF;

  UPDATE private.intrigue_vapi_connections SET last_verified_at=now()
    WHERE workspace_id=v_conn.workspace_id;

  SELECT p.booking_url INTO v_booking FROM public.workspace_integration_preferences p
    WHERE p.workspace_id=v_conn.workspace_id AND p.scheduling_provider <> 'none';

  IF p_kind = 'end-of-call-report' THEN
    IF p_call_id IS NULL OR p_call_id !~ '^[a-zA-Z0-9_-]{8,128}$' THEN
      RAISE EXCEPTION 'Valid Vapi call ID required';
    END IF;
    INSERT INTO public.intrigue_vapi_call_events
      (workspace_id,assistant_id,call_id,ended_reason)
    VALUES (v_conn.workspace_id,p_assistant_id,p_call_id,
      pg_catalog.left(coalesce(p_ended_reason,''),160))
    ON CONFLICT(workspace_id,call_id,event_type) DO NOTHING;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'authorized',true,'booking_url',coalesce(v_booking,'')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_vapi_inbound(text,uuid,text,text,text)
  FROM PUBLIC,anon,authenticated;
-- Webhooks come without a user session. Credential validation happens IN the RPC.
GRANT EXECUTE ON FUNCTION public.intrigue_vapi_inbound(text,uuid,text,text,text)
  TO anon;
COMMENT ON TABLE public.intrigue_vapi_call_events IS
  'V15.5: minimal call receipts only; intentionally excludes PII, audio and transcripts.';
COMMIT;
NOTIFY pgrst, 'reload schema';
