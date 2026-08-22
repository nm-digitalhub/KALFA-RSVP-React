-- Add the no-contact/closed terminal path on top of the status/call_outcome
-- split shipped earlier tonight in 20260819212112_callback_status_outcome_split.sql
-- (read that file first -- this migration extends the exact same two CHECK
-- constraints and rebuilds the exact same two partial indexes, and must stay
-- internally consistent with it).
--
-- Why: three consecutive no-answer attempts on a request is a real terminal
-- outcome -- nobody is ever going to pick up -- but until now the only two
-- terminal paths were 'cancelled' (an admin or the customer proactively
-- backing out) and the scheduler's own 'unschedulable'. There was no way to
-- record "the system gave up after N genuine attempts" as distinct from
-- either of those, and no way to stop such a request from being retried
-- forever by both claim_callback_triage() and the scheduling sweep.
--
-- This adds:
--   * call_outcome = 'no_contact' -- the call-result axis: three consecutive
--     no_answer attempts, contact never made. NOT the same thing as the
--     existing call_outcome = 'closed' (which means "call happened, or no
--     follow-up is needed") -- same word, different column, unrelated
--     meaning; do not conflate them when reading either CHECK constraint.
--   * status = 'closed' -- the scheduling-state axis: this request is fully
--     done, system-driven, terminal. Distinct from status = 'cancelled',
--     which means an admin or the customer proactively cancelled before any
--     resolution. A request reaching status = 'closed' arrived there because
--     the system decided no further scheduling or triage work is possible or
--     useful -- the no-contact case is the first one, but the value is not
--     named after it, on purpose, so a future second reason to close a
--     request systemically (if one ever arises) does not need a third
--     status value.
--   * five columns recording the closing SMS sent when a request reaches
--     no_contact: a claim-before-send guard (no_contact_sms_claimed_at), a
--     send-confirmation (no_contact_sms_sent_at) kept deliberately distinct
--     from the claim so a process that died mid-send is visible instead of
--     indistinguishable from success, a provider message id for support
--     lookups, and a provider error string for a certain/final failure.
--     consecutive_no_answer_count is the counter application code increments
--     toward the 3-attempt threshold and resets on any other outcome.
--
-- All five new columns are nullable-or-zero-defaulted and written by
-- application code (a separate change, not part of this migration); this
-- migration only adds the columns and their CHECK/index support.
--
-- claim_callback_triage()'s claim predicate and callback_requests_
-- untriaged_idx both move from excluding just 'cancelled' to excluding
-- ('cancelled', 'closed') -- a fully-closed request must never be re-claimed
-- for triage. callback_requests_unscheduled_idx gains 'closed' in its own
-- exclusion list for the same reason on the scheduling side: application
-- code's scheduling-sweep candidate query is being updated separately (not
-- by this migration) to the matching predicate
-- `status not in ('scheduled', 'cancelled', 'unschedulable', 'closed')`, and
-- a partial index only gets used when its own predicate is provably no
-- narrower than the query's. Skipping this index rebuild would not break
-- correctness of the CHECK constraint or the app-code predicate change --
-- but it WOULD mean the sweep query falls back to a full scan of the table
-- for every tick, and worse: if the app-code predicate change described
-- above were ever done differently than expected (e.g. an include-list
-- instead of an exclude-list, missing 'closed'), a request the system just
-- auto-closed as no_contact could get picked up by the next sweep tick and
-- scheduled again, un-closing itself. Rebuilding the index to the exact
-- expected predicate now, with this comment, is the guard against that.
--
-- No RLS changes: this table has exactly one policy (cb_insert_authenticated,
-- INSERT-only, unrelated to status/call_outcome). No GRANT changes: verified
-- live -- grants on callback_requests are table-level for anon/authenticated/
-- postgres/service_role with no column-level ACL entries (pg_attribute.attacl
-- empty for every column), so new columns inherit the existing table grants
-- automatically. No data backfill: no live rows in any new state yet.
--
-- Rollback: drop constraints callback_requests_call_outcome_valid and
-- callback_requests_status_valid and recreate them with the value arrays from
-- 20260819212112_callback_status_outcome_split.sql (without 'no_contact' /
-- 'closed'), drop the five new columns, CREATE OR REPLACE
-- claim_callback_triage() back to that migration's body (predicate
-- `status <> 'cancelled'`), and recreate both indexes with that migration's
-- predicates (`status <> 'cancelled'` / `status not in ('scheduled',
-- 'cancelled', 'unschedulable')`).

