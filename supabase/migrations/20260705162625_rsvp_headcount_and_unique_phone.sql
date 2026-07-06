-- Headcount-after-RSVP flow + one-guest-per-phone (owner decisions 2026-07-05;
-- plan: plans/rsvp-headcount-flow-plan.md). Live preflight before authoring:
-- ZERO existing duplicate phones among guests — the unique index is safe.

-- One guest row per phone per event. Uniqueness is on the NORMALIZED digits
-- (strip separators; unify the 972 international prefix to the local 0 form)
-- so '050-123-4567' and '+972501234567' collide as intended. NULL/empty
-- phones stay unlimited (phone is optional product-wide).
create unique index if not exists guests_event_phone_key
  on public.guests (
    event_id,
    (
      case
        when regexp_replace(phone, '\D', '', 'g') ~ '^972'
          then '0' || substring(regexp_replace(phone, '\D', '', 'g') from 4)
        else regexp_replace(phone, '\D', '', 'g')
      end
    )
  )
  where phone is not null and phone <> '';

-- Headcount collection state ("כמה תגיעו? 1-10"):
--   confirmed_headcount 0 = NOT ANSWERED YET (the owner's chosen default) —
--   reports must render 0 as "טרם נענה", never as "אפס מגיעים".
--   attempts caps the 0-answer re-ask loop (app enforces max 3).
alter table public.guests
  add column if not exists confirmed_headcount integer not null default 0
    constraint guests_confirmed_headcount_range check (
      confirmed_headcount between 0 and 10
    ),
  add column if not exists headcount_requested_at timestamptz,
  add column if not exists headcount_answered_at timestamptz,
  add column if not exists headcount_attempts integer not null default 0;
