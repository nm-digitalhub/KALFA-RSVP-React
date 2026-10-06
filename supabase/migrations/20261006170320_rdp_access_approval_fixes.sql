-- rdp_access_approval_fixes: follow-up to 20261006164315_rdp_access_approval.sql, from an independent review of
-- the applied migration against the live database. Everything below is dormant until a caller exists (the tables
-- are empty and no application code uses them yet), so this is a pure correctness pass before the first caller.
--
-- Blockers fixed
--   B1  rdp_access_events_guard blocked the UPDATE that `ON DELETE SET NULL` performs when an auth user is
--       deleted, so after the first event no user with an event could ever be deleted. It now has the same FK
--       carve-out as the other two guards.
--   B2  rdp_check_tunnel allowed a tunnel when p_target was NULL (`v.target <> NULL` is NULL, the elsif was
--       skipped). The check is now NULL-safe: a NULL or different target is a refusal.
--   B3  rdp_answer_request treated a NULL verdict as an approval (`NULL not in (...)` is NULL). Fixed.
-- Other findings fixed
--   * rdp_expire_stale used to take row locks in an arbitrary order across concurrent callers (possible 40P01).
--     It now locks with FOR NO KEY UPDATE SKIP LOCKED (so a foreign-key check from a concurrent audit insert,
--     which takes KEY SHARE, is not blocked either), so the expiry step itself never waits, and every
--     function that needs the answer re-checks expiry on the row it locks itself, so a skipped row can never be
--     treated as live. A rare deadlock between two DIFFERENT functions that each wait on a row the other's
--     expiry step locked is still possible (40P01): the whole transaction rolls back, and the application
--     wrappers retry once.
--   * rdp_request_access could return `already_pending` with NULL ids when the pending row vanished between the
--     insert and the select; it now retries once and otherwise returns `busy`.
--   * rdp_answer_request: oversized approver context no longer raises a raw CHECK error; a `unique_violation`
--     that is NOT the one-active-grant lock (decided by constraint name) is re-raised instead of being reported as a
--     conflict; an expired-but-unmarked competing grant is marked and the insert retried once, otherwise `busy`;
--     the port must be 1..65535; an empty note is stored as NULL.
--   * rdp_mark_cut no longer overwrites a grant that is already confirmed cut.
--   * The FK carve-outs of the requests and grants guards could null one FK column while changing another; each
--     column may now only stay as it is or become NULL. A grant that is still active can no longer be given an
--     ended_by / ended_reason / disconnect bookkeeping.
--   * Missing CHECKs: port <= 65535, files_issued <= max_files, ended_reason <-> status, ended_at >= starts_at,
--     non-negative disconnect counters.
--   * rdp_access_events.at uses clock_timestamp() so events of one transaction keep their real order.
--
-- Function signatures are unchanged, so CREATE OR REPLACE keeps every existing ACL (service_role only).
-- Rollback: re-create the previous function bodies from 20261006164315 (also rdp_end_own_grant, rdp_end_grant and
-- rdp_sweep, replaced here only to keep ended_at >= starts_at) and drop the five added constraints
-- (rdp_access_grants_target_port, _files_within_max, _ended_reason_consistency, _ended_after_start, _cut_counters)
-- and reset the events default to now().

-- 1. Constraints and default (the tables are empty, so adding them cannot fail on existing rows).
alter table public.rdp_access_events alter column at set default clock_timestamp();

alter table public.rdp_access_grants
  add constraint rdp_access_grants_target_port check (
    case when split_part(target, ':', 2) ~ '^[0-9]{1,5}$'
         then split_part(target, ':', 2)::integer between 1 and 65535
         else false end),
  add constraint rdp_access_grants_files_within_max check (files_issued <= max_files),
  -- coalesce(.., false): a CHECK only fails on FALSE, and (status, NULL) evaluates to NULL, which would pass
  add constraint rdp_access_grants_ended_reason_consistency check (coalesce(
    (status = 'active'  and ended_reason is null)
    or (status = 'expired' and ended_reason = 'expired')
    or (status = 'ended'   and ended_reason = 'ended_by_user')
    or (status = 'revoked' and ended_reason in ('revoked_by_owner', 'access_removed')), false)),
  add constraint rdp_access_grants_ended_after_start check (ended_at is null or ended_at >= starts_at),
  add constraint rdp_access_grants_cut_counters check (cut_attempts >= 0 and cut_ok_count >= 0);

