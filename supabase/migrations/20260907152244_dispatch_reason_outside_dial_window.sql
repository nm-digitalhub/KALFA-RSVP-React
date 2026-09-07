-- Add 'outside_dial_window' to the closed reason vocabulary of
-- call_dispatch_status.
--
-- dispatchOutreachCall gained gate 3b (2026-09-07): the admin-managed
-- per-weekday dialing window from /admin/callbacks/policy ("חיוג" tab) plus the
-- Shabbat/Yom-Tov block — the same policy the meeting-confirm and sales-close
-- dispatchers already honour. A manual dispatch refused by that gate settles as
-- status='skipped', reason='outside_dial_window'; without this constraint
-- update the settlement INSERT would violate the CHECK at runtime (the TS
-- union caught it at compile time first, as designed).
--
-- The original CHECK is anonymous inline (20260722170740); Postgres named it
-- call_dispatch_status_reason_check. Recreated verbatim plus the one value.
alter table public.call_dispatch_status
  drop constraint call_dispatch_status_reason_check;

alter table public.call_dispatch_status
  add constraint call_dispatch_status_reason_check
  check (reason is null or reason in
    ('already_reached', 'outside_dial_window', 'no_call_consent', 'dnc_listed',
     'campaign_not_active', 'event_closed', 'concurrent_owner',
     'max_concurrency', 'campaign_hour_cap', 'outreach_disabled',
     'config_missing', 'live_calls_disabled', 'balance_below_reserve',
     'already_dispatched', 'already_concluded', 'failed_to_start',
     'start_unknown', 'temporary_dispatch_failure'));
