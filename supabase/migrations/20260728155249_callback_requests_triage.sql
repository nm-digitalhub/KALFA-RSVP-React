-- Triage of a callback request: what the caller actually said about when they
-- can answer, read out of their own free text.
--
-- Why this cannot reuse an existing column. The reactive fleet role needs to
-- ask "which requests have I not read yet?", and nothing already on the table
-- answers it: `requested_at IS NULL` is ambiguous (true both for un-read rows
-- and for read rows where no preference was found), `status` is the handling
-- workflow on a different axis, and `scheduled_at` is written by the pg-boss
-- sweep, which races the triage rather than following it.
--
-- Measured 28.07.2026, the failure this exists for: a caller wrote she was
-- reachable 08:00-13:00 and NOT that day. Her availability lived in `note`,
-- which is read by people and by nothing that picks a time, so the scheduler
-- fell through to "as soon as possible" and booked her for that afternoon —
-- the one day she had ruled out, at an hour outside the window she gave.

alter table public.callback_requests
  -- The state machine. `triaged_at` alone cannot be one: NULL would have to mean
  -- never-tried AND in-flight AND failed-validation AND gave-up, which is the
  -- same ambiguity that made `requested_at IS NULL` useless. Concretely, with
  -- only a timestamp, a row whose extraction keeps failing either stays NULL and
  -- is retried forever, or gets stamped and disappears while never having been
  -- read.
  --
  --   pending        not yet claimed
  --   processing     claimed atomically by a worker (see claim_callback_triage)
  --   completed      extraction succeeded — INCLUDING when it found nothing
  --   manual_review  the text is ambiguous, or the constraints are not safe to act on
  --   failed         gave up after retries
  add column triage_status text not null default 'pending',
  -- Bounds the retries. Without it 'failed' has no way to be reached.
  add column triage_attempt_count smallint not null default 0,
  -- When the current claim was taken — the LEASE. 'processing' without one is a
  -- state a crashed worker can never leave: the partial index below holds only
  -- claimable rows, so a stuck row becomes invisible to the trigger AND never
  -- reaches the scheduler with its constraints. Not a corner case here — the
  -- fleet runs each role under `timeout --kill-after=60` (run-role.sh), so being
  -- killed mid-run is the EXPECTED failure of a triage, not an exotic one.
  add column triage_claimed_at timestamptz,
  -- Kept as a column rather than inside `triage`: an error is not extraction
  -- OUTPUT, and it should be readable without unpacking json.
  add column triage_last_error text,

  -- WHEN a final answer was reached. Records the decision; it does not encode
  -- it — `triage_status` above does that.
  add column triaged_at timestamptz,

  -- The three fields the DETERMINISTIC scheduler consumes, as real columns
  -- rather than inside the jsonb below. They carry database CHECKs, so the
  -- same validation the engine performs (src/lib/callbacks/schedule-policy.ts,
  -- validateConstraints) is enforced a second time where it cannot be bypassed:
  -- an extraction step that produces nonsense fails to STORE it, instead of
  -- storing it and relying on every future reader to re-validate.
  --
  -- Israel wall-clock minutes from midnight, the same unit as CallbackPolicy.
  add column not_before_min smallint,
  -- The minute by which the call should be FINISHED, not started — see
  -- CallerConstraints. A caller reachable "until 13:00" gets a 15-minute call
  -- placed no later than 12:45 (owner decision 28.07).
  add column not_after_min smallint,

  -- date[] and not jsonb or text[] on purpose: the insidious failure mode here
  -- is a wrongly-shaped date. '28/07/2026' silently matches no calendar day, so
  -- the day the caller ruled out gets scheduled as if they had never spoken.
  -- Postgres refuses to store it at all.
  add column excluded_dates date[],

  -- Everything else the triage produced — evidence offsets into `note`,
  -- confidence, department, channel, and WHICH MODEL AND PROMPT VERSION produced
  -- it. Those last two were considered as columns and deliberately left here:
  -- they are not read by anything that schedules a call, which is the exact
  -- definition this field exists to hold. Free-form because it will grow, and
  -- growth here must never require a migration to a column the scheduler uses.
  add column triage jsonb;

comment on column public.callback_requests.triaged_at is
  'When the request was read for scheduling constraints. NULL = not yet read.';
comment on column public.callback_requests.not_before_min is
  'Earliest Israel wall-clock minute the caller will answer (0-1439).';
comment on column public.callback_requests.not_after_min is
  'Minute by which the call should be FINISHED (0-1439), not merely started.';
comment on column public.callback_requests.excluded_dates is
  'Israel calendar dates the caller ruled out entirely.';
comment on column public.callback_requests.triage is
  'Non-scheduling triage output (evidence, confidence, routing). Never read by the scheduler.';

