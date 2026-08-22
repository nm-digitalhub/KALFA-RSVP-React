-- Split callback_requests.status (scheduler handling state) from a new,
-- separate call_outcome column (human-handling result after the call), and
-- give status a closed vocabulary via a CHECK constraint for the first time.
--
-- Why: `status` has been conflating two independent axes — "has the automated
-- scheduler booked a calendar slot" and "has the owner finished handling the
-- customer after the call" — into one free-text column with no enforced
-- vocabulary. A request the scheduler successfully booked still showed
-- status = 'new' in the admin list, indistinguishable from a request nobody
-- had touched, even a month later. call_outcome is the new, separate axis for
-- the human-handling result; status now describes scheduling state only.
-- Application code (separate change, not part of this migration) is being
-- updated to stop writing the retired status values 'in_progress' and 'done'
-- — that meaning moves to call_outcome instead.
--
-- This migration also fixes a real bug in claim_callback_triage(): its WHERE
-- clause hardcoded `status in ('new', 'in_progress')`, so any row that ever
-- moved to a status value outside that fixed set would become permanently
-- invisible to triage claiming, even with triage_status still 'pending' — the
-- same class of "stranded row" failure this codebase has already measured
-- elsewhere (see the comments in src/lib/data/callback-scheduling.ts and
-- src/lib/data/admin/callbacks.ts on prior incidents of this shape). Fixed by
-- expressing the predicate as `status <> 'cancelled'` — the one terminal
-- value that should exclude a row — instead of a closed set of "non-terminal"
-- values that has to be kept in lockstep with the status vocabulary forever.
--
-- Table has exactly 1 live row at migration time (status = 'new', already
-- satisfies the new CHECK constraint); it is corrected explicitly by id at
-- the end of this file rather than backfilled generically — see below.
--
-- Also rebuilds both partial indexes on `status` (callback_requests_
-- untriaged_idx, callback_requests_unscheduled_idx), which encoded the
-- retired include-list vocabulary, as exclude-lists of terminal values —
-- same reasoning as the claim_callback_triage() predicate fix.
--
-- Rollback: drop constraints callback_requests_call_outcome_valid and
-- callback_requests_status_valid, drop columns call_outcome and
-- scheduling_failure_reason, CREATE OR REPLACE claim_callback_triage() back
-- to the body from 20260728155249_callback_requests_triage.sql (status in
-- ('new','in_progress'), no status write in the claim UPDATE), and recreate
-- both indexes with their original predicates (status in ('new',
-- 'in_progress') / status = 'new'). The one-row status correction below is
-- not reversible by id alone (the prior value is not recorded) — restore
-- b7e50aaa-fc4a-4365-9158-4310e66d7cdb's status to 'new' by hand if rolling
-- back.

alter table public.callback_requests
  -- Set by the scheduler when it fails to find/keep a slot (paired with
  -- status = 'unschedulable'); cleared again on a successful schedule.
  add column scheduling_failure_reason text,
  -- The human-handling result after the call — a separate axis from `status`,
  -- which is scheduling state only.
  add column call_outcome text not null default 'pending';

comment on column public.callback_requests.scheduling_failure_reason is
  'Set when the scheduler fails to find/keep a slot (status = unschedulable); cleared on success.';
comment on column public.callback_requests.call_outcome is
  'Human-handling result after the call — independent of status, which is scheduling state only.';

alter table public.callback_requests
  add constraint callback_requests_call_outcome_valid
    check (call_outcome = any (array['pending', 'completed', 'no_answer', 'needs_followup', 'closed'])),

  -- No CHECK on `status` existed before this migration — any free text was
  -- accepted. Closing the vocabulary for the first time, matching the pattern
  -- already used for triage_status (callback_requests_triage_status_valid).
  add constraint callback_requests_status_valid
    check (status = any (array['new', 'pending_schedule', 'scheduled', 'needs_reschedule', 'unschedulable', 'cancelled']));

-- claim_callback_triage(): exactly two behavior changes from the body created
-- in 20260728155249_callback_requests_triage.sql, marked inline below.
-- Everything else — comments, structure, the abandoned-attempts branch — is
-- unchanged.
create or replace function public.claim_callback_triage()
returns setof public.callback_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- System rules, not call-time input. Exposed as parameters they would be
  -- untrusted input to a SECURITY DEFINER function: claim_callback_triage(0, 5)
  -- declares every live worker abandoned, and (15, 0) closes requests as failed
  -- without a single real attempt. No caller has a legitimate reason to vary
  -- them, so the safest validation is not to accept them at all.
  lease_minutes constant integer := 30;
  max_attempts  constant integer := 5;
  target public.callback_requests;
  guard integer := 0;
