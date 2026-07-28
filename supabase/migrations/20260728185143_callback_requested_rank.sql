-- Where inside the allowed set to aim, carried from intake to scheduling.
--
-- `requested_at` says WHEN to start looking. It has never said what to do when
-- that instant is taken, and the answer differs by how it was arrived at:
--
--   * The public form asks "when is convenient?" and the caller ticks a part of
--     the day. That is a DIRECTION — morning means the early end of whatever is
--     workable, not 09:00 exactly. The form converts the tick to an instant and
--     then discards which band it was, so by the time the scheduler runs there
--     is nothing left to say "they wanted the afternoon".
--
--   * Triage may read a specific moment out of the caller's own words ("call me
--     on 10/08"). That is a TARGET, and when it is unavailable the honest answer
--     is the nearest workable time in either direction — the form already
--     promises only that we will try.
--
-- Both write `requested_at`; this column is what tells them apart. Without it
-- the scheduler cannot distinguish "aim late" from "aim exactly here", and a
-- caller who named a date and found it busy would silently be moved to the next
-- day instead of to the next hour.

alter table public.callback_requests
  add column requested_rank text;

comment on column public.callback_requests.requested_rank is
  'How to use requested_at: earliest | early | late | nearest. NULL behaves as earliest.';

-- The same vocabulary as SlotRank in src/lib/callbacks/schedule-policy.ts.
-- NULL is allowed and means 'earliest' — every row that predates this column,
-- and every path that does not care, keeps behaving exactly as it did.
alter table public.callback_requests
  add constraint callback_requests_requested_rank_valid
    check (requested_rank is null or requested_rank in ('earliest', 'early', 'late', 'nearest'));

-- Triage may now aim the search as well as narrow it: p_on_date replaces the
-- DATE the form guessed at, p_at_time the time of day, and the pair marks the
-- row 'nearest' so the engine closes in on it rather than stepping past it.
--
-- Both are optional and independent. A caller who wrote only "on the 10th"
-- keeps whichever time of day the form supplied; one who wrote only "after
-- four" is served by not_before_min and does not come through here at all.
create or replace function public.finish_callback_triage(
  p_request_id uuid,
  p_claimed_attempt smallint,
  p_status text,
  p_not_before_min smallint default null,
  p_not_after_min smallint default null,
  p_excluded_dates date[] default null,
  p_triage jsonb default null,
  p_error text default null,
  p_on_date date default null,
  p_at_time time default null
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
  existing_at timestamptz;
  new_at timestamptz;
  new_rank text;
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
  -- A moment the caller named is meaningless on a failed extraction.
  if p_status = 'failed' and (p_on_date is not null or p_at_time is not null) then
    raise exception 'a failed triage may not set a requested moment'
      using errcode = '22023';
  end if;

  select requested_at into existing_at from public.callback_requests where id = p_request_id;

  -- Composed rather than replaced: the date comes from what the caller wrote,
  -- the time of day from whichever source is more specific — the caller's own
  -- words first, else the band the form already resolved.
  if p_on_date is not null or p_at_time is not null then
    new_at :=
      (coalesce(p_on_date, (existing_at at time zone 'Asia/Jerusalem')::date)
        + coalesce(p_at_time, coalesce((existing_at at time zone 'Asia/Jerusalem')::time, time '09:00')))
      at time zone 'Asia/Jerusalem';
    new_rank := 'nearest';
  else
    new_at := existing_at;
    new_rank := null;
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
      requested_at = new_at,
      -- Only overridden when triage actually named a moment; otherwise the
      -- form's own choice stands untouched.
      requested_rank = coalesce(new_rank, requested_rank),
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

-- The old 8-argument signature is gone: `create or replace` cannot change a
-- function's parameter list, so the new one is a separate overload and the
-- previous one would linger and be chosen by any caller still passing eight.
drop function if exists public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text);

revoke all on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text, date, time) from public, anon, authenticated;
grant execute on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text, date, time) to service_role;

comment on function public.finish_callback_triage(uuid, smallint, text, smallint, smallint, date[], jsonb, text, date, time) is
  'Atomically finishes a claimed triage, fenced on the claimed attempt number. May also aim requested_at at a moment the caller named. Returns finalized | claim_lost | already_finalized | claim_inactive | not_found. Server-only.';

-- An inserting client may still create a request, but must leave every triage
-- field at its default — including the new rank.
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