-- The same three rules validateConstraints() applies, as storage constraints.
-- NOT NULL is deliberately absent from all of them: "no constraint stated" is
-- the ordinary case and must stay expressible.
alter table public.callback_requests
  add constraint callback_requests_not_before_min_range
    check (not_before_min is null or (not_before_min >= 0 and not_before_min < 1440)),
  add constraint callback_requests_not_after_min_range
    check (not_after_min is null or (not_after_min >= 0 and not_after_min < 1440)),
  -- An inverted or empty window is not a narrow window, it is bad input.
  add constraint callback_requests_window_ordered
    check (
      not_before_min is null
      or not_after_min is null
      or not_before_min < not_after_min
    ),

  add constraint callback_requests_triage_status_valid
    check (triage_status in ('pending', 'processing', 'completed', 'manual_review', 'failed')),
  add constraint callback_requests_triage_attempts_sane
    check (triage_attempt_count >= 0 and triage_attempt_count <= 10),

  -- A Postgres array may contain NULL elements, which date-ness alone does not
  -- prevent: array['2026-07-28'::date, null] is a valid date[]. A NULL in here
  -- would compare against no calendar day and quietly exclude nothing.
  add constraint callback_requests_excluded_dates_no_nulls
    check (excluded_dates is null or array_position(excluded_dates, null) is null),

  -- jsonb accepts '[]' and '"failed"' as happily as an object. Pinning the
  -- shape now costs nothing and spares every future reader a type check.
  add constraint callback_requests_triage_is_object
    check (triage is null or jsonb_typeof(triage) = 'object'),

  -- The state machine itself, enforced rather than merely described. Without
  -- this the columns are five independent fields that happen to be named alike,
  -- and any writer — including an extraction step that half-succeeded — can
  -- leave a row saying 'completed' with no result, or 'pending' carrying
  -- constraints from a previous attempt that were never cleared.
  add constraint callback_requests_triage_state_coherent
    check (
      case triage_status
        -- Nothing has happened yet: no claim, no answer, no leftovers.
        -- `attempt_count = 0` included: in THIS machine there is no
        -- processing → pending edge. Retrying happens by reclaiming a processing
        -- row whose lease expired, which raises the counter — so 'pending' can
        -- only mean "never claimed". An earlier draft left this out to keep room
        -- for a future requeue path; that weakened a real invariant for a route
        -- that does not exist. When requeue is added it should bring its own
        -- state (retry_wait) or change this rule in the migration that adds it.
        when 'pending' then
          triage_attempt_count = 0
          and triage_claimed_at is null
          and triaged_at is null
          and triage_last_error is null
          and not_before_min is null
          and not_after_min is null
          and excluded_dates is null
          and triage is null
        -- Claimed and in flight. The lease must exist; the answer must not.
        -- Claimed and in flight, on a CLEAN slate. Hardened so extraction output
        -- can never be written in stages: a worker produces and validates its
        -- result in memory, then moves the row to a terminal state in ONE
        -- update. A half-written 'processing' row is therefore not a state this
        -- table can hold.
        when 'processing' then
          triage_claimed_at is not null
          and triage_attempt_count >= 1
          and triaged_at is null
          and triage_last_error is null
          and not_before_min is null
          and not_after_min is null
          and excluded_dates is null
          and triage is null
        -- Succeeded — INCLUDING when nothing was found. Constraints may be null
        -- (the caller stated none) or set; what may not exist is an error.
        when 'completed' then
          triaged_at is not null
          and triage_attempt_count >= 1
          -- The lease belongs to work in motion. A terminal row still holding
          -- one would be reclaimed by the next expiry sweep and re-triaged.
          and triage_claimed_at is null
          and triage_last_error is null
        -- A final answer was reached, but it is not safe to act on. Constraints
        -- are deliberately ALLOWED here: seeing what was extracted is the whole
        -- point of routing it to a person rather than discarding it.
        when 'manual_review' then
          triaged_at is not null
          and triage_attempt_count >= 1
          and triage_claimed_at is null
        -- Gave up. Both when and why must be recorded, and nothing load-bearing
        -- may survive: no scheduling decision may rest on a failed extraction.
        when 'failed' then
          triaged_at is not null
          and triage_attempt_count >= 1
          and triage_claimed_at is null
          and triage_last_error is not null
          and not_before_min is null
          and not_after_min is null
          and excluded_dates is null
        else false
      end
    );

-- What the trigger counts and what the claim below scans: work still open, in
-- arrival order — OLDEST FIRST. Partial on `status`, so it holds only requests
-- somebody still intends to call; 'cancelled' and 'done' are excluded because
-- reading a request nobody will ring is work for nothing, and would keep the
-- trigger firing on rows that can never leave the set.
--
-- `triage_status` is a leading column rather than a predicate: the claim needs
-- both 'pending' rows AND 'processing' rows whose lease has expired, and a
-- predicate on now() cannot be indexed (not immutable). One index serves both.
create index if not exists callback_requests_untriaged_idx
  on public.callback_requests (triage_status, created_at)
  where status in ('new', 'in_progress');

