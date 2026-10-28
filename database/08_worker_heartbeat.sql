-- INTRIGUE Operations AI V12: additive cloud-worker heartbeat for staging.
-- Requires V11's queue migration to have succeeded.
-- Read heartbeat timestamps in Supabase SQL Editor. No client access is granted.
create table if not exists public.automation_worker_heartbeats (
  worker_id text primary key check (length(worker_id) between 1 and 100),
  status text not null check (status in ('running','stopping')),
  completed_jobs bigint not null default 0 check (completed_jobs >= 0),
  failed_attempts bigint not null default 0 check (failed_attempts >= 0),
  last_seen timestamptz not null default now()
);

alter table public.automation_worker_heartbeats enable row level security;
revoke all on table public.automation_worker_heartbeats from public, anon, authenticated;

create or replace function public.worker_heartbeat_intrigue_v12(
  p_worker_id text, p_status text, p_completed bigint, p_failures bigint
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_worker_id is null or pg_catalog.length(p_worker_id) not between 1 and 100
    or p_status not in ('running','stopping')
    or p_completed is null or p_completed < 0
    or p_failures is null or p_failures < 0 then
    raise exception 'Invalid worker heartbeat';
  end if;
  insert into public.automation_worker_heartbeats (
    worker_id,status,completed_jobs,failed_attempts,last_seen
  ) values (p_worker_id,p_status,p_completed,p_failures,now())
  on conflict(worker_id) do update set
    status=excluded.status,
    completed_jobs=excluded.completed_jobs,
    failed_attempts=excluded.failed_attempts,
    last_seen=excluded.last_seen;
  return true;
end;
$$;

revoke all on function public.worker_heartbeat_intrigue_v12(text,text,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.worker_heartbeat_intrigue_v12(text,text,bigint,bigint)
  to service_role;

-- Founder/admin inspection query (run separately; do not add it to deployment code):
-- select worker_id, status, last_seen, now()-last_seen as age,
--        completed_jobs, failed_attempts
-- from public.automation_worker_heartbeats order by last_seen desc;
