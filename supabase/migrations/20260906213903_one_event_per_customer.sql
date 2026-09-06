-- R10 — a customer account holds exactly ONE event, for the life of the account.
--
-- KALFA is a per-event B2C product: a customer buys one event, not a
-- subscription. Nothing enforced that. createEvent() checked only that someone
-- was signed in, so any customer could open unlimited events, and the events
-- list existed largely to let them.
--
-- FOREVER, not "one open at a time" (owner's decision, 2026-09-07): a closed
-- event does not free the account. A returning customer is a support
-- conversation, not a self-service signup.
--
-- STAFF ARE EXEMPT. The only account holding several events today is the
-- platform owner's, and those are test events. The exemption is keyed on the
-- ROW'S OWNER, never on the session: is_staff() answers "is the CALLER staff",
-- which would let a staff member create an unlimited number of events owned by
-- a customer. Here the question is whose account is being filled.
--
-- Why the trigger and not a unique index: a partial unique index needs an
-- IMMUTABLE predicate, and "…unless the owner is staff" is a lookup into
-- another table that changes as staff come and go. It would also reject the
-- platform owner's four existing rows outright.
--
-- Why the database at all, when createEvent() checks first: this is the
-- REST-proof authority, exactly as R1/R2 above it are. The app path is one
-- INSERT among the many PostgREST exposes to an authenticated user.
--
-- Verified before applying, in a rolled-back transaction against production: a
-- second event for each of the two real customers is refused, the platform
-- owner's fifth is allowed, and a brand-new account's first is allowed.

create or replace function public.events_before_insert()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare today_il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.status := 'draft';  -- R1
  if new.event_date is not null
     and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
    raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';  -- R2
  end if;
  -- R2b: LOWER BOUND ONLY. The CHECK events_rsvp_deadline_within_event (existing,
  -- UNCHANGED, untouched by this migration) already enforces "rsvp_deadline
  -- requires event_date" + "rsvp_deadline <= event_day_IL" unconditionally on
  -- every row — this trigger must NOT duplicate that, it adds only the one
  -- now()-dependent piece a CHECK cannot express.
  if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
    raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
  end if;
  -- R10: one event per customer account, staff exempt. Both lookups key on
  -- new.owner_id — the account being filled — never on auth.uid().
  if not exists (
        select 1 from public.platform_staff s where s.user_id = new.owner_id
      )
     and exists (
        select 1 from public.events e where e.owner_id = new.owner_id
      ) then
    raise exception 'an account may hold only one event' using errcode='check_violation';
  end if;
  return new;
end; $function$;

comment on function public.events_before_insert() is
  'Insert-time event invariants: R1 status forced to draft, R2 event_date >= tomorrow IL, R2b rsvp_deadline not in the past, R10 one event per customer account (platform staff exempt, keyed on owner_id).';