-- ── The counter never goes backwards ────────────────────────────────────────
-- The fence in finish_callback_triage identifies an attempt BY ITS NUMBER, so a
-- counter that could be lowered would let a stale worker's number come round
-- again and win a write it already lost. That property is not something a CHECK
-- can express — a CHECK sees one row version, and this is a rule about the
-- transition between two.
--
-- Enforced here rather than trusted to the code, for the same reason the value
-- ranges are: the writers are the server and, later, an extraction step, and
-- "we will remember not to" is not an invariant.
create or replace function public.callback_requests_attempt_monotonic()
returns trigger
language plpgsql
as $$
begin
  if new.triage_attempt_count < old.triage_attempt_count then
    raise exception
      'triage_attempt_count may not decrease (% -> %) — it fences the claim',
      old.triage_attempt_count, new.triage_attempt_count
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists callback_requests_attempt_monotonic_trg on public.callback_requests;
create trigger callback_requests_attempt_monotonic_trg
  before update on public.callback_requests
  for each row
  execute function public.callback_requests_attempt_monotonic();

-- ── Claiming ────────────────────────────────────────────────────────────────
-- One request, claimed atomically, or nothing.
--
-- `processing` would be decorative without this: a plain SELECT-then-UPDATE lets
-- two readers pick the same row, and the second one's extraction overwrites the
-- first. The fleet does hold a global flock today, but that is a FILESYSTEM
-- contract standing in for a DATABASE invariant, and it stops holding the moment
-- anything runs outside run-role.sh — which is not hypothetical: the CLI was
-- driven directly, repeatedly, on 28.07 while building this.
--
-- FOR UPDATE SKIP LOCKED is the standard queue claim: concurrent callers step
-- over each other's locked rows instead of blocking on them, so a second worker
-- gets the NEXT request rather than waiting for the first.
-- The lease: a claim older than this is treated as abandoned and may be taken
-- again.
--
-- Thirty minutes, and NOT because a shorter one would be unsafe. Once
-- finish_callback_triage below performs a compare-and-set on the attempt number,
-- a worker that wakes after its lease expired simply cannot write — so the lease
-- stops being a safety boundary and becomes a latency knob. What it still buys
-- is avoiding WASTE: reclaiming a run that is merely slow spends a second
-- extraction and burns one of the five attempts for nothing.
--
-- The margin matters. Measured 28.07: run-role.sh defaults a role to
-- `timeout_minutes // 20`, which is LONGER than the 15 minutes first written
-- here — so the original numbers guaranteed the very reclaim-a-live-worker race
-- this is meant to avoid. Thirty gives a live run room; the triage role should
-- additionally be given a short timeout_minutes (10) in fleet.json.
--
-- plpgsql rather than plain SQL because two different things can happen to a
-- candidate — it is claimed, or it has exhausted its attempts and must be closed
-- as failed — and only the first is work to hand back. A single SQL statement
-- cannot both close a row and return nothing for it.
--
-- `setof` rather than a bare composite: returning NULL from a function typed to
-- a table row yields one all-NULL row, which every caller then has to
-- special-case. This returns zero rows or one.
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
    where status in ('new', 'in_progress')
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
    set triage_status = 'processing',
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

-- SECURITY DEFINER means this runs as its owner and bypasses RLS, so its reach
-- is closed deliberately: nobody but the server may call it.
revoke all on function public.claim_callback_triage() from public, anon, authenticated;
grant execute on function public.claim_callback_triage() to service_role;

comment on function public.claim_callback_triage() is
  'Atomically claims the oldest un-triaged callback request (pending → processing) and returns it, or nothing. Server-only.';

