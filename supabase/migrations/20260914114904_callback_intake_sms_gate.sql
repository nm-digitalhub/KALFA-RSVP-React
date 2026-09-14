-- The switch and the ceiling for the missed-call intake SMS.
--
-- Two columns rather than one because they answer different questions, and
-- the second is the one that survives a bad night:
--
--   * callback_intake_sms_enabled — OFF until someone decides to turn it on.
--     Default false on purpose: this migration ships the ability to text every
--     person who fails to reach us, and that is a decision, not a deployment.
--
--   * callback_intake_sms_daily_cap — every missed call costs a paid send, so
--     inbound volume is now a spend curve. On 2026-08-17 this account took a
--     flood of fraudulent inbound calls; with intake SMS armed and no ceiling,
--     the same flood would have billed us per call. The cap makes the worst
--     case a known number instead of an open one. Rows are still created and
--     callbacks still happen past the cap — only the texting stops.
--
-- Lives on app_settings (the id=true singleton) beside sms_enabled, so the
-- existing /admin/integrations/extra-sms screen is where both are managed:
-- one page owns "does this account send SMS, and how much".

alter table public.app_settings
  add column if not exists callback_intake_sms_enabled boolean not null default false,
  add column if not exists callback_intake_sms_daily_cap integer not null default 50;

alter table public.app_settings
  drop constraint if exists app_settings_callback_intake_sms_daily_cap_check;

alter table public.app_settings
  add constraint app_settings_callback_intake_sms_daily_cap_check
  check (callback_intake_sms_daily_cap between 0 and 10000);

comment on column public.app_settings.callback_intake_sms_enabled is
  'Send the intake-form SMS after a missed call. Default false — arming it is an explicit decision.';
comment on column public.app_settings.callback_intake_sms_daily_cap is
  'Maximum intake SMS per Israel civil day. 0 disables sending as surely as the flag. Bounds inbound-flood spend.';

-- Counting yesterday's sends has to be cheap: it runs before every send.
create index if not exists callback_requests_intake_sms_sent_at_idx
  on public.callback_requests (intake_sms_sent_at)
  where intake_sms_sent_at is not null;
