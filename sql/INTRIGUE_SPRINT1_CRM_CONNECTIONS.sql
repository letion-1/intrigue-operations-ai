-- INTRIGUE Sprint 1: provider OAuth state + encrypted per-workspace CRM connections.
-- Database contains only encrypted tokens. Never expose these tables via anonymous or
-- authenticated grants. All access happens through authorized server endpoints.
-- Apply to a backed-up staging project first and run the checks in docs/SPRINT1_TEST_PLAN.md.
BEGIN;
CREATE TABLE IF NOT EXISTS public.intrigue_crm_oauth_states (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('zoho','hubspot','pipedrive')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intrigue_crm_oauth_state_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS intrigue_crm_oauth_expiry_idx ON public.intrigue_crm_oauth_states(expires_at);
ALTER TABLE public.intrigue_crm_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_crm_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_crm_oauth_states TO service_role;

CREATE TABLE IF NOT EXISTS public.intrigue_crm_connections (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('zoho','hubspot','pipedrive')),
  connected_by uuid NOT NULL,
  access_token_cipher text NOT NULL,
  refresh_token_cipher text NOT NULL,
  expires_at timestamptz NOT NULL,
  api_domain text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_import_at timestamptz,
  last_import_count integer NOT NULL DEFAULT 0 CHECK (last_import_count >= 0),
  PRIMARY KEY (workspace_id,provider)
);
ALTER TABLE public.intrigue_crm_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intrigue_crm_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.intrigue_crm_connections TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
