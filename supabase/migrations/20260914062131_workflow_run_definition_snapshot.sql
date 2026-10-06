-- A parked run resumes on the definition it STARTED with.
--
-- THE BUG THIS CLOSES, measured rather than assumed. `loadRunForExecution`
-- selects `workflows(definition)` — a join to the LIVE row — and pg-boss carries
-- only the run id, so a run that parks at a `logic.wait` for two days wakes up
-- on whatever the workflow says two days later.
--
-- Completed steps are already safe: the ledger in `workflow_run_steps` replays
-- them by node id and performs no side effect twice. What is NOT safe is a node
-- ADDED before the wait — it has no ledger row, so it is treated as unreached
-- and runs on resume. An owner editing a workflow has no reason to expect that a
-- run parked yesterday will execute the step they just drew.
--
-- ⚠️ WHY A COLUMN AND NOT A VERSION TABLE. The question a resumed run asks is
-- "what did I start with", which is one value per run and never shared. A
-- versions table would additionally need a retention rule, a foreign key, and an
-- answer for what happens when a version is deleted while a run still points at
-- it — all to store something each run already owns.
--
-- ⚠️ AND WHY IT IS READ ONLY ON RESUME. `handleWorkflowRun` re-reading fresh
-- state is DELIBERATE and documented ("the same re-read fresh state rule the
-- call dispatchers follow"): an edit made between enqueue and a prompt execution
-- should be picked up. That rule is not the bug. The bug is time — a wait turns
-- "moments later" into "days later", and only then does the run need the
-- definition it was born with. So the snapshot is written for every run and
-- consulted only when one comes back from 'waiting'.
--
-- ADDITIVE AND REVERSIBLE. Nullable, no default, no existing row read or
-- rewritten. Every run created before this column has NULL and keeps today's
-- behaviour exactly — falling back to the live definition — so the change cannot
-- alter a run already in flight. Rolling back is dropping the column.

alter table public.workflow_runs
  add column if not exists definition_snapshot jsonb;

comment on column public.workflow_runs.definition_snapshot is
  'The workflow definition as it stood when this run was created. Read ONLY when a run resumes from ''waiting'', so a run parked at logic.wait is not executed against a definition edited while it slept. NULL on rows created before this column, and on those the live definition is used, which is the pre-existing behaviour.';
