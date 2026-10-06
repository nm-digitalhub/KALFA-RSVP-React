-- Two ops health checks that report a fault when there is none.
--
-- Measured on the live database 2026-09-10, from a Debug Mode badge that was red
-- for five reasons, none of which was a real fault. A status light that cries wolf
-- gets ignored, and then it does not help on the day something actually breaks.
--
-- ---------------------------------------------------------------------------
-- 1. ops_db_health: "long query: 526s" was Supabase Realtime, not a query
-- ---------------------------------------------------------------------------
-- `longest_query_seconds` scanned every backend with state='active'. MEASURED, the
-- longest was:
--
--   backend_type = 'walsender', state = 'active', wait_event = WalSenderWaitForWal
--   START_REPLICATION SLOT supabase_realtime_messages_replication_slot_… LOGICAL
--
-- A logical replication connection is SUPPOSED to be open forever and idle-waiting
-- for WAL; its query_start is when the stream opened. Reporting its age as a slow
-- query means the number climbs all day and crosses the 300s error threshold every
-- time, permanently. Postgres already separates these for us — `backend_type` — so
-- the fix is one predicate, not a heuristic on the query text.
--
-- 'client backend' also excludes autovacuum workers, the pg_cron launcher, the
-- logical replication launcher, checkpointer, walwriter and the pg_net worker,
-- every one of which is long-lived by design and none of which is a query anyone
-- can act on.
--
-- ---------------------------------------------------------------------------
-- 2. ops_job_health: "no run in time" for a job whose first run is still ahead
-- ---------------------------------------------------------------------------
-- The caller flags a queue as stale when `last_completed_on` is null. That is right
-- for a queue that should have run and did not, and wrong for one REGISTERED LAST
-- WEEK whose cron has not come round yet. Measured, both offenders:
--
--   seo-technical-watch  cron '0 9 * * 1' (Mon 09:00)  registered Mon 7.9 22:51
--   supabase-cli-update  cron '20 5 * * 0' (Sun 05:20) registered Tue 8.9 23:31
--
-- Today is Thursday 10.9. Neither weekday has occurred since registration, so ZERO
-- runs have been missed — confirmed twice: by generate_series over the interval, and
-- by cron-parser (the very library pg-boss uses to schedule them) reporting first-due
-- 14.9 and 13.9.
--
-- The caller cannot tell "never ran" from "not due yet" without knowing WHEN the
-- schedule was registered, so this returns it. `pgboss.schedule.created_on` is the
-- honest reference point: before it, no run was ever expected.
--
-- Both functions keep `is_platform_owner()` and `search_path = ''` exactly as they
-- were; only the query bodies and one added output column change.
--
-- ROLLBACK: re-create both from the previous definitions (git history) — the added
-- column is additive, so a rollback of ops_job_health also needs the TypeScript
-- caller reverted, or it will select a column that no longer exists.

create or replace function public.ops_db_health()
returns table(
  active_connections integer,
  max_connections integer,
  index_hit_rate_pct numeric,
  table_hit_rate_pct numeric,
  longest_query_seconds numeric,
  top_queries jsonb
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_active int;
  v_max int;
  v_idx_hit numeric;
  v_tbl_hit numeric;
  v_longest numeric;
  v_top jsonb;
begin
  if not public.is_platform_owner() then
    raise exception 'ops_db_health: platform owner only';
  end if;

  select count(*) into v_active from pg_catalog.pg_stat_activity;

  select setting::int into v_max
  from pg_catalog.pg_settings where name = 'max_connections';

  select
    (sum(idx_blks_hit))::numeric / nullif(sum(idx_blks_hit + idx_blks_read), 0) * 100
  into v_idx_hit
  from pg_catalog.pg_statio_user_indexes;

  select
    sum(heap_blks_hit)::numeric / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) * 100
  into v_tbl_hit
  from pg_catalog.pg_statio_user_tables;

  -- backend_type = 'client backend' is the change. See the header: walsender and the
  -- background workers are long-lived by design, and counting their age as query
  -- latency pinned this metric above the error threshold permanently.
  -- clock_timestamp(), not now(): now() is the TRANSACTION start, so a backend whose
  -- query began after this transaction opened measures as negative age (the dry run
  -- returned -0.104s). greatest(…, 0) keeps a rounding race from surfacing either.
  select greatest(extract(epoch from max(clock_timestamp() - query_start)), 0)
  into v_longest
  from pg_catalog.pg_stat_activity
  where state = 'active'
    and backend_type = 'client backend'
    and pid <> pg_backend_pid();

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_top
  from (
    select
      query,
      calls,
      round(mean_exec_time::numeric, 2)  as mean_exec_time_ms,
      round(total_exec_time::numeric, 2) as total_exec_time_ms
    from extensions.pg_stat_statements
    where query not ilike '%pg_stat_statements%'
    order by total_exec_time desc
    limit 5
  ) x;

  return query select v_active, v_max, v_idx_hit, v_tbl_hit, v_longest, v_top;
