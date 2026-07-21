-- =====================================================================
-- schedule_callback, dispatch half: let the callback sweep claim a due
-- callback exactly once.
--
-- 20260719180805 captured the guest's request (callback_requested_at /
-- callback_when_text / callback_iso) and stopped there, with the data layer's
-- own comment admitting it: "Re-enqueuing the actual call is a KALFA
-- dispatcher follow-up" (src/lib/data/call-attempts.ts). The result is a
-- promise made to a guest in conversation and then buried in a column — the
-- agent says it will call back, and nothing ever does.
--
-- ONE additive nullable column, because the claim must be atomic. The sweep
-- runs every 5 minutes on a pg-boss cron; two overlapping ticks (or a retry
-- after a partial failure) must not dial the guest twice. The claim is a
-- single UPDATE ... WHERE callback_dispatched_at IS NULL, so exactly one
-- caller can ever win it — the same compare-and-set discipline the campaign
-- step cursor and the thank-you sweep already use, not a read-then-write.
--
--   * callback_dispatched_at timestamptz -- when the sweep claimed this
--       callback and enqueued the re-dial. NULL = still owed. Set BEFORE the
--       dial is attempted: a claimed-but-failed callback stays claimed by
--       design, because silently retrying a phone call to a guest is worse
--       than not retrying it. Recovery is deliberate (clear the column).
--
-- callback_count (integer not null default 0, added by 20260714160000 and
-- never written by anything since) is finally used for what its name says:
-- the claim increments it, and the returned value distinguishes each callback
-- re-dial's touchpoint_index. call_attempts is UNIQUE(campaign_id,
-- contact_id, touchpoint_index), so the re-dial needs an index that cannot
-- collide with a real campaign touchpoint; the dispatcher offsets it by a
-- documented base.
--
-- Partial index: the sweep asks "what is due and unclaimed?" every 5 minutes
-- forever, and that predicate matches a tiny fraction of call_attempts. A
-- partial index keeps the scan proportional to the callbacks owed rather than
-- to every call ever placed.
--
-- No RLS/policy/GRANT changes: call_attempts already has RLS enabled and
-- table-level grants that cover new columns automatically (same basis as
-- 20260719180805, VERIFIED-LIVE 2026-07-19).
--
-- Rollback:
--   drop index if exists public.call_attempts_callback_due_idx;
--   alter table public.call_attempts drop column if exists callback_dispatched_at;
-- =====================================================================

alter table public.call_attempts
  add column if not exists callback_dispatched_at timestamptz;

comment on column public.call_attempts.callback_dispatched_at is
  'When the callback sweep claimed this request and enqueued the re-dial. NULL = a callback is still owed. Written by an atomic compare-and-set (WHERE callback_dispatched_at IS NULL) so a due callback is dispatched at most once; set BEFORE dialling, so a failed dial stays claimed rather than silently re-calling the guest.';

comment on column public.call_attempts.callback_count is
  'How many callback re-dials have been claimed for this attempt. Incremented by the same atomic claim that sets callback_dispatched_at; the value distinguishes each re-dial''s touchpoint_index under UNIQUE(campaign_id, contact_id, touchpoint_index).';

-- Due + unclaimed only — the exact predicate the sweep runs.
create index if not exists call_attempts_callback_due_idx
  on public.call_attempts (callback_iso)
  where callback_iso is not null and callback_dispatched_at is null;
