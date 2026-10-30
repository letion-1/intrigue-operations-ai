-- INTRIGUE V15.3: booking-link settings and owner/admin CRM CSV import.
-- NOT a Calendly/Cal.com OAuth integration, Vapi live connection, or email authorization.
-- Requires V14.2+ roles and V15.2 dashboard. Run ONCE in a staging database first.
BEGIN;

CREATE TABLE IF NOT EXISTS public.workspace_integration_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scheduling_provider text NOT NULL DEFAULT 'none'
    CHECK (scheduling_provider IN ('none','cal','calendly')),
  booking_url text NOT NULL DEFAULT '' CHECK (char_length(booking_url) <= 400),
  vapi_assistant_id text NOT NULL DEFAULT '' CHECK (char_length(vapi_assistant_id) <= 100),
  preferred_email_provider text NOT NULL DEFAULT 'none'
    CHECK (preferred_email_provider IN ('none','gmail','outlook')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v153_booking_url_provider CHECK (
    (scheduling_provider = 'none' AND booking_url = '') OR
    (scheduling_provider = 'cal' AND booking_url ~* '^https://([a-z0-9-]+\.)?cal\.com/') OR
    (scheduling_provider = 'calendly' AND booking_url ~* '^https://([a-z0-9-]+\.)?calendly\.com/')
  )
);
ALTER TABLE public.workspace_integration_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_integration_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workspace_integration_preferences TO authenticated;
DROP POLICY IF EXISTS v153_integration_owner_read ON public.workspace_integration_preferences;
CREATE POLICY v153_integration_owner_read ON public.workspace_integration_preferences
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS v153_integration_owner_insert ON public.workspace_integration_preferences;
CREATE POLICY v153_integration_owner_insert ON public.workspace_integration_preferences
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid()))
  );
DROP POLICY IF EXISTS v153_integration_owner_update ON public.workspace_integration_preferences;
CREATE POLICY v153_integration_owner_update ON public.workspace_integration_preferences
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid()))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.workspaces w
      WHERE w.id = workspace_id AND w.owner_id = (SELECT auth.uid()))
  );

-- Add useful CRM fields to the existing workspace-scoped customer entity.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_name text;

CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.intrigue_crm_contact_references (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (char_length(source) BETWEEN 2 AND 32),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 128),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS v153_crm_ref_customer_idx
  ON private.intrigue_crm_contact_references (workspace_id, customer_id);
ALTER TABLE private.intrigue_crm_contact_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.intrigue_crm_contact_references FROM PUBLIC, anon, authenticated;

-- Uses elevated privileges, but authenticates every caller and verifies a
-- current owner/admin membership BEFORE reading or writing any contact rows.
-- This also means former members immediately lose import permission.
CREATE OR REPLACE FUNCTION public.import_intrigue_crm_contacts(
  p_workspace_id uuid,
  p_source text,
  p_contacts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_source text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_source,'')));
  v_row jsonb;
  v_name text;
  v_email text;
  v_phone text;
  v_company text;
  v_vehicle text;
  v_external text;
  v_customer uuid;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_skipped integer := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = v_user
      AND m.role IN ('owner','admin')
  ) THEN RAISE EXCEPTION 'Only the workspace owner or admin may import CRM contacts'; END IF;
  IF v_source NOT IN ('csv','hubspot','zoho','salesforce','pipedrive','other')
    THEN RAISE EXCEPTION 'Unsupported CRM source'; END IF;
  IF p_contacts IS NULL OR pg_catalog.jsonb_typeof(p_contacts) <> 'array'
     OR pg_catalog.jsonb_array_length(p_contacts) < 1
     OR pg_catalog.jsonb_array_length(p_contacts) > 50
  THEN RAISE EXCEPTION 'Each import batch must contain 1 to 50 contacts'; END IF;

  FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_contacts) LOOP
    IF pg_catalog.jsonb_typeof(v_row) <> 'object' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    v_name := pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'full_name','')),160);
    v_email := pg_catalog.lower(pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'email','')),254));
    v_phone := pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'phone','')),60);
    v_company := pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'company_name','')),160);
    v_vehicle := pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'vehicle','')),160);
    v_external := pg_catalog.left(pg_catalog.btrim(coalesce(v_row->>'external_id','')),128);

    -- Require a nonempty name AND an email or stable external CRM ID.
    -- Prevent repeated anonymous name-only imports creating duplicates.
    IF pg_catalog.char_length(v_name) < 2
       OR (v_email = '' AND v_external = '')
       OR (v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    THEN v_skipped := v_skipped + 1; CONTINUE; END IF;

    v_customer := NULL;
    IF v_external <> '' THEN
      SELECT r.customer_id INTO v_customer
      FROM private.intrigue_crm_contact_references r
      WHERE r.workspace_id = p_workspace_id AND r.source = v_source
        AND r.external_id = v_external;
    END IF;
    IF v_customer IS NULL AND v_email <> '' THEN
      SELECT c.id INTO v_customer FROM public.customers c
      WHERE c.workspace_id = p_workspace_id
        AND pg_catalog.lower(c.email) = v_email
      ORDER BY c.created_at LIMIT 1 FOR UPDATE;
    END IF;

    IF v_customer IS NULL THEN
      INSERT INTO public.customers (workspace_id,full_name,email,vehicle,phone,company_name)
      VALUES (p_workspace_id,v_name,
        NULLIF(v_email,''),NULLIF(v_vehicle,''),
        NULLIF(v_phone,''),NULLIF(v_company,''))
      RETURNING id INTO v_customer;
      v_inserted := v_inserted + 1;
    ELSE
      -- Preserve existing customer names and nonempty fields.
      UPDATE public.customers c SET
        email = COALESCE(c.email, NULLIF(v_email,'')),
        phone = COALESCE(c.phone, NULLIF(v_phone,'')),
        company_name = COALESCE(c.company_name, NULLIF(v_company,'')),
        vehicle = COALESCE(c.vehicle, NULLIF(v_vehicle,''))
      WHERE c.id = v_customer AND c.workspace_id = p_workspace_id;
      v_existing := v_existing + 1;
    END IF;

    IF v_external <> '' THEN
      INSERT INTO private.intrigue_crm_contact_references
        (workspace_id,source,external_id,customer_id)
      VALUES (p_workspace_id,v_source,v_external,v_customer)
      ON CONFLICT (workspace_id,source,external_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'inserted',v_inserted,'matched_existing',v_existing,'skipped',v_skipped
  );
END;
$$;
REVOKE ALL ON FUNCTION public.import_intrigue_crm_contacts(uuid,text,jsonb)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_intrigue_crm_contacts(uuid,text,jsonb)
 TO authenticated;
COMMENT ON FUNCTION public.import_intrigue_crm_contacts(uuid,text,jsonb) IS
 'Owner/admin-only staged CSV CRM import. Max 50 per call; no external provider tokens or outgoing messages.';

COMMIT;
NOTIFY pgrst,'reload schema';
