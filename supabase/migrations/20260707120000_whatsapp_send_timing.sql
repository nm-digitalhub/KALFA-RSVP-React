begin;

-- WhatsApp send-timing for Israel (P0 + P1a).
-- See docs/whatsapp-send-timing-implementation-plan-2026-07-07.md.

-- app_settings.whatsapp_send_policy: the SINGLE validated send-window policy,
-- read server-side. The app falls back to the coded DEFAULT when null/invalid
-- (parseSendPolicy), and an admin edit can only NARROW the window.
alter table public.app_settings
  add column if not exists whatsapp_send_policy jsonb;

comment on column public.app_settings.whatsapp_send_policy is
  'Israel WhatsApp send-timing policy (weekday windows, hardCap, motzashPlusMin, preferred times, spread). Validated by parseSendPolicy; null -> coded DEFAULT.';

-- Seed the singleton with the v1 defaults (matches DEFAULT_SEND_POLICY):
-- Sun-Thu 09:00-20:30, Fri 09:00-12:00, Sat null, hardCap 21:00, motzash 60,
-- 7d->11:00 / 3d->17:30, 90-min spread, Jerusalem.
update public.app_settings
set whatsapp_send_policy = jsonb_build_object(
  'weekday', jsonb_build_array(
    jsonb_build_object('start','09:00','end','20:30'),
    jsonb_build_object('start','09:00','end','20:30'),
    jsonb_build_object('start','09:00','end','20:30'),
    jsonb_build_object('start','09:00','end','20:30'),
    jsonb_build_object('start','09:00','end','20:30'),
    jsonb_build_object('start','09:00','end','12:00'),
    null
  ),
  'hardCap', '21:00',
  'motzashPlusMin', 60,
  'preferredTimeByDaysBefore', jsonb_build_object('7','11:00','3','17:30','1','11:00'),
  'defaultPreferred', '11:00',
  'spreadSpanMs', 5400000,
  'location', 'jerusalem'
)
where id = true and whatsapp_send_policy is null;

-- outreach_state.planned_at: the first-decided send instant for the CURRENT step
-- (distinct from the pg-boss startAfter and the logical det id). Cleared on an
-- explicit re-plan (event-date edit / campaign cancel) so a future step re-plans.
alter table public.outreach_state
  add column if not exists planned_at timestamptz;

comment on column public.outreach_state.planned_at is
  'First-decided send instant for the current step (send-timing re-plan anchor).';

commit;
