-- rdp_access_approval: per-grant, owner-approved, time-boxed access to the shared remote desktop.
--
-- Admission control only. It decides WHO may open NEW gateway tunnels and WHEN; it does not contain what a
-- grantee does once inside (the OS account is shared). Plan: docs/remote-desktop-access-approval-plan-2026-10-06.md
--
-- Design:
--   * Three closed tables (RLS on, browser roles can only read their OWN rows through narrow column grants).
--   * Every write is a SECURITY INVOKER function executable by service_role ONLY. The browser has no EXECUTE at
--     all: identity (user id), client IP, origin check and owner alerting live in the server code that calls them.
--     The functions still re-check the permission key / owner status themselves.
--   * Exactly ONE active grant at any time (partial unique index on a constant expression: a real lock).
--   * Expiry never depends on a sweep: every function that reads or locks state calls rdp_expire_stale() first.
--   * Append-only audit table written inside the same transaction as the state change.
--
-- Rollback (manual, owner approval; nothing else depends on these yet):
--   drop function if exists public.rdp_redact_old_ips(timestamptz), public.rdp_record_event(text,text,uuid,uuid,inet,text,text),
--     public.rdp_mark_cut(uuid,boolean,text), public.rdp_sweep(timestamptz), public.rdp_check_tunnel(text,inet,text),
--     public.rdp_end_grant(uuid,uuid,text), public.rdp_end_own_grant(uuid), public.rdp_answer_request(uuid,uuid,text,integer,text,text,jsonb),
--     public.rdp_begin_file_issue(uuid,inet), public.rdp_cancel_request(uuid,uuid), public.rdp_request_access(uuid,text,integer,inet),
--     public.rdp_expire_stale(timestamptz), public.rdp_log(text,text,uuid,uuid,uuid,inet,text,text,jsonb),
--     public.is_platform_owner_for_user(uuid);
--   drop table if exists public.rdp_access_events, public.rdp_access_grants, public.rdp_access_requests;
--   drop function if exists public.rdp_access_requests_guard(), public.rdp_access_grants_guard(),
--     public.rdp_access_events_guard(), public.rdp_access_no_truncate();
--   delete from public.platform_permission_definitions where key = 'rdp.request';  -- cascades the owner grant row

-- 1. Permission key. The owner row is written by trigger platform_permission_grant_owner.
--    NO other role is granted here; the owner ticks it per role in /admin/roles if ever wanted.
insert into public.platform_permission_definitions (key, label, category, sort_order)
values ('rdp.request', 'בקשת גישה לשולחן עבודה מרוחק', 'ops', 90)
on conflict (key) do nothing;

-- 2. Owner twin, same recipe as is_platform_staff_for_user / has_platform_permission_for_user.
create or replace function public.is_platform_owner_for_user(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_staff s
    join public.platform_roles r on r.id = s.role_id
    where s.user_id = _user_id
      and r.is_owner_role
  );
