-- INTRIGUE V15.4. OAuth connection storage, encrypted by Next.js before database insertion.
-- No provider credentials are kept in frontend code or public tables.
-- Does not make bookings, grant staff access, or import personal data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.intrigue_calendar_connections (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('cal','calendly')),
  encrypted_tokens text NOT NULL CHECK (char_length(encrypted_tokens) BETWEEN 24 AND 16000),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);
ALTER TABLE private.intrigue_calendar_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_calendar_connections FROM PUBLIC, anon, authenticated;

-- NOTE: GET returns only AES-256-GCM ciphertext, never plaintext tokens.
-- The secret decryption key exists solely in server runtime environment variables.
CREATE OR REPLACE FUNCTION public.intrigue_calendar_connection(
  p_workspace_id uuid,
  p_provider text,
  p_operation text,
  p_encrypted_tokens text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result private.intrigue_calendar_connections%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id=p_workspace_id AND w.owner_id=auth.uid()
  ) THEN RAISE EXCEPTION 'Workspace owner authorization required'; END IF;
  IF p_provider NOT IN ('cal','calendly') THEN RAISE EXCEPTION 'Unsupported provider'; END IF;
  IF p_operation='store' THEN
    IF p_encrypted_tokens IS NULL OR pg_catalog.char_length(p_encrypted_tokens) NOT BETWEEN 24 AND 16000
      THEN RAISE EXCEPTION 'Invalid encrypted credential'; END IF;
    INSERT INTO private.intrigue_calendar_connections(workspace_id,provider,encrypted_tokens)
    VALUES(p_workspace_id,p_provider,p_encrypted_tokens)
    ON CONFLICT (workspace_id,provider) DO UPDATE
      SET encrypted_tokens=EXCLUDED.encrypted_tokens,updated_at=now();
    RETURN pg_catalog.jsonb_build_object('connected',true);
  ELSIF p_operation='delete' THEN
    DELETE FROM private.intrigue_calendar_connections
    WHERE workspace_id=p_workspace_id AND provider=p_provider;
    RETURN pg_catalog.jsonb_build_object('connected',false);
  ELSIF p_operation='get' THEN
    SELECT * INTO v_result FROM private.intrigue_calendar_connections
    WHERE workspace_id=p_workspace_id AND provider=p_provider;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('connected',false); END IF;
    RETURN pg_catalog.jsonb_build_object('connected',true,'encrypted_tokens',v_result.encrypted_tokens,
      'connected_at',v_result.connected_at);
  ELSE RAISE EXCEPTION 'Invalid operation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.intrigue_calendar_connection(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_calendar_connection(uuid,text,text,text) TO authenticated;
COMMENT ON TABLE private.intrigue_calendar_connections IS 'AES-GCM ciphertext encrypted by INTRIGUE server. Workspace owner only. OAuth tokens never returned plaintext via SQL.';
COMMIT;
NOTIFY pgrst,'reload schema';