-- 2. Guards
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

  -- FK ON DELETE SET NULL carve-out: each FK column may only stay as it is or become NULL, and at least one did
  if (new.requester_id is not distinct from old.requester_id or (new.requester_id is null and old.requester_id is not null))
     and (new.answered_by is not distinct from old.answered_by or (new.answered_by is null and old.answered_by is not null))
     and (new.requester_id is distinct from old.requester_id or new.answered_by is distinct from old.answered_by)
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

  -- FK ON DELETE SET NULL carve-out: each FK column may only stay as it is or become NULL, and at least one did
  if (new.user_id is not distinct from old.user_id or (new.user_id is null and old.user_id is not null))
     and (new.granted_by is not distinct from old.granted_by or (new.granted_by is null and old.granted_by is not null))
     and (new.ended_by is not distinct from old.ended_by or (new.ended_by is null and old.ended_by is not null))
     and (new.user_id is distinct from old.user_id or new.granted_by is distinct from old.granted_by
          or new.ended_by is distinct from old.ended_by)
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
      -- while active only the download counters change
      if new.ended_at is not null or new.ended_by is not null or new.ended_reason is not null
         or new.cut_attempts <> old.cut_attempts
         or new.cut_ok_count <> old.cut_ok_count
         or new.last_cut_at is distinct from old.last_cut_at
         or new.last_cut_error is distinct from old.last_cut_error
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

create or replace function public.rdp_access_events_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- retention: the IP may be nulled under the retention GUC, and nothing else changes
  if tg_op = 'UPDATE' and new.client_ip is null and old.client_ip is not null
     and coalesce(current_setting('app.rdp_redact_ips', true), '') = 'on'
     and (to_jsonb(new) - 'client_ip') = (to_jsonb(old) - 'client_ip') then
    return new;
  end if;
  -- FK ON DELETE SET NULL (a deleted auth user nulls actor_id, nothing else)
  if tg_op = 'UPDATE' and new.actor_id is null and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'rdp_access_events: append-only (% blocked)', tg_op;
end
$$;

-- 3. Functions

-- Expiry NEVER depends on the sweep, and this step never waits on another transaction: rows locked elsewhere are
-- skipped (their owner is already handling them) and every caller that needs the answer re-checks expires_at on
-- the row it locks itself. (Rows this step locks stay locked until the caller commits.)
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
     where r.id in (
             select x.id from public.rdp_access_requests x
              where x.status = 'pending' and x.expires_at <= p_now
              order by x.id
                for no key update skip locked)
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
     where x.id in (
             select y.id from public.rdp_access_grants y
              where y.status = 'active' and y.expires_at <= p_now
              order by y.id
                for no key update skip locked)
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

  -- expires_at is checked here too: a grant skipped by the sweep (locked elsewhere) is not live
  if exists (select 1 from public.rdp_access_grants g
              where g.user_id = p_user_id and g.status = 'active' and g.expires_at > now()) then
    return query select 'has_active_grant'::text, null::uuid, null::timestamptz;
    return;
  end if;

  -- durable rate limit (the web rate limiter is per-process and resets on restart)
  if (select count(*) from public.rdp_access_requests r
       where r.requester_id = p_user_id and r.created_at > now() - interval '1 hour') >= 6 then
    return query select 'rate_limited'::text, null::uuid, null::timestamptz;
    return;
  end if;

  for attempt in 1..2 loop
    insert into public.rdp_access_requests (requester_id, reason, requested_minutes, request_ip)
    values (p_user_id, btrim(p_reason), p_minutes, p_client_ip)
    on conflict (requester_id) where status = 'pending' do nothing
    returning * into v;

    if found then
      perform public.rdp_log('requested', 'staff', p_user_id, v.id, null, p_client_ip, null, 'pending',
                             jsonb_build_object('minutes', p_minutes));
      return query select 'created'::text, v.id, v.expires_at;
      return;
    end if;

    -- idempotent double-submit / two tabs
    select * into v from public.rdp_access_requests r
     where r.requester_id = p_user_id and r.status = 'pending' and r.expires_at > now();
    if found then
      return query select 'already_pending'::text, v.id, v.expires_at;
      return;
    end if;
    -- the pending row vanished (cancelled or expired) between the insert and the select: try once more
  end loop;

  return query select 'busy'::text, null::uuid, null::timestamptz;