$$;
revoke all on function public.is_platform_owner_for_user(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_owner_for_user(uuid) to service_role;

-- 3. Tables
create table public.rdp_access_requests (
  id                uuid primary key default extensions.uuid_generate_v7(),
  requester_id      uuid references auth.users (id) on delete set null,
  reason            text not null check (char_length(btrim(reason)) between 10 and 500),
  requested_minutes smallint not null check (requested_minutes between 5 and 240),
  request_ip        inet,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '30 minutes',
  answered_by       uuid references auth.users (id) on delete set null,
  answered_at       timestamptz,
  granted_minutes   smallint check (granted_minutes between 5 and 240),
  answer_note       text check (answer_note is null or char_length(answer_note) <= 500),
  approver_context  jsonb check (approver_context is null or octet_length(approver_context::text) <= 1000),
  cancelled_at      timestamptz,
  constraint rdp_access_requests_expiry_after_create check (expires_at > created_at),
  constraint rdp_access_requests_state_consistency check (
    case status
      when 'pending'   then answered_at is null and cancelled_at is null and granted_minutes is null
      when 'approved'  then answered_at is not null and granted_minutes is not null and cancelled_at is null
      when 'denied'    then answered_at is not null and granted_minutes is null and cancelled_at is null
      when 'expired'   then answered_at is null and cancelled_at is null
      when 'cancelled' then cancelled_at is not null and answered_at is null
    end
  )
);
create unique index rdp_access_requests_one_pending_uq
  on public.rdp_access_requests (requester_id) where status = 'pending';
create index rdp_access_requests_pending_idx
  on public.rdp_access_requests (created_at) where status = 'pending';
create index rdp_access_requests_requester_idx
  on public.rdp_access_requests (requester_id, created_at desc);
create index rdp_access_requests_answered_by_idx
  on public.rdp_access_requests (answered_by) where answered_by is not null;

create table public.rdp_access_grants (
  id             uuid primary key default extensions.uuid_generate_v7(),
  request_id     uuid not null unique references public.rdp_access_requests (id) on delete restrict,
  user_id        uuid references auth.users (id) on delete set null,
  granted_by     uuid references auth.users (id) on delete set null,
  -- decided by the SERVER at approval time, never by the requester
  target         text not null check (target ~ '^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$'),
  status         text not null default 'active' check (status in ('active', 'revoked', 'expired', 'ended')),
  starts_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  ended_at       timestamptz,
  ended_by       uuid references auth.users (id) on delete set null,
  ended_reason   text check (ended_reason is null
                             or ended_reason in ('revoked_by_owner', 'expired', 'ended_by_user', 'access_removed')),
  files_issued   smallint not null default 0 check (files_issued >= 0),
  max_files      smallint not null default 20 check (max_files between 1 and 100),
  last_file_at   timestamptz,
  cut_attempts   smallint not null default 0,
  cut_ok_count   smallint not null default 0,
  last_cut_at    timestamptz,
  -- a fixed short code (unreachable / timeout / rejected / bad_response), never a response body
  last_cut_error text check (last_cut_error is null or char_length(last_cut_error) <= 40),
  tunnels_cut_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- DB-level ceiling: access is never longer than 4 hours, whatever the caller passes.
  constraint rdp_access_grants_window
    check (expires_at > starts_at and expires_at <= starts_at + interval '240 minutes'),
  constraint rdp_access_grants_state_consistency check ((status = 'active') = (ended_at is null))
);
-- THE LOCK: at most one active grant, enforced in the btree (an exists() check inside a trigger is not a lock).
create unique index rdp_access_grants_one_active_uq
  on public.rdp_access_grants ((true)) where status = 'active';
create index rdp_access_grants_user_idx
  on public.rdp_access_grants (user_id, created_at desc);
create index rdp_access_grants_granted_by_idx
  on public.rdp_access_grants (granted_by) where granted_by is not null;
create index rdp_access_grants_ended_by_idx
  on public.rdp_access_grants (ended_by) where ended_by is not null;
create index rdp_access_grants_cut_pending_idx
  on public.rdp_access_grants (ended_at) where status <> 'active' and tunnels_cut_at is null;

create table public.rdp_access_events (
  id         uuid primary key default extensions.uuid_generate_v7(),
  at         timestamptz not null default now(),
  -- open set; the list lives in src/lib/rdp-access/events.ts with a drift test
  kind       text not null check (kind ~ '^[a-z_]{3,40}$'),
  request_id uuid references public.rdp_access_requests (id) on delete restrict,
  grant_id   uuid references public.rdp_access_grants (id) on delete restrict,
  actor_id   uuid references auth.users (id) on delete set null,
  actor_kind text not null check (actor_kind in ('staff', 'owner_cli', 'gateway', 'system')),
  client_ip  inet,
  tunnel_ref text check (tunnel_ref is null or char_length(tunnel_ref) <= 64),
  outcome    text check (outcome is null or char_length(outcome) <= 40),
  detail     jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 2000)
);
create index rdp_access_events_at_idx      on public.rdp_access_events (at desc);
create index rdp_access_events_grant_idx   on public.rdp_access_events (grant_id, at) where grant_id is not null;
create index rdp_access_events_request_idx on public.rdp_access_events (request_id, at) where request_id is not null;
create index rdp_access_events_actor_idx   on public.rdp_access_events (actor_id) where actor_id is not null;

comment on table public.rdp_access_requests is
  'Staff requests for remote-desktop access. Written only through rdp_* functions (service_role).';
comment on table public.rdp_access_grants is
  'Owner-approved, time-boxed grants. At most one active row (rdp_access_grants_one_active_uq).';
comment on table public.rdp_access_events is
  'Append-only audit trail for the remote-desktop approval flow. No PII beyond an IP that is nulled after 90 days.';

-- 4. Guard triggers (not bypassed by service_role). Same shape as fleet_requests_guard.
create or replace function public.rdp_access_no_truncate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '% is append-only: truncate is forbidden', tg_table_name;
end
$$;

