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

-- General per-guest lookup: "has this contact received message_key X in this
-- campaign?" — a targeted partial index (outbound rows only), useful for
-- future per-type breakdown reads. NOT unique — invite/gift/event_day_pay can
-- legitimately have several outbound rows per contact (reminders, retries).
create index if not exists contact_interactions_dedup_idx
  on public.contact_interactions (campaign_id, contact_id, message_key)
  where direction = 'out' and message_key is not null;

-- (c) The ACTUAL 131049 mitigation is atomic claim-before-send, not a
-- read-then-filter check. A read-then-filter (SELECT prior rows, then send to
-- whoever's missing) has a check-then-act race: the manual button (web) and
-- the sweep (worker) — or two overlapping sweep ticks — can both read "not
-- yet thanked" for the same contact before either has written a row, and both
-- send. A partial UNIQUE index makes a second claim for the SAME
-- (campaign, contact) thank-you impossible at the DB level, REGARDLESS of
-- which process gets there first or how many run concurrently. Scoped to
-- thank-you outbound rows only (via the WHERE clause) — it must not affect
-- invite/gift/event_day_pay, which legitimately have multiple rows per
-- contact.
create unique index if not exists contact_interactions_thankyou_claim_uq
  on public.contact_interactions (campaign_id, contact_id)
  where message_key = 'thankyou' and direction = 'out';

-- claim_thankyou_recipient: the atomic reserve step. Called BEFORE the
-- WhatsApp send (never after) — inserts a placeholder row (a synthetic
-- provider_id, since the column is NOT NULL and the real one doesn't exist
-- yet); `ON CONFLICT ... DO NOTHING` against the partial unique index above
-- means a second caller for the same (campaign, contact) gets zero rows
-- inserted, and FOUND is false. The caller (sendCampaignWhatsApp) checks the
-- return value BEFORE calling the provider — a lost race means "someone else
-- is/was already sending this contact's thank-you", never a double-send.
--
-- On an ACCEPTED send, the caller UPDATEs this SAME row's provider_id to the
-- real one (a plain UPDATE, not through this function) so Meta's delivery-
-- status webhook can find it by provider_id like every other message. On a
-- FAILED/uncertain send, the row is left as-is — deliberately PERMANENT, not
-- released for retry. This mirrors the codebase's existing at-most-once
-- philosophy (see src/lib/outreach/enqueue.ts: "a prior real send may already
-- have happened... both branches are non-sending" — prefer a rare missed
-- send over ANY chance of a double send) and matches the plan's own stance
-- (no auto-retry on a failed/uncertain outcome; "resend to non-delivered" is
-- an explicit, deferred, MANUAL P2 feature). The only scenario this can
-- "strand" a contact is a hard process crash between the claim and the send
-- attempt — accepted as a known, narrow limitation, same class as the
-- existing under-count risk elsewhere in the outreach engine.
--
-- EXCEPTION WHEN unique_violation (ty-inspector finding): the placeholder
-- provider_id is deterministic — 'thankyou-claim:' || campaign || ':' ||
-- contact — so it is ALWAYS the exact same row that the partial index above
-- guards; the two constraints can never diverge (one guarding a duplicate the
-- other doesn't). Empirically verified (isolated scratch DB, a real
-- concurrent race via two overlapping uncommitted transactions — not just
-- sequential calls in one session): the ON CONFLICT arbiter's wait-then-
-- recheck protocol already resolves this cleanly via DO NOTHING, with NO raw
-- 23505 surfacing, even without this handler. The handler is added anyway as
-- defense-in-depth (a future change to the placeholder scheme that broke that
-- invariant would otherwise leak a raw DB error instead of a clean
-- 'already_claimed' — worse observability, not a correctness gap, but not
-- free to leave unguarded either).
create or replace function public.claim_thankyou_recipient(
  p_campaign uuid, p_contact uuid, p_event uuid
) returns text language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.contact_interactions (
    campaign_id, contact_id, event_id, channel, direction, kind,
    message_key, provider_id, billable
  )
  values (
    p_campaign, p_contact, p_event, 'whatsapp', 'out', 'template',
    'thankyou', 'thankyou-claim:' || p_campaign::text || ':' || p_contact::text, false
  )
  on conflict (campaign_id, contact_id)
    where message_key = 'thankyou' and direction = 'out'
  do nothing;
  if found then return 'claimed'; end if;
  return 'already_claimed';
exception
  when unique_violation then
    return 'already_claimed';
end; $$;

revoke all on function public.claim_thankyou_recipient(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_thankyou_recipient(uuid, uuid, uuid) to service_role;

-- NOTE: no pacing/delay column here. Re-attributed 2026-07-12 (plan update):
-- 131049 is a PER-RECIPIENT marketing-template limit, not a throughput cap —
-- the empirical failure was repeated sends to the SAME number, which the
-- per-guest dedup above already prevents entirely. A pacing delay between
-- DIFFERENT recipients would not affect 131049 and was dropped as unnecessary
-- (and needlessly broad, since it would also touch the existing gift/
-- event_day_pay manual-send loop) complexity.
