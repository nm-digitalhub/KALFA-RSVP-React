-- A workflow run can pause and resume later.
--
-- WHY THIS IS NEEDED AT ALL. `runGraph` (vendored) has no suspension point: its
-- `while (ready.length > 0)` loop runs to completion and the only exits are
-- completion, a stall, or a fatal failure. `NodeExecutionResult` is
-- `{ output, nextPort? }` and `ExecutionContext` has no clock. Verified by
-- reading all 383 lines on 2026-09-13, after ruling out the alternatives:
-- the execution model DECLARES `node_waiting` / `branch_spawned` /
-- `branches_joined`, but the vendored runner emits none of them (they belong to
-- upstream's Temporal engine), and `node_waiting` is in any case about waiting
-- for OTHER NODES — a join — not about time.
--
-- So a wait is: the node records a deadline and throws, the layer OUTSIDE the
-- graph catches it, the run is parked, and pg-boss redelivers it with
-- `startAfter`. On resume the graph replays from the start — every finished step
-- returns its stored result from `workflow_run_steps` and performs no side
-- effect a second time, which is the property the ledger already guarantees and
-- the reason this needs no engine surgery.
--
-- These columns and statuses are what "parked" is written down as.
--
-- ADDITIVE AND REVERSIBLE. No existing row is read or rewritten: both columns
-- are nullable with no default, and each constraint only GAINS a value. Rolling
-- back is dropping the two columns, the index, and restoring the previous two
-- CHECK lists.

-- ── workflow_runs ────────────────────────────────────────────────────────────

-- 'waiting' sits between 'running' and terminal. It is deliberately NOT in
-- TERMINAL_RUN_STATUSES: a parked run is still in flight, must not stamp
-- finished_at, and must still be cancellable.
alter table workflow_runs drop constraint workflow_runs_status_known;
alter table workflow_runs add constraint workflow_runs_status_known
  check (status = any (array[
    'pending', 'running', 'waiting', 'cancelling',
    'completed', 'incomplete', 'failed', 'cancelled'
  ]));

-- When the run should wake. NULL for every run that is not parked — including
-- one that already woke, so this column reads as "still owed a wake-up" rather
-- than as a historical record.
alter table workflow_runs add column if not exists resume_at timestamptz;

comment on column workflow_runs.resume_at is
  'When a waiting run should be redelivered. Set with status=''waiting'', cleared on resume. pg-boss startAfter is the primary mechanism; this column is what a recovery sweep reads when a job was lost.';

-- ── workflow_run_steps ───────────────────────────────────────────────────────

-- A step that is parked is NOT 'running' (the 15-minute lease would reclaim it
-- and re-run the node) and NOT 'failed' (nothing went wrong, and a retry must
-- not take it over early). It needs its own state.
alter table workflow_run_steps drop constraint workflow_run_steps_status_known;
alter table workflow_run_steps add constraint workflow_run_steps_status_known
  check (status = any (array[
    'running', 'waiting', 'completed', 'failed', 'skipped'
  ]));

-- The deadline the step itself is holding. `claimStep` compares it to now():
-- past → the claim succeeds and the node completes; not yet → 'in_flight', and
-- the run parks again rather than executing anything downstream.
alter table workflow_run_steps add column if not exists wait_until timestamptz;

comment on column workflow_run_steps.wait_until is
  'Deadline of a waiting step. Read by claimStep to decide whether a replay may pass this node yet.';

-- ── recovery ─────────────────────────────────────────────────────────────────

-- pg-boss `startAfter` is what actually wakes a run. This index exists for the
-- case it does not: a job lost to a queue purge or a failed enqueue leaves a row
-- that is 'waiting' with a resume_at in the past and nothing coming for it.
-- Partial, because a run that is not waiting is never a candidate and there is
-- no reason to carry it in the index.
create index if not exists workflow_runs_resume_at_idx
  on workflow_runs (resume_at)
  where status = 'waiting';
