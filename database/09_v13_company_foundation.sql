-- INTRIGUE Operations AI V13 / company-isolation foundation
-- Applies to the EXISTING demo/staging Supabase project. Additive and repeatable.
-- This deliberately does NOT enable staff access to any business records.
-- Existing owner-only policies, action approvals, knowledge and worker remain unchanged.
-- One account can own ONE company in V13; separate accounts can own separate companies.

begin;

-- Account-to-workspace membership registry for a future team system.
-- Membership alone does NOT grant access to business records in V13.
create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index if not exists workspace_memberships_user_idx
  on public.workspace_memberships (user_id,workspace_id);

alter table public.workspace_memberships enable row level security;
revoke all on public.workspace_memberships from public,anon,authenticated;
grant select on public.workspace_memberships to authenticated;

-- Users may see their own membership and an owner may inspect their own company's seats.
-- No browser or authenticated-user writes are allowed to this table.
drop policy if exists v13_membership_read on public.workspace_memberships;
create policy v13_membership_read on public.workspace_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.workspaces w
      where w.id = workspace_id and w.owner_id = (select auth.uid())
    )
  );

-- Keep owner membership in sync for new workspaces. SECURITY DEFINER is strictly
-- a trigger: users cannot call it as a general RPC.
create or replace function public.v13_add_workspace_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_memberships (workspace_id,user_id,role)
  values (new.id,new.owner_id,'owner')
  on conflict (workspace_id,user_id) do update set role='owner';
  return new;
end;
$$;
revoke all on function public.v13_add_workspace_owner() from public,anon,authenticated;

drop trigger if exists v13_workspace_owner_insert on public.workspaces;
create trigger v13_workspace_owner_insert
  after insert on public.workspaces
  for each row execute function public.v13_add_workspace_owner();

-- Preserve every existing company, including Northline Auto, and its owner.
insert into public.workspace_memberships (workspace_id,user_id,role)
select id,owner_id,'owner' from public.workspaces
on conflict (workspace_id,user_id) do update set role='owner';

-- Explicit company onboarding for first-time signed-in users.
-- Uses the existing owner-only RLS on workspaces; no sample records are created.
-- The UNIQUE constraint on workspaces.owner_id intentionally remains in place.
create or replace function public.create_intrigue_company(p_name text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_name text := pg_catalog.btrim(coalesce(p_name,''));
  v_workspace uuid;
begin
  if v_user is null then raise exception 'Sign in before creating a company'; end if;
  if pg_catalog.char_length(v_name) < 2 or pg_catalog.char_length(v_name) > 100 then
    raise exception 'Company name must be between 2 and 100 characters';
  end if;
  if exists (select 1 from public.workspaces where owner_id = v_user) then
    raise exception 'This account already owns a company workspace';
  end if;
  insert into public.workspaces (owner_id,name) values (v_user,v_name)
  returning id into v_workspace;
  return v_workspace;
end;
$$;
revoke all on function public.create_intrigue_company(text) from public,anon,authenticated;
grant execute on function public.create_intrigue_company(text) to authenticated;

commit;
notify pgrst, 'reload schema';

-- Verification query (read-only). Run after migration if useful:
-- select count(*) as total_companies from public.workspaces;
-- select count(*) as owner_memberships from public.workspace_memberships where role='owner';
-- There must be NO cross-workspace access unless directly authorized by owner-only RLS.
