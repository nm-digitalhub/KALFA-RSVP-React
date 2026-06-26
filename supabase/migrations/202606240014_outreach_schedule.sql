-- Conversion-focused outreach policy: an EVENT-DATE-ANCHORED touchpoint schedule
-- (a friendly drip leading up to the event to maximize reached contacts), instead
-- of fixed hour-gaps. Each touchpoint = { days_before, channel, message_key }.
-- Defined on the template (admin-tunable), copied+locked onto the campaign at
-- approval (§17). A verified human response stops the whole sequence (§301).
alter table public.packages
  add column if not exists outreach_schedule jsonb;
alter table public.campaigns
  add column if not exists outreach_schedule jsonb;

-- Seed the proposed default schedule on the active templates (KALFA tunes the
-- days + the per-message wording later). message_key references the approved
-- WhatsApp template / call script built in Phase 3-4.
update public.packages
set outreach_schedule = '[
  {"days_before":10,"channel":"whatsapp","message_key":"invite"},
  {"days_before":6,"channel":"whatsapp","message_key":"reminder_1"},
  {"days_before":3,"channel":"whatsapp","message_key":"reminder_2"},
  {"days_before":2,"channel":"call","message_key":"call_1"},
  {"days_before":1,"channel":"whatsapp","message_key":"final"}
]'::jsonb
where price_per_reached is not null;

-- Drop the superseded fixed-gap policy columns (unused; no live campaigns yet).
alter table public.packages
  drop column if exists whatsapp_attempts,
  drop column if exists whatsapp_reminder_gap_hours,
  drop column if exists escalation_delay_seconds,
  drop column if exists call_attempts,
  drop column if exists call_retry_gap_hours;
alter table public.campaigns
  drop column if exists whatsapp_attempts,
  drop column if exists whatsapp_reminder_gap_hours,
  drop column if exists escalation_delay_seconds,
  drop column if exists call_attempts,
  drop column if exists call_retry_gap_hours;