end;
$function$;

-- Adding an OUT column changes the return type, which `create or replace` cannot do
-- (42P13). Dropping also drops the ACL, so it is restored verbatim below — MEASURED
-- before the drop: {postgres=X/postgres, service_role=X/postgres, authenticated=X/postgres},
-- i.e. EXECUTE to authenticated and service_role, nothing to anon. The function gates
-- on is_platform_owner() internally regardless.
drop function if exists public.ops_job_health();

create function public.ops_job_health()
returns table(
  queue_name text,
  is_scheduled boolean,
  cron text,
  schedule_tz text,
  schedule_created_on timestamp with time zone,
  queued_count integer,
  active_count integer,
  failed_count integer,
  total_count integer,
  last_completed_on timestamp with time zone,
  oldest_pending_on timestamp with time zone
)
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_platform_owner() then
    raise exception 'ops_job_health: platform owner only';
  end if;

  return query
  select
    q.name,
    (s.name is not null),
    s.cron,
    s.timezone,
    -- Added 2026-09-10. Without it the caller cannot tell a queue that MISSED its
    -- run from one registered days ago whose cron has not come round yet, and it
    -- reported the second as the first.
    s.created_on,
    q.queued_count,
    q.active_count,
    q.failed_count,
    q.total_count,
    lc.last_completed_on,
    lp.oldest_pending_on
  from pgboss.queue q
  left join pgboss.schedule s on s.name = q.name
  left join lateral (
    select max(j.completed_on) as last_completed_on
    from pgboss.job_common j
    where j.name = q.name and j.state = 'completed'
  ) lc on true
  left join lateral (
    select min(j.created_on) as oldest_pending_on
    from pgboss.job_common j
    where j.name = q.name and j.state in ('created', 'retry')
  ) lp on true
  order by q.name;
end;
$function$;

-- FROM PUBLIC, not just anon. `create function` grants EXECUTE to PUBLIC by default,
-- and the dry run caught exactly that: the ACL came back as
--   {=X/postgres, postgres=…, authenticated=…, service_role=…}
-- where the leading `=X` is PUBLIC. The original had no PUBLIC entry, so revoking
-- only `anon` (which merely INHERITS from PUBLIC) would have silently widened the
-- function to every role in the database.
-- BOTH. Two independent sources widen a freshly created function here:
--   * `create function` grants EXECUTE to PUBLIC (Postgres default), and
--   * Supabase's ALTER DEFAULT PRIVILEGES grants it to `anon`.
-- The dry run caught them one at a time — first `{=X/postgres,…}` (PUBLIC), then
-- `{…,anon=X/postgres,…}` after only PUBLIC was revoked. The pre-drop ACL had
-- NEITHER, so both come off to land byte-identical to what was there before.
revoke execute on function public.ops_job_health() from public, anon;
grant execute on function public.ops_job_health() to authenticated, service_role;
