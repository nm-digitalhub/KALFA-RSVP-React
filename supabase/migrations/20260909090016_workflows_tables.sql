-- =====================================================================
-- workflows / workflow_runs / workflow_run_steps
--
-- Step 1 of docs/workflow-editor-plan-2026-09-09.md: storage for
-- admin-authored automation graphs and their execution record.
--
--   workflows           one row per saved diagram (the editor's JSON verbatim)
--   workflow_runs       one row per execution
--   workflow_run_steps  one row per node within a run — the idempotency ledger
--
-- WHY THE STEP TABLE EXISTS AT ALL. The vendored runner (runGraph,
-- src/lib/workflow/vendor/workflowbuilder/execution-core/graph-runner.ts)
-- keeps NO per-node checkpoint: it resolves the start node and drives waves
-- with Promise.all until the graph ends. pg-boss is at-least-once, so a
-- retried job replays the WHOLE graph from the start node, side effects
-- included. The only thing that can stop a second send is the database
-- refusing the second write — hence
--   unique (run_id, node_id)
-- on workflow_run_steps. The step handler claims that row BEFORE its side
-- effect; a unique violation means another attempt owns the node and is read
-- as such, never swallowed. Drop that constraint and two concurrent attempts
-- both insert and both send.
--
-- CASCADE DIRECTION, deliberate (precedent: the 2026-07-13 RLS audit, where a
-- CASCADE FK would have wiped billing audit rows):
--   * workflows.event_id -> events(id)          ON DELETE SET NULL
--       event_id is nullable BY DESIGN (a workflow is global or scoped to one
--       event), so an event's deletion un-scopes the workflow rather than
--       destroying it.
--   * workflow_runs.workflow_id -> workflows(id) ON DELETE RESTRICT
--       Runs are the audit record of what the automation actually did to
--       guests. CLAUDE.md requires preserving auditability for administrator
--       actions, so deleting a workflow that has ever run is refused. Deleting
--       history is a retention decision, never a side effect of tidying the
--       editor.
--   * workflow_run_steps.run_id -> workflow_runs(id) ON DELETE CASCADE
--       Steps have no meaning apart from their run, and the run is the unit a
--       retention sweep will delete (step output is guest PII — plan §6.4).
--
-- SAFETY DEFAULT. is_active defaults to FALSE: drawn is not armed. A
-- half-finished graph saved by the editor's auto-save must not begin firing on
-- live inbound WhatsApp. Arming is a separate, deliberate write.
--
-- Access model (mirrors channels, 20260726111038, tightened):
--   * Everything here is admin-only. Unlike channels this is NOT public
--     display metadata — `definition` is automation configuration and
--     workflow_run_steps holds guest PII in `output`. There is no broad
--     authenticated SELECT.
--   * Admin reads/writes flow through the cookie client, so `authenticated`
--     holds the GRANTs and the has_role policy gates them. A column without a
--     GRANT fails 42501 even with a perfect policy.
--   * The worker uses service_role, which RLS does not apply to; it is
--     deliberately granted nothing here beyond Postgres's own service_role
--     defaults, and writes runs/steps. `authenticated` gets no write on
--     runs/steps at all — an admin may read the record, never forge it.
--   * anon: everything revoked, no policy. No public flow touches these.
--
-- has_role signature (VERIFIED-LIVE pg_catalog 2026-09-09):
--   public.has_role(_user_id uuid, _role app_role) returns boolean [SECDEF, STABLE]
-- Predicates use the initplan-wrapped form (audit migration 20260713143941)
-- so the auth expression is hoisted to one per-statement InitPlan.
--
-- ROLLBACK:
--   drop table if exists public.workflow_run_steps;
--   drop table if exists public.workflow_runs;
--   drop trigger if exists workflows_set_updated_at on public.workflows;
--   drop table if exists public.workflows;
--   Safe — nothing outside src/lib/workflow references these tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------
create table if not exists public.workflows (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events(id) on delete set null,
  name        text not null,
  -- The editor's format verbatim: { name, layoutDirection, nodes, edges }.
  -- Stored as-is so a re-open is byte-faithful; the adapter — never the
  -- reader — is what turns it into an execution model.
  definition  jsonb not null default '{}'::jsonb,
  -- Drawn is not armed. See SAFETY DEFAULT above.
  is_active   boolean not null default false,
  -- Bumped by every save. Auto-save writes at a rate we do not control
  -- (savingParams.isAutoSave), so a save carries the version it read and a
  -- stale write can be rejected rather than silently clobbering.
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workflows_name_not_blank check (btrim(name) <> ''),
  constraint workflows_definition_is_object check (jsonb_typeof(definition) = 'object'),
  constraint workflows_version_positive check (version > 0)
);

comment on table public.workflows is
  'Admin-authored automation graphs. definition holds the workflowbuilder editor JSON verbatim; is_active defaults false so a saved graph is not an armed graph. See docs/workflow-editor-plan-2026-09-09.md.';
comment on column public.workflows.definition is
  'Editor format verbatim: { name, layoutDirection, nodes, edges }. Never read directly for execution — src/lib/workflow/adapter converts it and applies the eight conversion rules.';
comment on column public.workflows.is_active is
  'Armed. FALSE by default: a half-drawn graph saved by auto-save must never fire on live inbound WhatsApp.';

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

-- Trigger lookup reads only armed workflows; partial so the index stays the
-- size of the armed set rather than the table.
create index if not exists workflows_active_idx
  on public.workflows (id) where is_active;

create index if not exists workflows_event_id_idx
  on public.workflows (event_id) where event_id is not null;

-- ---------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------
create table if not exists public.workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references public.workflows(id) on delete restrict,
  event_id      uuid references public.events(id) on delete set null,
  -- Status vocabulary is the vendored one, not ours:
  -- ExecutionStatus in vendor/workflowbuilder/types/workflow-execution/
  -- execution-events.ts = 'pending'|'running'|'cancelling' + the four
  -- TERMINAL_EXECUTION_STATUSES. Kept as a check constraint rather than an
  -- enum so the tuple stays greppable next to the file it mirrors.
  status        text not null default 'pending',
  -- What asked for this run. Free text rather than an enum: the set grows with
  -- every new trigger node type, and this column is for reading a log, not for
  -- branching.
  trigger_source text not null,
  -- The payload that started the run, exactly as received. Feeds
  -- ExecutionContext.triggerPayload.
  trigger_payload jsonb not null default '{}'::jsonb,
  -- Idempotency at the RUN level, one layer above the per-node ledger below.
  -- The webhook drain derives this from the inbox row so that Meta's retries
  -- of the same delivery produce one run, not several. NULL for a run with no
  -- natural key (a manual test run).
  dedupe_key    text,
  error_message text,
  created_at    timestamptz not null default now(),
  -- Stamped by the store when the status becomes terminal, and nowhere else. A
  -- terminal status with a null finished_at is a bug in the store, not a state
  -- the engine can reach.
  finished_at   timestamptz,
  constraint workflow_runs_status_known check (
    status in ('pending','running','cancelling','completed','incomplete','failed','cancelled')
  ),
  constraint workflow_runs_trigger_source_not_blank check (btrim(trigger_source) <> ''),
  constraint workflow_runs_payload_is_object check (jsonb_typeof(trigger_payload) = 'object')
);

