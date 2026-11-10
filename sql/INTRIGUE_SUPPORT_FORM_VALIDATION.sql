-- INTRIGUE STUDIOS | Support form validation alignment
-- This is a targeted migration. It does not erase accounts, tickets, or messages.
-- Apply once in Supabase SQL Editor before deploying the app update.
BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.intrigue_platform_support_tickets') IS NULL THEN
    RAISE EXCEPTION 'Help Center tickets table is missing. Do not continue.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.intrigue_platform_support_tickets'::regclass
      AND conname='intrigue_platform_support_tickets_subject_check'
      AND contype='c'
  ) THEN
    RAISE EXCEPTION 'Expected subject constraint missing or renamed. Inspect the existing schema first.';
  END IF;
END;
$preflight$;

-- Keep a 160-character maximum while allowing any nonempty subject (CRM, IT, AI, etc.).
ALTER TABLE public.intrigue_platform_support_tickets
  DROP CONSTRAINT intrigue_platform_support_tickets_subject_check;
ALTER TABLE public.intrigue_platform_support_tickets
  ADD CONSTRAINT intrigue_platform_support_tickets_subject_check
  CHECK (char_length(btrim(subject)) BETWEEN 1 AND 160);

-- Replace the existing ticket RPC. All workspace ownership, rate limit and
-- service-only permissions remain intact; only the 5-character minimum changes.
CREATE OR REPLACE FUNCTION public.intrigue_platform_new_ticket(
    p_actor uuid,p_tenant uuid,p_subject text,p_category text,p_body text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE tid uuid;
BEGIN
  IF NOT public.intrigue_platform_member(p_actor,p_tenant) THEN
    RAISE EXCEPTION 'Workspace membership required' USING ERRCODE='42501';
  END IF;
  IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 160 OR
     p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000 OR
     p_category IS NULL OR p_category NOT IN ('general','technical','integration','billing','privacy') THEN
    RAISE EXCEPTION 'Invalid ticket input' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM public.intrigue_platform_support_tickets
      WHERE created_by=p_actor AND created_at > now() - interval '1 day') >= 15 THEN
    RAISE EXCEPTION 'Daily support ticket limit reached' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.intrigue_platform_support_tickets(workspace_id,created_by,subject,category)
  VALUES(p_tenant,p_actor,btrim(p_subject),p_category) RETURNING id INTO tid;
  INSERT INTO public.intrigue_platform_support_messages(ticket_id,workspace_id,actor_id,speaker,body)
  VALUES(tid,p_tenant,p_actor,'client',btrim(p_body));
  RETURN tid;
END;
$fn$;

REVOKE ALL ON FUNCTION public.intrigue_platform_new_ticket(uuid,uuid,text,text,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.intrigue_platform_new_ticket(uuid,uuid,text,text,text)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Non-destructive verification. Both security checks should return true.
SELECT
  (SELECT position('btrim(subject)' IN pg_get_constraintdef(oid))>0
   FROM pg_constraint WHERE conrelid='public.intrigue_platform_support_tickets'::regclass
   AND conname='intrigue_platform_support_tickets_subject_check') AS short_subjects_allowed_by_constraint,
  NOT has_function_privilege('authenticated',
    'public.intrigue_platform_new_ticket(uuid,uuid,text,text,text)','EXECUTE') AS direct_client_rpc_blocked,
  has_function_privilege('service_role',
    'public.intrigue_platform_new_ticket(uuid,uuid,text,text,text)','EXECUTE') AS backend_ticket_creation_enabled;