-- ── Finishing ───────────────────────────────────────────────────────────────
-- The ONLY way a triage result reaches the table.
--
-- Fenced on `triage_attempt_count`, which every claim and reclaim increments and
-- nothing ever lowers — so it identifies the attempt as precisely as a dedicated
-- token would, without a column to keep in step. A worker is handed the number
-- it claimed under and must present it back:
--
--   W1 claims          → attempt 1
--   W1 stalls, lease expires
--   W2 reclaims        → attempt 2
--   W1 wakes, finishes → presents 1, matches nothing, gets 'claim_lost'
--   W2 finishes        → presents 2, wins
--
-- Without this, both writes would succeed and the later one would win silently:
-- `processing → completed` is a legal transition from either worker's view, so
-- the state constraint cannot tell them apart.
--
-- Idempotent on FAILURE, not on success. A repeated call after a win does not
-- win again — it answers 'already_finalized', which is what distinguishes a lost
-- network response from a write that never landed. That answer is given only
-- after CHECKING the row reached a terminal state; inferring it from a matching
-- attempt number alone would report success for a row that was never finished.
create or replace function public.finish_callback_triage(
  p_request_id uuid,
  p_claimed_attempt smallint,
  p_status text,
  p_not_before_min smallint default null,
  p_not_after_min smallint default null,
  p_excluded_dates date[] default null,
  p_triage jsonb default null,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated integer;
  current_attempt smallint;
  current_status text;
begin
  -- NULL is checked EXPLICITLY, before the vocabulary. `p_status not in (...)`
  -- evaluates to NULL when p_status is NULL — not TRUE — so on its own this
  -- guard lets a NULL straight through, and the value only fails later against
  -- the column's NOT NULL, as a confusing error about a column the caller never
  -- mentioned.
  --
  -- The identity arguments matter more. A NULL p_claimed_attempt makes the
  -- fence `triage_attempt_count = NULL` unknown, so the update matches nothing;
  -- the classification below then finds `current_attempt <> NULL` also unknown,
  -- falls past it, and can answer 'already_finalized' for a row this call never
  -- touched — telling a caller its write landed when it did not.
  if p_request_id is null then
    raise exception 'p_request_id is required' using errcode = '22023';
  end if;
  if p_claimed_attempt is null then
    raise exception 'p_claimed_attempt is required — it is the fence'
      using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('completed', 'manual_review', 'failed') then
    raise exception 'p_status must be completed, manual_review or failed (got %)',
      coalesce(p_status, 'NULL') using errcode = '22023';
  end if;

  update public.callback_requests
  set triage_status = p_status,
      triaged_at = now(),
      -- The lease ends with the work. The state constraint requires it.
      triage_claimed_at = null,
      triage_last_error = case when p_status = 'failed' then coalesce(p_error, 'unspecified') else null end,
      -- Nothing load-bearing survives a failure.
      not_before_min = case when p_status = 'failed' then null else p_not_before_min end,
      not_after_min  = case when p_status = 'failed' then null else p_not_after_min end,
      excluded_dates = case when p_status = 'failed' then null else p_excluded_dates end,
      triage = p_triage,
      updated_at = now()
  where id = p_request_id
    and triage_status = 'processing'
    and triage_attempt_count = p_claimed_attempt;

  get diagnostics updated = row_count;
  if updated = 1 then
    return 'finalized';
  end if;

  -- Nothing was written. Say WHY, because the two reasons call for opposite
  -- reactions: a lost claim means discard the result, an already-finalized row
  -- means the previous call did land and the response was what went missing.
  select triage_attempt_count, triage_status
    into current_attempt, current_status
  from public.callback_requests where id = p_request_id;

  if not found then
    return 'not_found';
  elsif current_attempt <> p_claimed_attempt then
    -- Somebody else holds the work now.
    return 'claim_lost';
  elsif current_status in ('completed', 'manual_review', 'failed') then
    -- Our own attempt already landed; this is a repeat of a call whose answer
    -- was lost, not a write that failed.
    return 'already_finalized';
  else
    -- The number still matches but the row is not in flight. Under the state
    -- constraint this is unreachable — 'pending' requires attempt 0 and no
    -- caller finishes attempt 0 — so it is reported distinctly rather than
    -- folded into claim_lost: seeing it at all means an invariant broke.
    return 'claim_inactive';
  end if;
end;
$$;

revoke all on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text) to service_role;

comment on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text) is
  'Atomically finishes a claimed triage, fenced on the claimed attempt number. Returns finalized | claim_lost | already_finalized | claim_inactive | not_found. Server-only.';

-- ── Who may write these fields ──────────────────────────────────────────────
-- MEASURED 28.07.2026 before this change: `anon` and `authenticated` both hold
-- INSERT/UPDATE/DELETE grants on this table, and exactly one RLS policy exists —
-- cb_insert_authenticated, INSERT for authenticated, `auth.uid() IS NOT NULL`,
-- with no restriction on WHICH COLUMNS may be supplied.
--
-- Adding triage fields to that table would therefore have let any signed-in user
-- POST a row straight to PostgREST with `triage_status: 'completed'` and a window
-- of their choosing — marking their own request as already read and steering the
-- scheduler. The CHECK constraints above validate that values are well-formed;
-- they say nothing about who wrote them.
--
-- The fix is narrow: an inserting client may still create a request, but must
-- leave every triage field at its default. The server writes them afterwards,
-- through the service role, which bypasses RLS entirely.
drop policy if exists cb_insert_authenticated on public.callback_requests;
create policy cb_insert_authenticated
  on public.callback_requests
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and triage_status = 'pending'
    and triage_attempt_count = 0
    and triaged_at is null
    and triage_last_error is null
    and not_before_min is null
    and not_after_min is null
    and excluded_dates is null
    and triage is null
  );