begin
  -- Bounded: each pass either returns or closes exactly one row, and a runaway
  -- here would hold locks while spinning.
  while guard < 50 loop
    guard := guard + 1;

    select * into target
    from public.callback_requests
    -- CHANGED: was `status in ('new', 'in_progress')`. A closed set of
    -- "non-terminal" values has to be kept in lockstep with the status
    -- vocabulary by hand forever — miss an update here and every row that
    -- moves to the missed value becomes permanently unclaimable, even with
    -- triage_status still 'pending'. Expressed instead as the one terminal
    -- value that should exclude a row.
    where status <> 'cancelled'
      and (
        triage_status = 'pending'
        -- RECLAIM: a lease that ran out. Without this branch a worker killed
        -- between claiming and answering strands the row in 'processing'
        -- forever — invisible to the trigger, and never reaching the scheduler
        -- with its constraints.
        or (
          triage_status = 'processing'
          and triage_claimed_at < now() - make_interval(mins => lease_minutes)
        )
      )
    order by created_at
    for update skip locked
    limit 1;

    if not found then
      return; -- nothing claimable
    end if;

    if target.triage_attempt_count >= max_attempts then
      -- Out of attempts. Closed as failed — a state a person can see — rather
      -- than left to be reclaimed on every tick for the rest of time. The
      -- load-bearing fields are cleared in the same statement, because the state
      -- constraint forbids a failed row from carrying anything the scheduler
      -- would act on.
      update public.callback_requests
      set triage_status = 'failed',
          -- The counter is bumped one last time, and that is the point: it is
          -- the FENCE, so revoking a claim has to move it. Without this the
          -- abandoned row keeps the number its worker still holds, and when that
          -- worker wakes and calls finish, the fence agrees with it — the row is
          -- terminal and the attempt matches, so it is told 'already_finalized'.
          -- Measured 28.07: it was. The write did not land (the status guard
          -- stops that), but the worker is told its extraction succeeded when
          -- the system in fact threw it away, and nothing anywhere reports the
          -- loss. With the bump it gets 'claim_lost', which is the truth.
          triage_attempt_count = target.triage_attempt_count + 1,
          triaged_at = now(),
          triage_claimed_at = null,
          triage_last_error =
            coalesce(triage_last_error, '') ||
            case when triage_last_error is null then '' else ' | ' end ||
            'abandoned after ' || max_attempts || ' attempts',
          not_before_min = null,
          not_after_min = null,
          excluded_dates = null,
          updated_at = now()
      where id = target.id;
      -- The row is now terminal and no longer matches the candidate predicate,
      -- so the next iteration moves on to another request. (It is also locked
      -- for this transaction, but that is not what excludes it.)
      continue;
    end if;

    -- A claim starts from a CLEAN attempt. On a first claim out of 'pending'
    -- these are already null (the state constraint says so), but a RECLAIM may
    -- be picking up after a worker that was killed mid-write and left half an
    -- extraction behind. Inheriting that would make the retry non-deterministic:
    -- the next run would build on values it never produced.
    update public.callback_requests
    -- CHANGED: also advances `status` from 'new' to 'pending_schedule' on a
    -- fresh claim, so the admin list can tell "picked up, not yet scheduled"
    -- apart from "nobody has touched this yet". Guarded so a RECLAIM never
    -- downgrades a row that has moved past 'new' since — a row already
    -- 'scheduled' or 'needs_reschedule' keeps that status untouched.
    set status = case when status = 'new' then 'pending_schedule' else status end,
        triage_status = 'processing',
        triage_attempt_count = target.triage_attempt_count + 1,
        triage_claimed_at = now(),
        triaged_at = null,
        triage_last_error = null,
        not_before_min = null,
        not_after_min = null,
        excluded_dates = null,
        triage = null,
        updated_at = now()
    where id = target.id
    returning * into target;

    return next target;
    return;
  end loop;
end;
$$;

-- ── Indexes: both partial predicates encoded the retired vocabulary ────────
-- Same lesson as the claim_callback_triage() fix above: a hardcoded
-- include-list of "still open" values goes stale the moment the vocabulary
-- grows. Both are rebuilt as exclude-lists of the terminal/settled values
-- instead, so a future status addition does not silently drop rows out of
-- either index again.

-- What claim_callback_triage()'s own SELECT scans (its predicate changed
-- above from `status in ('new','in_progress')` to `status <> 'cancelled'`;
-- this index must match or the claim query falls back to a seq scan).
drop index if exists public.callback_requests_untriaged_idx;
create index if not exists callback_requests_untriaged_idx
  on public.callback_requests (triage_status, created_at)
  where status <> 'cancelled';

-- What the scheduling sweep scans for candidates with no calendar slot yet.
-- 'scheduled' (has a slot), 'cancelled' and 'unschedulable' (both terminal,
-- no future scheduling attempt will ever be made) are excluded; every other
-- status — including 'new', 'pending_schedule', and 'needs_reschedule' — is
-- schedulable work.
drop index if exists public.callback_requests_unscheduled_idx;
create index if not exists callback_requests_unscheduled_idx
  on public.callback_requests (created_at)
  where calendar_item_id is null
    and status not in ('scheduled', 'cancelled', 'unschedulable');

-- ── One-row correction ──────────────────────────────────────────────────────
-- The single live row at migration time already exhibits the exact symptom
-- this redesign fixes: the scheduler booked it (calendar_item_id and
-- scheduled_at both set) but status still read 'new', indistinguishable from
-- a request nobody had touched. Corrected once, explicitly, by id — not a
-- general backfill. Owner-approved 2026-08-20 (team-lead relay). Gated on the
-- exact state verified live, so this is a no-op rather than a silent
-- overwrite if that state has since changed.
update public.callback_requests
set status = 'scheduled'
where id = 'b7e50aaa-fc4a-4365-9158-4310e66d7cdb'
  and status = 'new'
  and calendar_item_id is not null
  and scheduled_at is not null;