end
$$;

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

  -- expires_at is re-checked on the row this function locks itself
  select * into g from public.rdp_access_grants x
   where x.user_id = p_user_id and x.status = 'active' and x.expires_at > now()
   for no key update;
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
  v       public.rdp_access_requests%rowtype;
  v_grant uuid;
  v_exp   timestamptz;
  v_conf  uuid;
  v_ctx   jsonb;
  v_note  text;
  v_constraint text;
  v_conf_req   uuid;
  v_conf_exp   timestamptz;
begin
  if not public.is_platform_owner_for_user(p_actor_id) then
    return query select 'not_owner'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  -- NULL-safe: `NULL not in (...)` is NULL, which would have fallen through to the approval path
  if p_verdict is null or p_verdict not in ('approved', 'denied') then
    return query select 'invalid_verdict'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  perform public.rdp_expire_stale();   -- before taking the row lock

  select * into v from public.rdp_access_requests r where r.id = p_request_id for no key update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  -- expired but not marked yet (its row was locked elsewhere during the sweep): mark it here and refuse
  if v.status = 'pending' and v.expires_at <= now() then
    update public.rdp_access_requests r set status = 'expired' where r.id = v.id;
    perform public.rdp_log('request_expired', 'system', null, v.id, null, null, null, 'expired', '{}'::jsonb);
    return query select 'expired'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if v.status <> 'pending' then
    return query select (case when v.status = 'expired' then 'expired' else 'not_pending' end)::text,
                        null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  v_note := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  -- an oversized context must not turn into a raw CHECK error; keep a marker instead
  v_ctx := case when p_context is null or octet_length(p_context::text) <= 1000 then p_context
                else jsonb_build_object('truncated', true) end;

  if p_verdict = 'denied' then
    update public.rdp_access_requests r
       set status = 'denied', answered_by = p_actor_id, answered_at = now(),
           answer_note = v_note, approver_context = v_ctx
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
  if split_part(p_target, ':', 2)::integer not between 1 and 65535 then
    return query select 'invalid_target'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;
  if v.requester_id is null or not public.has_platform_permission_for_user(v.requester_id, 'rdp.request') then
    return query select 'requester_not_allowed'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  for v_try in 1..2 loop
    begin
      insert into public.rdp_access_grants (request_id, user_id, granted_by, target, expires_at)
      values (v.id, v.requester_id, p_actor_id, p_target, now() + make_interval(mins => p_minutes))
      returning id, public.rdp_access_grants.expires_at into v_grant, v_exp;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- only the one-active-grant lock is a "conflict"; anything else is a real error and must surface
      if v_constraint is distinct from 'rdp_access_grants_one_active_uq' then
        raise;
      end if;
      select x.id, x.request_id, x.expires_at into v_conf, v_conf_req, v_conf_exp
        from public.rdp_access_grants x where x.status = 'active';
      if v_conf is not null and v_conf_exp <= now() then
        -- expired but not marked yet (the sweep skipped its locked row): mark it here and try again
        update public.rdp_access_grants x
           set status = 'expired', ended_at = x.expires_at, ended_reason = 'expired'
         where x.id = v_conf and x.status = 'active';
        if found then   -- a concurrent transaction may have marked it first: then it already wrote its own event
          perform public.rdp_log('grant_expired', 'system', null, v_conf_req, v_conf, null, null, 'expired', '{}'::jsonb);
        end if;
        v_conf := null;
      end if;
      if v_conf is not null then
        return query select 'grant_conflict'::text, null::uuid, null::timestamptz, v_conf;
        return;
      end if;
      -- the competing grant ended between the failure and the lookup: try once more
    end;
  end loop;

  if v_grant is null then
    return query select 'busy'::text, null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  update public.rdp_access_requests r
     set status = 'approved', answered_by = p_actor_id, answered_at = now(),
         granted_minutes = p_minutes, answer_note = v_note, approver_context = v_ctx
   where r.id = v.id;

  perform public.rdp_log('approved', 'owner_cli', p_actor_id, v.id, v_grant, null, null, 'approved',
                         jsonb_build_object('minutes', p_minutes, 'self_approved', v.requester_id = p_actor_id));
  return query select 'approved'::text, v_grant, v_exp, null::uuid;