create or replace function public.rdp_access_requests_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rdp_access_requests: rows are never deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.answered_at is not null or new.answered_by is not null
       or new.cancelled_at is not null or new.granted_minutes is not null then
      raise exception 'rdp_access_requests: inserts must be clean pending rows';
    end if;
    return new;
  end if;

  -- retention: the IP may be nulled under the retention GUC, and nothing else changes
  if new.request_ip is null and old.request_ip is not null
     and coalesce(current_setting('app.rdp_redact_ips', true), '') = 'on'
     and (to_jsonb(new) - 'request_ip') = (to_jsonb(old) - 'request_ip') then
    return new;
  end if;

  -- FK ON DELETE SET NULL carve-out (a deleted auth user nulls requester_id / answered_by, nothing else)
  if ((new.requester_id is null and old.requester_id is not null)
      or (new.answered_by is null and old.answered_by is not null))
     and (to_jsonb(new) - 'requester_id' - 'answered_by') = (to_jsonb(old) - 'requester_id' - 'answered_by') then
    return new;
  end if;

  if new.id <> old.id
     or new.requester_id is distinct from old.requester_id
     or new.reason <> old.reason
     or new.requested_minutes <> old.requested_minutes
     or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at
     or new.request_ip is distinct from old.request_ip then
    raise exception 'rdp_access_requests: core fields are immutable';
  end if;

  if old.status = 'pending' and new.status in ('approved', 'denied', 'expired', 'cancelled') then
    return new;
  end if;

  raise exception 'rdp_access_requests: illegal status transition % -> %', old.status, new.status;
end
$$;
create trigger rdp_access_requests_guard
  before insert or update or delete on public.rdp_access_requests
  for each row execute function public.rdp_access_requests_guard();
create trigger rdp_access_requests_no_truncate
  before truncate on public.rdp_access_requests
  for each statement execute function public.rdp_access_no_truncate();

create or replace function public.rdp_access_grants_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rdp_access_grants: rows are never deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.ended_at is not null or new.ended_by is not null or new.ended_reason is not null
       or new.files_issued <> 0 or new.cut_attempts <> 0 or new.cut_ok_count <> 0 or new.tunnels_cut_at is not null then
      raise exception 'rdp_access_grants: inserts must be clean active rows';
    end if;
    return new;
  end if;

  new.updated_at := now();

  -- FK ON DELETE SET NULL carve-out
  if ((new.user_id is null and old.user_id is not null)
      or (new.granted_by is null and old.granted_by is not null)
      or (new.ended_by is null and old.ended_by is not null))
     and (to_jsonb(new) - 'user_id' - 'granted_by' - 'ended_by' - 'updated_at')
       = (to_jsonb(old) - 'user_id' - 'granted_by' - 'ended_by' - 'updated_at') then
    return new;
  end if;

  if new.id <> old.id
     or new.request_id <> old.request_id
     or new.target <> old.target
     or new.starts_at <> old.starts_at
     or new.expires_at <> old.expires_at
     or new.max_files <> old.max_files
     or new.created_at <> old.created_at
     or new.user_id is distinct from old.user_id
     or new.granted_by is distinct from old.granted_by then
    raise exception 'rdp_access_grants: core fields are immutable (a grant is never extended in place)';
  end if;

  if old.status = 'active' then
    if new.status = 'active' then
      if new.ended_at is not null
         or new.cut_attempts <> old.cut_attempts
         or new.cut_ok_count <> old.cut_ok_count
         or new.tunnels_cut_at is not null then
        raise exception 'rdp_access_grants: only download counters change while active';
      end if;
      return new;
    end if;
    if new.status in ('revoked', 'expired', 'ended') then
      return new;
    end if;
    raise exception 'rdp_access_grants: illegal status transition % -> %', old.status, new.status;
  end if;

  -- terminal: only the disconnect bookkeeping may change
  if new.status <> old.status
     or new.ended_at is distinct from old.ended_at
     or new.ended_by is distinct from old.ended_by
     or new.ended_reason is distinct from old.ended_reason
     or new.files_issued <> old.files_issued
     or new.last_file_at is distinct from old.last_file_at then
    raise exception 'rdp_access_grants: an ended grant is frozen except for disconnect bookkeeping';
  end if;
  return new;
end
$$;
create trigger rdp_access_grants_guard
  before insert or update or delete on public.rdp_access_grants
  for each row execute function public.rdp_access_grants_guard();
create trigger rdp_access_grants_no_truncate
  before truncate on public.rdp_access_grants
  for each statement execute function public.rdp_access_no_truncate();

create or replace function public.rdp_access_events_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.client_ip is null and old.client_ip is not null
     and coalesce(current_setting('app.rdp_redact_ips', true), '') = 'on'
     and (to_jsonb(new) - 'client_ip') = (to_jsonb(old) - 'client_ip') then
    return new;
  end if;
  raise exception 'rdp_access_events: append-only (% blocked)', tg_op;
end
$$;
create trigger rdp_access_events_guard
  before update or delete on public.rdp_access_events
  for each row execute function public.rdp_access_events_guard();
create trigger rdp_access_events_no_truncate
  before truncate on public.rdp_access_events
  for each statement execute function public.rdp_access_no_truncate();

-- 5. RLS and grants. service_role bypasses RLS; the browser roles get only the narrow own-row read below.
alter table public.rdp_access_requests enable row level security;
alter table public.rdp_access_grants   enable row level security;
alter table public.rdp_access_events   enable row level security;

