-- =====================================================================
-- workflow_run_events — the execution event stream
--
-- The vendored runGraph already emits exactly the events the reference app's
-- live canvas feedback consumes (execution_started, node_started,
-- node_completed, node_failed, node_skipped, and the four terminal events). Up
-- to now our EventEmitterPort discarded them: per-node facts were durable in
-- workflow_run_steps, which is enough to know WHAT happened but not enough to
-- replay a run onto the canvas in order.
--
-- This table is that stream. It is what the SSE endpoint serves and what
-- ExecutionHighlighting / ExecutionLogPanel / ExecutionNodeMarkers read.
--
-- WHY A SEPARATE TABLE FROM workflow_run_steps. They answer different
-- questions and one cannot serve the other:
--   * workflow_run_steps is the IDEMPOTENCY LEDGER — one row per node, unique
--     (run_id, node_id), claimed before the side effect. It is a set.
--   * workflow_run_events is a LOG — append-only, ordered, and a node legitimately
--     appears in it more than once (a pg-boss retry replays the whole graph, so
--     node_started fires again even when the step short-circuits).
-- Folding them together would either break the unique constraint that stops a
-- second send, or lose the ordering the canvas replays from.
--
-- SEQUENCE. `seq` is a global bigserial rather than a per-run counter: the
-- runner calls emitEvent with no sequence, and a per-run counter would need its
-- own allocation with its own race. Ordering is per-run by seq, which is all the
-- consumer needs, and `ExecutionSnapshot.lastSequence` maps onto it directly.
--
-- PII. Payloads carry `config` and node `output` — for us that means the guest's
-- message text and a guest id. The runner's own `withRedactedPayloads` runs
-- first but is KEY-BASED and masks secrets (apiKey, token, password), NOT
-- personal data. So this column holds guest PII exactly like
-- workflow_run_steps.output, and belongs to the same retention window
-- (plan §6.4). It is admin-read-only for the same reason.
--
-- ROLLBACK: drop table if exists public.workflow_run_events;
-- =====================================================================

create table if not exists public.workflow_run_events (
  seq        bigserial primary key,
  run_id     uuid not null references public.workflow_runs(id) on delete cascade,
  -- ExecutionEventType in the vendored
  -- types/workflow-execution/execution-events.ts. A check constraint rather than
  -- an enum so the list stays greppable against the file it mirrors; 'node_waiting',
  -- 'branch_spawned' and 'branches_joined' are declared upstream and accepted
  -- here even though this runner never emits them — rejecting an event the
  -- vendored runner might emit after a re-sync would fail a run over a log line.
  type       text not null,
  -- Absent on run-level events (execution_started and the terminal four).
  node_id    text,
  payload    jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_run_events_type_known check (
    type in (
      'execution_started', 'execution_completed', 'execution_incomplete',
      'execution_failed', 'execution_cancelled',
      'node_started', 'node_completed', 'node_failed', 'node_skipped',
      'node_waiting', 'branch_spawned', 'branches_joined'
    )
  )
);

comment on table public.workflow_run_events is
  'Append-only execution event log per run, in emit order. Feeds the live canvas replay (SSE). Distinct from workflow_run_steps, which is the per-node idempotency ledger. Payloads carry guest PII — same retention window.';
comment on column public.workflow_run_events.seq is
  'Global monotonic order. Read per-run as `order by seq`; maps onto ExecutionSnapshot.lastSequence.';

-- The only access pattern: one run's events in order, optionally after a cursor.
create index if not exists workflow_run_events_run_seq_idx
  on public.workflow_run_events (run_id, seq);

alter table public.workflow_run_events enable row level security;

revoke all on public.workflow_run_events from anon, authenticated;
-- Read-only to the session client, like workflow_runs and workflow_run_steps:
-- only the worker (service_role) appends. An admin may watch what happened,
-- never author it.
grant select on public.workflow_run_events to authenticated;

drop policy if exists workflow_run_events_admin_read on public.workflow_run_events;
create policy workflow_run_events_admin_read
  on public.workflow_run_events for select
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)));
