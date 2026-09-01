-- Makes the dial-attempt cap and its lookback window admin-editable
-- (/admin/callbacks/policy), matching the day-of-week/hours fields already
-- on this table. Previously CALLBACK_MAX_ATTEMPTS (=3) and a 30-day window
-- were hardcoded, duplicated in three files: console-calls.ts,
-- callback-request-attempts.ts and sales-call-attempts.ts — all three now
-- read from this table via getCallbackPolicy() (src/lib/callbacks/policy-config.ts).
--
-- Defaults below match the hardcoded values verbatim so existing behavior is
-- unchanged until an admin edits them.

alter table public.callback_schedule_policies
  add column max_attempts smallint not null default 3,
  add column attempt_window_days smallint not null default 30;

alter table public.callback_schedule_policies
  add constraint callback_schedule_policies_max_attempts_check
    check (max_attempts between 1 and 20),
  add constraint callback_schedule_policies_attempt_window_days_check
    check (attempt_window_days between 1 and 365);

update public.callback_schedule_policies
set max_attempts = 3, attempt_window_days = 30
where id = true;

comment on column public.callback_schedule_policies.max_attempts is
  'Ceiling on dial attempts per callback_request_id (or sales-call target) within attempt_window_days. Shared budget across console-calls.ts, callback-request-attempts.ts and sales-call-attempts.ts (all count the same CONSOLE_DIAL_AUDIT_ACTION activity_log rows).';

comment on column public.callback_schedule_policies.attempt_window_days is
  'Rolling lookback window (days) for counting attempts toward max_attempts.';
