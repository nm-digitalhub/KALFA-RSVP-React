-- Auto-thankyou (post-event) — schema for the periodic worker sweep + the
-- 131049-safe dedup it depends on (docs/auto-thankyou-post-event plan,
-- decisions confirmed 2026-07-12).
--
-- (a) campaigns: the sweep's own scheduling state. One campaign per event, so
--     these live beside the campaign's other lifecycle columns (start_at,
--     close_at, status) rather than on events. Opt-in default true (owner can
--     disable/reschedule any time before the sweep fires — read fresh each
--     tick, no pg-boss job to cancel). thankyou_sent_at is a coarse
--     already-processed marker for the SWEEP QUERY only (skip re-scanning a
--     campaign every 5 min) — it is NOT the dedup guarantee; the real
--     per-guest dedup is contact_interactions.message_key below, which also
--     survives a partial-batch failure (a crash after sending 30/50 must not
--     re-send to the 30 on the next tick).
alter table public.campaigns
  add column if not exists thankyou_auto_enabled boolean not null default true,
  add column if not exists thankyou_send_at timestamptz,
  add column if not exists thankyou_sent_at timestamptz;

comment on column public.campaigns.thankyou_auto_enabled is
  'Owner opt-in for the automatic post-event thank-you sweep. Default true '
  '(cancel window): the worker re-reads this + thankyou_send_at + event.status '
  'on every sweep tick, fail-closed.';
comment on column public.campaigns.thankyou_send_at is
  'When the auto thank-you is eligible to fire (Israel wall-clock instant). '
  'Defaulted at campaign-activation time to the morning after event_date '
  '~10:00 Asia/Jerusalem; owner-editable up until the sweep fires.';
comment on column public.campaigns.thankyou_sent_at is
  'Set once the sweep has processed this campaign (whether or not any send '
  'occurred) — a cheap filter to stop re-scanning it, NOT the dedup mechanism '
  'itself (see contact_interactions.message_key).';

-- Sweep query shape: campaigns due AND not yet processed AND opted in. Partial
-- index keeps the every-5-minutes scan cheap regardless of table growth.
create index if not exists campaigns_thankyou_due_idx
  on public.campaigns (thankyou_send_at)
  where thankyou_auto_enabled and thankyou_sent_at is null;

-- (b) contact_interactions: tag which touchpoint an outbound row belongs to.
--     One campaign carries every message_key for its event (invite/gift/
--     event_day_pay/thankyou all share campaign_id), so without this a
--     per-guest "already thanked in this campaign" check cannot distinguish
--     a thank-you from any other send to the same contact. Nullable + no
--     backfill: no thank-you has ever been sent, and every other reader of
--     this table (getCampaignDeliveryBreakdown) is unaffected by nulls on
--     pre-existing rows.
alter table public.contact_interactions
  add column if not exists message_key text;

comment on column public.contact_interactions.message_key is
  'The outreach_schedule/manual-send message_key this outbound row belongs to '
  '(e.g. thankyou, gift, event_day_pay). Nullable — populated going forward '
  'only; used for per-guest per-message-type dedup (auto-thankyou sweep).';

-- Per-guest dedup lookup: "has this contact already received message_key X in
-- this campaign?" — a targeted partial index (outbound rows only) rather than
-- a broad one, since inbound rows never participate in this check.
create index if not exists contact_interactions_dedup_idx
  on public.contact_interactions (campaign_id, contact_id, message_key)
  where direction = 'out' and message_key is not null;

-- NOTE: no pacing/delay column here. Re-attributed 2026-07-12 (plan update):
-- 131049 is a PER-RECIPIENT marketing-template limit, not a throughput cap —
-- the empirical failure was repeated sends to the SAME number, which the
-- per-guest dedup above already prevents entirely. A pacing delay between
-- DIFFERENT recipients would not affect 131049 and was dropped as unnecessary
-- (and needlessly broad, since it would also touch the existing gift/
-- event_day_pay manual-send loop) complexity.
