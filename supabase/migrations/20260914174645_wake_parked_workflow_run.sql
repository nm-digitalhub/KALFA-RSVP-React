-- Pull a parked workflow run's wait forward, because the thing it was waiting
-- for has happened (step 0ב-3).
--
-- WHAT WAS MISSING. A parked run holds TWO deadlines, and until now only one of
-- them could be moved. `workflow_runs.resume_at` is the run's wake-up, held by a
-- delayed pg-boss job. `workflow_run_steps.wait_until` is the STEP's deadline,
-- and it is the one `claimStep` actually reads: a replay that reaches a
-- 'waiting' step whose `wait_until` is still in the future returns 'in_flight',
-- which the runner turns into `step_in_flight` — a PERMANENT error that FAILS
-- the run. So delivering a run early without moving the step's deadline first
-- does not wake it; it kills it. Both deadlines have to move, together.
--
-- WHY A FUNCTION AND NOT TWO UPDATES. The gate and the write live in different
-- tables. Between a check that the run is still parked and an update of its
-- step, a concurrent `setRunStatus` can move the run on — and a step dragged out
-- of its wait for a run that is no longer waiting on it is a node that will be
-- re-entered early on some later replay. One statement, one snapshot, and the
-- `for update` on the run row serialises against the writer that would move it.
--
-- WHY THE CORRELATION IS THE GATE and not just the run id. The caller knows the
-- run from `voice_purpose_attempts.run_id`, which is enough to FIND the run and
-- not enough to know it is still waiting for THIS event. A run that woke,
-- carried on, and parked again for an unrelated reason would be woken by an old
-- call's callback. `resume_correlation_id` is written only while the run is
-- parked on that exact event and cleared on every other status (see
-- 20260914171914), so requiring a match is what makes the wake specific.
--
-- ADDITIVE AND REVERSIBLE: a new function, no column and no row touched.

create or replace function public.wake_parked_workflow_run(
  p_run_id         uuid,
  p_node_id        text,
  p_correlation_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_woke boolean;
begin
  with parked as (
    select r.id
      from public.workflow_runs r
     where r.id                   = p_run_id
       and r.status               = 'waiting'
       and r.resume_correlation_id = p_correlation_id
       for update
  ),
  -- Deliberately NOT guarded on `wait_until > now()`. A ceiling that has already
  -- passed means the timed wake-up is merely late, and the run is still owed a
  -- delivery; reporting "nothing to wake" there would suppress the pg-boss pull
  -- forward for a run that genuinely can run now.
  woken as (
    update public.workflow_run_steps s
       set wait_until = now()
      from parked
     where s.run_id  = parked.id
       and s.node_id = p_node_id
       and s.status  = 'waiting'
    returning s.id
  )
  select exists (select 1 from woken) into v_woke;

  return v_woke;
end;
$$;

-- ⚠️ REVOKING FROM PUBLIC IS NOT ENOUGH ON SUPABASE, which is why there are
-- three lines here and not one. This project's default privileges grant EXECUTE
-- on every new function in `public` to `anon` and `authenticated` BY NAME, and a
-- revoke from PUBLIC does not touch a grant made to a role directly.
--
-- MEASURED, on a trial run of this function against this database on 2026-09-14
-- that was rolled back afterwards: with only the PUBLIC revoke its ACL read
-- `postgres=X | anon=X | authenticated=X | service_role=X`, and adding the other
-- two brought it to `postgres=X | service_role=X`. Those two readings are the
-- evidence for these three lines; they describe that trial and NOT the current
-- state of any database, since the function it measured no longer exists.
--
-- Neither role could have done anything with the grant — `workflow_runs` and
-- `workflow_run_steps` grant them SELECT only, so the `for update` fails first —
-- but an engine function executable by a browser session is not a thing to leave
-- standing on the strength of a second defence.
revoke execute on function public.wake_parked_workflow_run(uuid, text, text) from public;
revoke execute on function public.wake_parked_workflow_run(uuid, text, text) from anon;
revoke execute on function public.wake_parked_workflow_run(uuid, text, text) from authenticated;

-- The only caller is the voice callback route, which runs as the service role
-- through the admin client. No browser role reaches this: waking a run is an
-- engine operation, and the token that authorises the callback is checked in the
-- route, not here.
grant execute on function public.wake_parked_workflow_run(uuid, text, text) to service_role;

comment on function public.wake_parked_workflow_run(uuid, text, text) is
  'Move a parked run''s step deadline to now when the external event it named has happened. '
  'Returns true only when the run is still waiting AND still waiting on this correlation id. '
  'The caller pulls the pg-boss job forward afterwards; this write is the durable half, so a '
  'run whose job cannot be moved still passes the wait on its next delivery.';
