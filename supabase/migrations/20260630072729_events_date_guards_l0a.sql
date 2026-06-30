-- L0a — Event schedule integrity (DRAFT — NOT yet applied).
-- Audit: plans/authz-audit-unified-report.md §7 + "Control of the L0 DB-fixes".
--
-- Enforced at the DB because public.events is owner-writable via PostgREST, so a
-- Zod-only guard is bypassable. Forward-only.
--
-- Verified types (preflight, live): events.event_date = timestamp with time zone;
-- events.rsvp_deadline = date. "Past event" = a calendar day in Israel (the UI
-- uses <input type="date">, no time-of-day):
--   past  ==  (event_date AT TIME ZONE 'Asia/Jerusalem')::date
--             < (now()       AT TIME ZONE 'Asia/Jerusalem')::date
--
-- SCOPE — this migration contains ONLY:
--   * LC-1  two triggers guarding events.event_date against past dates
--   * LC-2  one CHECK: rsvp_deadline on/before the event day (NULL policy: a
--           deadline requires an event_date)
-- It deliberately does NOT touch: the status='draft' companion CHECK, LC-3
-- (date-lock under a committed campaign), close_at, assertEventNotPast, any
-- RSVP / worker / billing path, or any RLS / SECURITY DEFINER object.
--
-- Pre-flight (live, 3 events): 0 rows violate LC-2 -> the CHECK is added VALID
-- (no NOT VALID). The 1 existing past-dated event is unaffected: LC-1 is a trigger
-- and fires only on INSERT or on an UPDATE that actually changes event_date.

-- ─────────────────────────────────────────────────────────────────────────────
-- LC-2 — rsvp_deadline must fall on/before the event day (Israel), with an
-- explicit NULL policy. A CHECK is valid here: the expression is static,
-- same-row, and IMMUTABLE (timezone(text, timestamptz) and date(timestamp
-- without time zone) are both IMMUTABLE). Added VALID (preflight is clean).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.events
  add constraint events_rsvp_deadline_within_event
  check (
    rsvp_deadline is null
    or (
      event_date is not null
      and rsvp_deadline <= (event_date at time zone 'Asia/Jerusalem')::date
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- LC-1 — event_date must not be before today (calendar day, Israel).
-- A trigger, NOT a CHECK: now() is non-immutable (a CHECK using it would break
-- pg_dump/restore and spuriously fail later edits to an already-past row).
-- TWO triggers because a BEFORE INSERT trigger has no OLD row.
-- SECURITY INVOKER + empty search_path (the body has no table refs — only
-- now()/AT TIME ZONE from pg_catalog — so '' is safe and satisfies advisor 0011).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.events_reject_past_event_date()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if new.event_date is not null
     and (new.event_date at time zone 'Asia/Jerusalem')::date
         < (now() at time zone 'Asia/Jerusalem')::date
  then
    raise exception
      'event_date % is before today in Israel; past events are not allowed',
      new.event_date
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- INSERT path: validate event_date only when it is provided (NULL is allowed for
-- a draft with no date yet).
create trigger events_reject_past_event_date_insert
  before insert on public.events
  for each row
  execute function public.events_reject_past_event_date();

-- UPDATE path: fires ONLY when event_date is in the SET list AND its value
-- actually changes — so editing name / venue / any other field of a past event
-- is never blocked (the trigger does not fire), and re-submitting the same date
-- is a no-op.
create trigger events_reject_past_event_date_update
  before update of event_date on public.events
  for each row
  when (old.event_date is distinct from new.event_date)
  execute function public.events_reject_past_event_date();