alter table public.callback_requests
  drop constraint callback_requests_call_outcome_valid,
  add constraint callback_requests_call_outcome_valid
    check (call_outcome = any (array['pending', 'completed', 'no_answer', 'needs_followup', 'closed', 'no_contact'])),
  drop constraint callback_requests_status_valid,
  add constraint callback_requests_status_valid
    check (status = any (array['new', 'pending_schedule', 'scheduled', 'needs_reschedule', 'unschedulable', 'cancelled', 'closed']));

alter table public.callback_requests
  add column consecutive_no_answer_count integer not null default 0,
  add column no_contact_sms_claimed_at timestamptz,
  add column no_contact_sms_sent_at timestamptz,
  add column no_contact_sms_provider_id text,
  add column no_contact_sms_error text;

comment on column public.callback_requests.consecutive_no_answer_count is
  'Consecutive call_outcome = no_answer attempts; resets to 0 on any other non-pending outcome. Written by application code, not this migration.';
comment on column public.callback_requests.no_contact_sms_claimed_at is
  'Claim-before-send guard, not a send-confirmation: set the instant the system commits to sending the no-contact closing SMS, before calling the provider. Idempotent write: UPDATE ... SET no_contact_sms_claimed_at = now() WHERE id = $1 AND no_contact_sms_claimed_at IS NULL RETURNING id -- only the caller that gets a row back may call the SMS provider.';
comment on column public.callback_requests.no_contact_sms_sent_at is
  'Set only after the SMS provider confirms success (success: true from ExtrA). Distinct from no_contact_sms_claimed_at on purpose: claimed-but-not-sent means the process died mid-send or the provider call failed -- visible and diagnosable instead of silently indistinguishable from a successful send.';
comment on column public.callback_requests.no_contact_sms_provider_id is
  'Provider''s own message id, returned in the success response, for support/audit lookups.';
comment on column public.callback_requests.no_contact_sms_error is
  'Provider''s error description when the send failed for a certain/final reason (e.g. invalid destination). Recorded for visibility; never blocks or reopens the already-closed request.';

-- claim_callback_triage(): one predicate change from the body created in
-- 20260819212112_callback_status_outcome_split.sql. Everything else --
-- structure, comments, the abandoned-attempts branch -- is unchanged.
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
    -- CHANGED (this migration): was `status <> 'cancelled'`. A fully-closed
    -- (no-contact-after-3-attempts) request must never be re-claimed for
    -- triage processing, so 'closed' joins 'cancelled' as an excluded
    -- terminal value -- same reasoning as the 'cancelled'-only exclusion this
    -- replaces: excluding known-terminal values instead of enumerating
    -- non-terminal ones, so a future status addition can't silently strand
    -- rows the way the pre-2026-08-19 hardcoded include-list did.
    where status not in ('cancelled', 'closed')
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
    -- Advances `status` from 'new' to 'pending_schedule' on a fresh claim, so
    -- the admin list can tell "picked up, not yet scheduled" apart from
    -- "nobody has touched this yet". Guarded so a RECLAIM never downgrades a
    -- row that has moved past 'new' since — a row already 'scheduled' or
    -- 'needs_reschedule' keeps that status untouched.
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

-- ── Indexes: both rebuilt to match the predicate changes above ─────────────

-- What claim_callback_triage()'s own SELECT scans (its predicate changed
-- above from `status <> 'cancelled'` to `status not in ('cancelled',
-- 'closed')`; this index must match or the claim query falls back to a seq
-- scan).
drop index if exists public.callback_requests_untriaged_idx;
create index if not exists callback_requests_untriaged_idx
  on public.callback_requests (triage_status, created_at)
  where status not in ('cancelled', 'closed');

-- What the scheduling sweep scans for candidates with no calendar slot yet.
-- 'scheduled' (has a slot), 'cancelled' and 'unschedulable' (terminal, no
-- future scheduling attempt will ever be made) were already excluded; 'closed'
-- joins them here for the same reason. CRITICAL: application code's
-- scheduling-sweep candidate query is being updated separately (not by this
-- migration) to the matching predicate `status not in ('scheduled',
-- 'cancelled', 'unschedulable', 'closed')`. Without this index rebuild, a
-- request the system just auto-closed as no_contact would either force a seq
-- scan on every sweep tick, or -- if the app-code predicate ever drifted from
-- this exact exclusion list -- get picked up by the next sweep tick and
-- scheduled again, un-closing itself. 'closed' must never be schedulable.
drop index if exists public.callback_requests_unscheduled_idx;
create index if not exists callback_requests_unscheduled_idx
  on public.callback_requests (created_at)
  where calendar_item_id is null
    and status not in ('scheduled', 'cancelled', 'unschedulable', 'closed');