revoke all on table public.rdp_access_requests, public.rdp_access_grants, public.rdp_access_events
  from public, anon, authenticated;

-- staff read ONLY their own rows and ONLY safe columns (no request_ip, approver_context, answered_by, cut internals)
grant select (id, status, reason, requested_minutes, created_at, expires_at, answered_at, granted_minutes,
              answer_note, cancelled_at)
  on public.rdp_access_requests to authenticated;
grant select (id, request_id, status, target, starts_at, expires_at, ended_at, ended_reason, files_issued, max_files)
  on public.rdp_access_grants to authenticated;

create policy rdp_access_requests_own_select on public.rdp_access_requests
  for select to authenticated
  using (requester_id = (select auth.uid()) and (select public.has_platform_permission('rdp.request')));
create policy rdp_access_grants_own_select on public.rdp_access_grants
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.has_platform_permission('rdp.request')));
-- rdp_access_events: no grants, no policies (the owner reads it through the service-role module).

-- 6. Functions. All SECURITY INVOKER, search_path = '', EXECUTE for service_role only (see section 7).
--    Time is always the DB clock (now()), never the application clock.

create or replace function public.rdp_log(
  p_kind text, p_actor_kind text, p_actor uuid, p_request uuid, p_grant uuid,
  p_ip inet, p_tunnel text, p_outcome text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.rdp_access_events (kind, actor_kind, actor_id, request_id, grant_id, client_ip, tunnel_ref, outcome, detail)
  values (p_kind, p_actor_kind, p_actor, p_request, p_grant, p_ip, p_tunnel, p_outcome, coalesce(p_detail, '{}'::jsonb));
$$;

-- Expiry NEVER depends on the sweep: every function that reads or locks state calls this first.
create or replace function public.rdp_expire_stale(p_now timestamptz default now())
returns table (requests_expired integer, grants_expired integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  with e as (
    update public.rdp_access_requests r
       set status = 'expired'
     where r.status = 'pending' and r.expires_at <= p_now
    returning r.id
  ), l as (
    insert into public.rdp_access_events (kind, actor_kind, request_id, outcome)
    select 'request_expired', 'system', e.id, 'expired' from e
    returning 1
  )
  select (select count(*) from e)::integer into requests_expired;

  with g as (
    update public.rdp_access_grants x
       set status = 'expired', ended_at = x.expires_at, ended_reason = 'expired'
     where x.status = 'active' and x.expires_at <= p_now
    returning x.id, x.request_id
  ), l as (
    insert into public.rdp_access_events (kind, actor_kind, request_id, grant_id, outcome)
    select 'grant_expired', 'system', g.request_id, g.id, 'expired' from g
    returning 1
  )
  select (select count(*) from g)::integer into grants_expired;

  return next;
end
$$;

create or replace function public.rdp_request_access(
  p_user_id uuid, p_reason text, p_minutes integer, p_client_ip inet)
returns table (outcome text, request_id uuid, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v public.rdp_access_requests%rowtype;
begin
  if p_user_id is null or not public.has_platform_permission_for_user(p_user_id, 'rdp.request') then
    return query select 'not_allowed'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
    return query select 'invalid_reason'::text, null::uuid, null::timestamptz;
    return;
  end if;
  if p_minutes is null or p_minutes not between 5 and 240 then
    return query select 'invalid_minutes'::text, null::uuid, null::timestamptz;
    return;
  end if;

  perform public.rdp_expire_stale();   -- a stale pending row must not block a fresh request

  if exists (select 1 from public.rdp_access_grants g where g.user_id = p_user_id and g.status = 'active') then
    return query select 'has_active_grant'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- durable rate limit (the web rate limiter is per-process and resets on restart)
  if (select count(*) from public.rdp_access_requests r
       where r.requester_id = p_user_id and r.created_at > now() - interval '1 hour') >= 6 then
    return query select 'rate_limited'::text, null::uuid, null::timestamptz;
    return;
  end if;

  insert into public.rdp_access_requests (requester_id, reason, requested_minutes, request_ip)
  values (p_user_id, btrim(p_reason), p_minutes, p_client_ip)
  on conflict (requester_id) where status = 'pending' do nothing
  returning * into v;

  if not found then   -- idempotent double-submit / two tabs
    select * into v from public.rdp_access_requests r
     where r.requester_id = p_user_id and r.status = 'pending';
    return query select 'already_pending'::text, v.id, v.expires_at;
    return;
  end if;

  perform public.rdp_log('requested', 'staff', p_user_id, v.id, null, p_client_ip, null, 'pending',
                         jsonb_build_object('minutes', p_minutes));
  return query select 'created'::text, v.id, v.expires_at;
end
$$;

create or replace function public.rdp_cancel_request(p_user_id uuid, p_request_id uuid)
returns table (outcome text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.rdp_expire_stale();
  update public.rdp_access_requests r
     set status = 'cancelled', cancelled_at = now()
   where r.id = p_request_id and r.requester_id = p_user_id and r.status = 'pending'
  returning r.id into v_id;
  if v_id is null then
    return query select 'not_found_or_not_pending'::text;   -- does not distinguish "not mine" from "does not exist"
    return;
  end if;
  perform public.rdp_log('cancelled', 'staff', p_user_id, v_id, null, null, null, 'cancelled', '{}'::jsonb);
  return query select 'cancelled'::text;
end
$$;

create or replace function public.rdp_end_own_grant(p_user_id uuid)
returns table (outcome text, grant_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
  v_req uuid;
begin
  perform public.rdp_expire_stale();
  update public.rdp_access_grants g
     set status = 'ended', ended_at = now(), ended_by = p_user_id, ended_reason = 'ended_by_user'
   where g.user_id = p_user_id and g.status = 'active'
  returning g.id, g.request_id into v_id, v_req;
  if v_id is null then
    return query select 'no_active_grant'::text, null::uuid;
    return;
  end if;
  perform public.rdp_log('grant_ended', 'staff', p_user_id, v_req, v_id, null, null, 'ended_by_user', '{}'::jsonb);
  return query select 'ended'::text, v_id;
end
$$;

-- Reserve a download BEFORE the server calls the gateway (same idea as a pending ledger row): a failed
-- gateway call still consumes quota, which is intended (20 downloads are plenty).
create or replace function public.rdp_begin_file_issue(p_user_id uuid, p_client_ip inet)
returns table (outcome text, grant_id uuid, target text, expires_at timestamptz, files_left integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  g public.rdp_access_grants%rowtype;
begin
  if p_user_id is null or not public.has_platform_permission_for_user(p_user_id, 'rdp.request') then
    return query select 'not_allowed'::text, null::uuid, null::text, null::timestamptz, null::integer;
    return;
  end if;

  perform public.rdp_expire_stale();

  select * into g from public.rdp_access_grants x
   where x.user_id = p_user_id and x.status = 'active'
   for update;
  if not found then
    return query select 'no_active_grant'::text, null::uuid, null::text, null::timestamptz, null::integer;
    return;
  end if;

  if g.files_issued >= g.max_files then
    perform public.rdp_log('file_refused', 'staff', p_user_id, g.request_id, g.id, p_client_ip, null, 'file_limit', '{}'::jsonb);
    return query select 'file_limit'::text, g.id, null::text, null::timestamptz, 0;
    return;
  end if;

  if g.last_file_at is not null and g.last_file_at > now() - interval '10 seconds' then
    perform public.rdp_log('file_refused', 'staff', p_user_id, g.request_id, g.id, p_client_ip, null, 'too_soon', '{}'::jsonb);
    return query select 'too_soon'::text, g.id, null::text, null::timestamptz, (g.max_files - g.files_issued)::integer;
    return;
  end if;

  update public.rdp_access_grants x
     set files_issued = x.files_issued + 1, last_file_at = now()
   where x.id = g.id;

  perform public.rdp_log('file_issued', 'staff', p_user_id, g.request_id, g.id, p_client_ip, null, 'ok',
                         jsonb_build_object('n', g.files_issued + 1));
  return query select 'ok'::text, g.id, g.target, g.expires_at, (g.max_files - g.files_issued - 1)::integer;
end
$$;

-- Owner decision (called by the CLI with an explicit owner user id, verified here).
create or replace function public.rdp_answer_request(
  p_request_id uuid, p_actor_id uuid, p_verdict text, p_minutes integer,
  p_target text, p_note text, p_context jsonb)
returns table (outcome text, grant_id uuid, expires_at timestamptz, conflicting_grant_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v      public.rdp_access_requests%rowtype;
  v_grant uuid;
  v_exp   timestamptz;
  v_conf  uuid;
begin
  if not public.is_platform_owner_for_user(p_actor_id) then
    return query select 'not_owner'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  if p_verdict not in ('approved', 'denied') then
    return query select 'invalid_verdict'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  perform public.rdp_expire_stale();   -- before taking the row lock

  select * into v from public.rdp_access_requests r where r.id = p_request_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  if v.status <> 'pending' then
    return query select (case when v.status = 'expired' then 'expired' else 'not_pending' end)::text,
                        null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if p_verdict = 'denied' then
    update public.rdp_access_requests r
       set status = 'denied', answered_by = p_actor_id, answered_at = now(),
           answer_note = left(p_note, 500), approver_context = p_context
     where r.id = v.id;
    perform public.rdp_log('denied', 'owner_cli', p_actor_id, v.id, null, null, null, 'denied', '{}'::jsonb);
    return query select 'denied'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if p_minutes is null or p_minutes not between 5 and 240 then
    return query select 'invalid_minutes'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  if p_target is null or p_target !~ '^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$' then
    return query select 'invalid_target'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  if v.requester_id is null or not public.has_platform_permission_for_user(v.requester_id, 'rdp.request') then
    return query select 'requester_not_allowed'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  begin
    insert into public.rdp_access_grants (request_id, user_id, granted_by, target, expires_at)
    values (v.id, v.requester_id, p_actor_id, p_target, now() + make_interval(mins => p_minutes))
    returning id, public.rdp_access_grants.expires_at into v_grant, v_exp;
  exception when unique_violation then
    -- another approval won the one-active-grant index
    select x.id into v_conf from public.rdp_access_grants x where x.status = 'active';
    return query select 'grant_conflict'::text, null::uuid, null::timestamptz, v_conf;
    return;
  end;

  update public.rdp_access_requests r
     set status = 'approved', answered_by = p_actor_id, answered_at = now(),
         granted_minutes = p_minutes, answer_note = left(p_note, 500), approver_context = p_context
   where r.id = v.id;

  perform public.rdp_log('approved', 'owner_cli', p_actor_id, v.id, v_grant, null, null, 'approved',
                         jsonb_build_object('minutes', p_minutes, 'self_approved', v.requester_id = p_actor_id));
  return query select 'approved'::text, v_grant, v_exp, null::uuid;
end
$$;

create or replace function public.rdp_end_grant(p_actor_id uuid, p_grant_id uuid default null, p_reason text default null)
returns table (outcome text, grant_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id  uuid;
  v_req uuid;
begin
  if not public.is_platform_owner_for_user(p_actor_id) then
    return query select 'not_owner'::text, null::uuid;
    return;
  end if;
  perform public.rdp_expire_stale();
  update public.rdp_access_grants g
     set status = 'revoked', ended_at = now(), ended_by = p_actor_id, ended_reason = 'revoked_by_owner'
   where g.status = 'active' and (p_grant_id is null or g.id = p_grant_id)
  returning g.id, g.request_id into v_id, v_req;
  if v_id is null then
    return query select 'no_active_grant'::text, null::uuid;
    return;
  end if;
  perform public.rdp_log('grant_revoked', 'owner_cli', p_actor_id, v_req, v_id, null, null, 'revoked',
                         jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
  return query select 'revoked'::text, v_id;
end
$$;

-- Called by the gateway for EVERY new tunnel (through the app's internal route). Cheap, fail-closed:
-- the caller treats anything other than allow = true as a denial. The reason stays in the audit log only.
-- The gateway identity is the shared OS account, so the lookup is "the one active grant for this target".
create or replace function public.rdp_check_tunnel(p_target text, p_client_ip inet, p_tunnel_ref text)
returns table (allow boolean, grant_id uuid, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v        public.rdp_access_grants%rowtype;
  v_reason text := 'ok';
begin
  select * into v from public.rdp_access_grants g where g.status = 'active';
  if not found then
    v_reason := 'no_grant';
  elsif v.expires_at <= now() then
    v_reason := 'expired';
  elsif v.target <> p_target then
    v_reason := 'target_mismatch';
  elsif v.user_id is null or not public.has_platform_permission_for_user(v.user_id, 'rdp.request') then
    v_reason := 'access_removed';
  end if;

  if v_reason = 'ok' then
    perform public.rdp_log('tunnel_check', 'gateway', v.user_id, v.request_id, v.id, p_client_ip, p_tunnel_ref, 'allow', '{}'::jsonb);
    return query select true, v.id, v.expires_at;
  else
    perform public.rdp_log('tunnel_check', 'gateway', null, v.request_id, v.id, p_client_ip, p_tunnel_ref, 'deny:' || v_reason, '{}'::jsonb);
    return query select false, null::uuid, null::timestamptz;
  end if;
end
$$;

-- Worker sweep: expiry bookkeeping + end grants whose holder lost the permission or was removed.
create or replace function public.rdp_sweep(p_now timestamptz default now())
returns table (requests_expired integer, grants_expired integer, access_removed integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_removed integer;
begin
  select e.requests_expired, e.grants_expired into requests_expired, grants_expired
    from public.rdp_expire_stale(p_now) e;

  with r as (
    update public.rdp_access_grants g
       set status = 'revoked', ended_at = p_now, ended_reason = 'access_removed'
     where g.status = 'active'
       and (g.user_id is null or not public.has_platform_permission_for_user(g.user_id, 'rdp.request'))
    returning g.id, g.request_id
  ), l as (
    insert into public.rdp_access_events (kind, actor_kind, request_id, grant_id, outcome)
    select 'access_removed', 'system', r.request_id, r.id, 'revoked' from r
    returning 1
  )
  select (select count(*) from r)::integer into v_removed;

  access_removed := v_removed;
  return next;
end
$$;

-- Disconnect bookkeeping. tunnels_cut_at is set only after TWO successful disconnects at least 45 seconds
-- apart (closes the check-allow -> revoke -> connect window).
create or replace function public.rdp_mark_cut(p_grant_id uuid, p_ok boolean, p_error_code text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g public.rdp_access_grants%rowtype;
begin
  select * into g from public.rdp_access_grants x where x.id = p_grant_id and x.status <> 'active' for update;
  if not found then
    return;
  end if;

  if p_ok then
    if g.cut_ok_count = 0 then
      update public.rdp_access_grants x
         set cut_attempts = least(x.cut_attempts + 1, 32000), cut_ok_count = 1, last_cut_at = now(), last_cut_error = null
       where x.id = g.id;
    elsif g.last_cut_at is not null and g.last_cut_at <= now() - interval '45 seconds' then
      update public.rdp_access_grants x
         set cut_attempts = least(x.cut_attempts + 1, 32000), cut_ok_count = least(x.cut_ok_count + 1, 32000),
             last_cut_at = now(), last_cut_error = null, tunnels_cut_at = now()
       where x.id = g.id;
    else
      update public.rdp_access_grants x
         set cut_attempts = least(x.cut_attempts + 1, 32000)
       where x.id = g.id;
    end if;
    perform public.rdp_log('disconnect_ok', 'system', null, g.request_id, g.id, null, null, 'ok', '{}'::jsonb);
  else
    update public.rdp_access_grants x
       set cut_attempts = least(x.cut_attempts + 1, 32000), last_cut_error = left(coalesce(p_error_code, 'unknown'), 40)
     where x.id = g.id;
    perform public.rdp_log('disconnect_failed', 'system', null, g.request_id, g.id, null, null,
                           left(coalesce(p_error_code, 'unknown'), 40), '{}'::jsonb);
  end if;
end
$$;

-- Only two server-observed events may be recorded from application code.
create or replace function public.rdp_record_event(
  p_kind text, p_actor_kind text, p_grant_id uuid, p_request_id uuid,
  p_client_ip inet, p_tunnel_ref text, p_outcome text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_kind not in ('file_failed', 'tunnel_closed') then
    raise exception 'rdp_record_event: kind % is not allowed', p_kind;
  end if;
  perform public.rdp_log(p_kind, p_actor_kind, null, p_request_id, p_grant_id, p_client_ip, p_tunnel_ref, p_outcome, '{}'::jsonb);
end
$$;

-- Retention: null client IPs older than the cut-off (the only update the guards allow). Refuses recent cut-offs.
create or replace function public.rdp_redact_old_ips(p_before timestamptz)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n_events   integer;
  n_requests integer;
begin
  if p_before > now() - interval '30 days' then
    raise exception 'rdp_redact_old_ips: cut-off must be at least 30 days old';
  end if;
  perform set_config('app.rdp_redact_ips', 'on', true);
  update public.rdp_access_events e set client_ip = null where e.client_ip is not null and e.at < p_before;
  get diagnostics n_events = row_count;
  update public.rdp_access_requests r set request_ip = null where r.request_ip is not null and r.created_at < p_before;
  get diagnostics n_requests = row_count;
  perform set_config('app.rdp_redact_ips', 'off', true);
  return n_events + n_requests;
end
$$;

-- 7. ACL and self-verification. If any of this is wrong the whole migration aborts.
revoke all on function public.rdp_log(text, text, uuid, uuid, uuid, inet, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rdp_expire_stale(timestamptz) from public, anon, authenticated;
revoke all on function public.rdp_request_access(uuid, text, integer, inet) from public, anon, authenticated;
revoke all on function public.rdp_cancel_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rdp_end_own_grant(uuid) from public, anon, authenticated;
revoke all on function public.rdp_begin_file_issue(uuid, inet) from public, anon, authenticated;
revoke all on function public.rdp_answer_request(uuid, uuid, text, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rdp_end_grant(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.rdp_check_tunnel(text, inet, text) from public, anon, authenticated;
revoke all on function public.rdp_sweep(timestamptz) from public, anon, authenticated;
revoke all on function public.rdp_mark_cut(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.rdp_record_event(text, text, uuid, uuid, inet, text, text) from public, anon, authenticated;
revoke all on function public.rdp_redact_old_ips(timestamptz) from public, anon, authenticated;
revoke all on function public.rdp_access_no_truncate() from public, anon, authenticated;
revoke all on function public.rdp_access_requests_guard() from public, anon, authenticated;
revoke all on function public.rdp_access_grants_guard() from public, anon, authenticated;
revoke all on function public.rdp_access_events_guard() from public, anon, authenticated;

grant execute on function
  public.rdp_log(text, text, uuid, uuid, uuid, inet, text, text, jsonb),
  public.rdp_expire_stale(timestamptz),
  public.rdp_request_access(uuid, text, integer, inet),
  public.rdp_cancel_request(uuid, uuid),
  public.rdp_end_own_grant(uuid),
  public.rdp_begin_file_issue(uuid, inet),
  public.rdp_answer_request(uuid, uuid, text, integer, text, text, jsonb),
  public.rdp_end_grant(uuid, uuid, text),
  public.rdp_check_tunnel(text, inet, text),
  public.rdp_sweep(timestamptz),
  public.rdp_mark_cut(uuid, boolean, text),
  public.rdp_record_event(text, text, uuid, uuid, inet, text, text),
  public.rdp_redact_old_ips(timestamptz)
to service_role;

do $$
declare
  v_bad integer;
begin
  -- every rdp_* function: SECURITY INVOKER, empty search_path, no EXECUTE for browser roles or PUBLIC
  select count(*) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'rdp\_%' escape '\'
     and (p.prosecdef
          or not coalesce(p.proconfig @> array['search_path=""'], false)
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  if v_bad > 0 then
    raise exception 'rdp_access: % function(s) with wrong security properties', v_bad;
  end if;

  -- the callable ones are executable by service_role
  select count(*) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rdp_log', 'rdp_expire_stale', 'rdp_request_access', 'rdp_cancel_request', 'rdp_end_own_grant',
                       'rdp_begin_file_issue', 'rdp_answer_request', 'rdp_end_grant', 'rdp_check_tunnel', 'rdp_sweep',
                       'rdp_mark_cut', 'rdp_record_event', 'rdp_redact_old_ips')
     and not has_function_privilege('service_role', p.oid, 'execute');
  if v_bad > 0 then
    raise exception 'rdp_access: service_role cannot execute % function(s)', v_bad;
  end if;

  if exists (
    select 1 from pg_class c
     where c.oid in ('public.rdp_access_requests'::regclass, 'public.rdp_access_grants'::regclass,
                     'public.rdp_access_events'::regclass)
       and (not c.relrowsecurity
            or has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate')
            or has_table_privilege('authenticated', c.oid, 'insert,update,delete,truncate'))
  ) then
    raise exception 'rdp_access: table ACL or RLS is wrong';
  end if;

  if has_column_privilege('authenticated', 'public.rdp_access_requests'::regclass, 'request_ip', 'select')
     or has_column_privilege('authenticated', 'public.rdp_access_requests'::regclass, 'approver_context', 'select')
     or has_column_privilege('authenticated', 'public.rdp_access_requests'::regclass, 'answered_by', 'select')
     or has_column_privilege('authenticated', 'public.rdp_access_grants'::regclass, 'cut_attempts', 'select')
     or has_table_privilege('authenticated', 'public.rdp_access_events'::regclass, 'select') then
    raise exception 'rdp_access: authenticated can read a column or table it must not';
  end if;

  -- exactly one unique index whose predicate is the active-grant lock
  if (select count(*) from pg_index i
       where i.indrelid = 'public.rdp_access_grants'::regclass
         and i.indisunique
         and i.indpred is not null
         and pg_get_expr(i.indpred, i.indrelid) like '%active%'
         and pg_get_expr(i.indexprs, i.indrelid) is not null) <> 1 then
    raise exception 'rdp_access: the one-active-grant unique index is missing';
  end if;

  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and t.tgname in ('rdp_access_requests_guard', 'rdp_access_grants_guard', 'rdp_access_events_guard',
                          'rdp_access_requests_no_truncate', 'rdp_access_grants_no_truncate',
                          'rdp_access_events_no_truncate')) <> 6 then
    raise exception 'rdp_access: guard triggers missing or disabled';
  end if;

  -- the permission key: held by the owner role only
  if exists (
    select 1 from public.platform_role_permissions rp
      join public.platform_permission_definitions d on d.id = rp.permission_id
      join public.platform_roles r on r.id = rp.role_id
     where d.key = 'rdp.request' and not r.is_owner_role
  ) then
    raise exception 'rdp_access: a non-owner role holds rdp.request by default';
  end if;
  if not exists (
    select 1 from public.platform_role_permissions rp
      join public.platform_permission_definitions d on d.id = rp.permission_id
      join public.platform_roles r on r.id = rp.role_id
     where d.key = 'rdp.request' and r.is_owner_role
  ) then
    raise exception 'rdp_access: the owner role does not hold rdp.request';
  end if;

  if has_function_privilege('authenticated', 'public.is_platform_owner_for_user(uuid)', 'execute')
     or has_function_privilege('anon', 'public.is_platform_owner_for_user(uuid)', 'execute') then
    raise exception 'rdp_access: owner twin executable by a browser role';
  end if;
end
$$;
