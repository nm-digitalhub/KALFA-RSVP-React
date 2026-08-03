-- =====================================================================
-- Debug Mode — unified ops layer (Frontend · Database · Server Health).
-- Read-only diagnostics for a single admin page (/admin/debug). See the
-- approved plan (breezy-frolicking-scott) for the full design.
--
-- Three pieces:
--   1. public.ops_errors      — append-only server-error log, written by
--      src/instrumentation.ts BEFORE (and independent of) the Slack alert
--      gates, so a disabled/deduped/rate-capped alert still leaves a row.
--      ops_alerts (20260713022924_slack_ops_alerting_config.sql) is a
--      *delivery* log, not an error log — this table exists specifically to
--      hold the fields that alert never persists: exact route, error name,
--      digest, deploy id. NEVER error.message — same PII reasoning already
--      documented in instrumentation.ts (Zod/DB-constraint text can embed
--      personal data).
--   2. public.ops_job_health() — reads pg-boss's live per-queue counters
--      (pgboss.queue) and schedule catalog (pgboss.schedule) directly. A
--      SECURITY DEFINER RPC is required because the `pgboss` schema is not
--      exposed through PostgREST at all (verified: absent from the generated
--      types, only `public` + `graphql_public` are). This does NOT open a
--      pg-boss/pg client from the web tier — it is a single SQL statement
--      wrapped as a function, so the web tier gains zero new outbound
--      Postgres connections.
--   3. public.ops_db_health()  — connection count vs max_connections, cache
--      hit ratios, longest-running query, and top pg_stat_statements
--      outliers (installed, extension schema `extensions`).
--
-- Both RPCs and the table are gated to the PLATFORM OWNER only
-- (public.is_platform_owner(), see 20260713171233_platform_rbac_owner_staff.sql)
-- — a deliberate, narrower bar than the manage_settings permission the other
-- admin diagnostic pages (webhooks/alerts/fleet) use, because this page
-- surfaces raw server internals (process names, ports, file paths).
-- =====================================================================

-- --- 1. append-only server-error log ---------------------------------------

create table if not exists public.ops_errors (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  route_path  text,
  route_type  text,
  method      text,
  error_name  text,
  digest      text,
  deploy_id   text,
  runtime     text,
  occurrences integer not null default 1
);

comment on table public.ops_errors is
  'Append-only server-error log written by src/instrumentation.ts onRequestError, '
  'independent of the Slack ops-alerting gates. No error.message / headers / body — '
  'PII-safe by construction, mirrors the redaction discipline in src/lib/alerts/slack.ts.';

create index if not exists ops_errors_occurred_at_idx
  on public.ops_errors (occurred_at desc);

create index if not exists ops_errors_route_path_occurred_at_idx
  on public.ops_errors (route_path, occurred_at desc);

alter table public.ops_errors enable row level security;

-- Writes happen only via the service-role client (instrumentation.ts runs on
-- the server, never in a browser context) — RLS on INSERT is defense in depth,
-- not the primary control, mirroring ops_alerts' own comment.
revoke all on table public.ops_errors from anon, authenticated;
grant select on table public.ops_errors to authenticated;

drop policy if exists ops_errors_owner_select on public.ops_errors;
create policy ops_errors_owner_select on public.ops_errors
  for select to authenticated
  using (public.is_platform_owner());

-- Deliberately no insert/update/delete policy for `authenticated` — append-only,
-- service-role bypasses RLS for the one write path that exists.

-- --- 2. pg-boss job/queue health --------------------------------------------

create or replace function public.ops_job_health()
returns table (
  queue_name         text,
  is_scheduled       boolean,
  cron               text,
  schedule_tz        text,
  queued_count       integer,
  active_count       integer,
  failed_count       integer,
  total_count        integer,
  last_completed_on  timestamptz,
  oldest_pending_on  timestamptz
)
language plpgsql security definer set search_path to '' as $$
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
$$;

comment on function public.ops_job_health() is
  'Platform-owner-only. Reads pg-boss live queue counters + schedule catalog '
  'directly (pgboss schema is not exposed via PostgREST). Queues with '
  'is_scheduled = false (outreach-step / outreach-call-request / outreach-dead) '
  'are event-driven by design — a long idle period is NOT staleness for them.';

revoke all on function public.ops_job_health() from public, anon, authenticated;
grant execute on function public.ops_job_health() to authenticated;

-- --- 3. Postgres health ------------------------------------------------------

create or replace function public.ops_db_health()
returns table (
  active_connections     integer,
  max_connections        integer,
  index_hit_rate_pct     numeric,
  table_hit_rate_pct     numeric,
  longest_query_seconds  numeric,
  top_queries            jsonb
)
language plpgsql security definer set search_path to '' as $$
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

  select extract(epoch from max(now() - query_start))
  into v_longest
  from pg_catalog.pg_stat_activity
  where state = 'active' and pid <> pg_backend_pid();

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
$$;

comment on function public.ops_db_health() is
  'Platform-owner-only. pg_stat_statements query text is normalized by Postgres '
  '($1 placeholders) — no literal parameter values, so no PII risk.';

revoke all on function public.ops_db_health() from public, anon, authenticated;
grant execute on function public.ops_db_health() to authenticated;
