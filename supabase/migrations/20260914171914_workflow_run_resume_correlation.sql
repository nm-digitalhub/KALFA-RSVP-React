-- The handle an EXTERNAL EVENT uses to wake a parked workflow run (step 0ב-1).
--
-- Today a parked run can only be woken by TIME: `WorkflowWaitSignal` carries a
-- `resumeAt`, pg-boss holds a delayed job until then, and nothing else can bring
-- the run back. That is the right mechanism for `logic.wait`, and the wrong one
-- for "wait until this phone call ends" — the only way to express that now is to
-- guess a duration, so a 7-minute call is checked at minute 5 and a call that
-- failed instantly still burns the full wait.
--
-- This column is the early-wake channel. A run parks as it does today, with
-- `resume_at` kept as a TIMEOUT CEILING (required: a call that never reports
-- must not park a run for ever), and `resume_correlation_id` names the thing it
-- is waiting for — for a voice step, the `voice_purpose_attempts.id` the
-- dispatcher already returns. When that attempt concludes, the cb route finds
-- the run by this column and delivers it immediately instead of at the ceiling.
--
-- WHY TEXT AND NOT A FOREIGN KEY. The correlation is deliberately opaque: a
-- voice attempt id today, and whatever the next externally-completed step waits
-- on tomorrow. A FK would bind the engine to one table and make the wait
-- mechanism a voice feature rather than an engine one.
alter table public.workflow_runs
  add column resume_correlation_id text;

comment on column public.workflow_runs.resume_correlation_id is
  'Opaque id of the external event a parked run is waiting for (e.g. voice_purpose_attempts.id). Written with status=waiting and CLEARED on every other status, exactly like resume_at.';

-- Partial, and partial the same way `workflow_runs_resume_at_idx` is: the only
-- reader is the wake path, which asks "is there a run waiting on THIS id". A run
-- that is not waiting can never be woken by one, so indexing it would be paying
-- for rows no query looks at.
--
-- NOT UNIQUE. Two runs waiting on one correlation is not a state this design
-- creates, but a unique index would turn that into an INSERT failure on an
-- unrelated write rather than something the wake path can see and report. The
-- wake resolves at most one run and says so when it finds none.
create index workflow_runs_resume_correlation_idx
  on public.workflow_runs (resume_correlation_id)
  where status = 'waiting' and resume_correlation_id is not null;

comment on index public.workflow_runs_resume_correlation_idx is
  'Lookup for the event-driven wake: find the parked run waiting on a given external id.';