end
$$;

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
  -- NULL-safe: `v.target <> NULL` is NULL, which used to skip this branch and reach the allow path
  elsif p_target is null or v.target is distinct from p_target then
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

-- Disconnect bookkeeping. tunnels_cut_at is set only after TWO successful disconnects at least 45 seconds apart
-- (closes the check-allow -> revoke -> connect window). A grant already confirmed cut is left alone.
create or replace function public.rdp_mark_cut(p_grant_id uuid, p_ok boolean, p_error_code text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  g public.rdp_access_grants%rowtype;
begin
  select * into g from public.rdp_access_grants x
   where x.id = p_grant_id and x.status <> 'active' and x.tunnels_cut_at is null
   for no key update;
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

-- ended_at must never precede starts_at: now() is the START of the ending transaction, which can be earlier than
-- the grant it ends when both happen in the same instant. These three functions are otherwise unchanged.
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
     set status = 'ended', ended_at = greatest(now(), g.starts_at), ended_by = p_user_id, ended_reason = 'ended_by_user'
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
     set status = 'revoked', ended_at = greatest(now(), g.starts_at), ended_by = p_actor_id, ended_reason = 'revoked_by_owner'
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
       set status = 'revoked', ended_at = greatest(p_now, g.starts_at), ended_reason = 'access_removed'
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

-- 4. Self-verification: the security properties must still hold after the replacements, and the new
--    constraints must exist. If anything is off the whole migration aborts.
do $$
declare
  v_bad integer;
begin
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
    raise exception 'rdp_access_fixes: % function(s) with wrong security properties', v_bad;
  end if;

  select count(*) into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('rdp_log', 'rdp_expire_stale', 'rdp_request_access', 'rdp_cancel_request', 'rdp_end_own_grant',
                       'rdp_begin_file_issue', 'rdp_answer_request', 'rdp_end_grant', 'rdp_check_tunnel', 'rdp_sweep',
                       'rdp_mark_cut', 'rdp_record_event', 'rdp_redact_old_ips')
     and not has_function_privilege('service_role', p.oid, 'execute');
  if v_bad > 0 then
    raise exception 'rdp_access_fixes: service_role lost EXECUTE on % function(s)', v_bad;
  end if;

  if (select count(*) from pg_constraint c
       where c.conrelid = 'public.rdp_access_grants'::regclass
         and c.conname in ('rdp_access_grants_target_port', 'rdp_access_grants_files_within_max',
                           'rdp_access_grants_ended_reason_consistency', 'rdp_access_grants_ended_after_start',
                           'rdp_access_grants_cut_counters')) <> 5 then
    raise exception 'rdp_access_fixes: the added CHECK constraints are missing';
  end if;

  if (select count(*) from pg_trigger t
       where not t.tgisinternal and t.tgenabled = 'O'
         and t.tgname in ('rdp_access_requests_guard', 'rdp_access_grants_guard', 'rdp_access_events_guard',
                          'rdp_access_requests_no_truncate', 'rdp_access_grants_no_truncate',
                          'rdp_access_events_no_truncate')) <> 6 then
    raise exception 'rdp_access_fixes: guard triggers missing or disabled';
  end if;

  -- pin that the blocker fixes are really in the stored function bodies
  if position('new.actor_id' in pg_get_functiondef('public.rdp_access_events_guard()'::regprocedure)) = 0 then
    raise exception 'rdp_access_fixes: B1 (events guard FK carve-out) is not in place';
  end if;
  if position('p_target is null' in pg_get_functiondef('public.rdp_check_tunnel(text, inet, text)'::regprocedure)) = 0 then
    raise exception 'rdp_access_fixes: B2 (NULL-safe target check) is not in place';
  end if;
  if position('p_verdict is null' in pg_get_functiondef(
       'public.rdp_answer_request(uuid, uuid, text, integer, text, text, jsonb)'::regprocedure)) = 0 then
    raise exception 'rdp_access_fixes: B3 (NULL-safe verdict) is not in place';
  end if;
end
$$;