comment on table public.workflow_runs is
  'One execution of a workflow. The audit record of what an automation did — workflow deletion is RESTRICTed against it rather than cascading.';
comment on column public.workflow_runs.dedupe_key is
  'Run-level idempotency. The webhook drain derives it from the inbox row so a Meta retry yields one run. NULL where there is no natural key (manual run).';
comment on column public.workflow_runs.status is
  'Mirrors ExecutionStatus in the vendored runner. Kept as a check constraint, not an enum, so it stays greppable against the file it mirrors.';

create unique index if not exists workflow_runs_dedupe_key_uidx
  on public.workflow_runs (dedupe_key) where dedupe_key is not null;

create index if not exists workflow_runs_workflow_id_idx
  on public.workflow_runs (workflow_id, created_at desc);

-- Reconciliation reads only unfinished runs.
create index if not exists workflow_runs_unfinished_idx
  on public.workflow_runs (created_at)
  where status in ('pending','running','cancelling');

-- ---------------------------------------------------------------------
-- workflow_run_steps — the idempotency ledger
-- ---------------------------------------------------------------------
create table if not exists public.workflow_run_steps (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.workflow_runs(id) on delete cascade,
  -- The node's id in the editor's diagram. Converted unchanged by the adapter
  -- (conversion-contract test 8), so a step row points at a node the owner can
  -- actually find on the canvas.
  node_id      text not null,
  node_type    text not null,
  status       text not null default 'running',
  -- The node's finished NodeExecutionResult — the WHOLE `{ output, nextPort }`,
  -- not just its `output` field. `nextPort` is the branch a condition node
  -- chose, and a replay that lost it would re-decide the branch on an empty
  -- value and could run a subtree that never ran. Named for the runner's own
  -- word so the row and the port read alike.
  --
  -- Guest PII lives here (a name, a phone, a message body), so this column is
  -- inside the retention window — plan §6.4.
  output       jsonb,
  error_message text,
  -- Also the claim LEASE. A row left 'running' by a worker that died is
  -- indistinguishable from one a live worker holds, so a retry that treated
  -- every 'running' row as contended would make any crash permanent: the retry
  -- meets the dead attempt's own row on the first node and fails, every time.
  -- The claim therefore reclaims a 'running' row older than the lease (15
  -- minutes, following voximplant-reconcile's window for pre-terminal rows) and
  -- resets this column. See STEP_LEASE_MS in src/lib/workflow/engine/ports.ts.
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  constraint workflow_run_steps_status_known check (
    status in ('running','completed','failed','skipped')
  ),
  constraint workflow_run_steps_node_id_not_blank check (btrim(node_id) <> '')
);

-- THE constraint. See "WHY THE STEP TABLE EXISTS AT ALL" at the top: this is
-- what makes a pg-boss replay safe. The handler claims a row here before the
-- side effect; the second attempt gets 23505 and stops.
create unique index if not exists workflow_run_steps_run_node_uidx
  on public.workflow_run_steps (run_id, node_id);

comment on table public.workflow_run_steps is
  'Per-node execution ledger. unique (run_id, node_id) is the idempotency guard: the vendored runGraph has no per-node checkpoint, so a pg-boss retry replays the whole graph and only this constraint stops a second side effect.';
comment on column public.workflow_run_steps.output is
  'The whole NodeExecutionResult ({ output, nextPort }), not just its output field — a replay must reproduce the branch the first attempt chose. Holds guest PII; subject to the retention window (plan §6.4).';

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
alter table public.workflows          enable row level security;
alter table public.workflow_runs      enable row level security;
alter table public.workflow_run_steps enable row level security;

revoke all on public.workflows          from anon, authenticated;
revoke all on public.workflow_runs      from anon, authenticated;
revoke all on public.workflow_run_steps from anon, authenticated;

-- Admin authoring goes through the cookie client: authenticated needs the write
-- grants, the policy below decides who actually passes.
grant select, insert, update, delete on public.workflows to authenticated;

-- The execution record is READ-ONLY to the session client. Only the worker
-- (service_role, which RLS does not apply to) writes runs and steps; an admin
-- may inspect what happened, never author it.
grant select on public.workflow_runs      to authenticated;
grant select on public.workflow_run_steps to authenticated;

drop policy if exists workflows_admin_all on public.workflows;
create policy workflows_admin_all
  on public.workflows for all
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)));

drop policy if exists workflow_runs_admin_read on public.workflow_runs;
create policy workflow_runs_admin_read
  on public.workflow_runs for select
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)));

drop policy if exists workflow_run_steps_admin_read on public.workflow_run_steps;
create policy workflow_run_steps_admin_read
  on public.workflow_run_steps for select
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)));
