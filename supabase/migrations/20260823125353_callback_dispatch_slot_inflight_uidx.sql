-- Meeting-confirm dispatch dedup: unique per slot only while IN-FLIGHT.
--
-- Incident 2026-08-23: a meeting-confirm call placed the previous evening
-- (owner-approved exception) ended with NO semantic outcome
-- (confirmation_call_status stayed 'not_sent' — the guest never confirmed),
-- but the old FULL-slot unique index
--   (callback_request_id, scheduled_at_snapshot) WHERE issued_via='dispatch'
-- meant that terminal, outcome-less attempt permanently occupied the slot:
-- the scheduled 09:00 dispatch hit 23505, resolved 'already_dispatched', and
-- the meeting went unconfirmed with no retry ever possible.
--
-- The index's real job is concurrency protection — ONE in-flight dial per
-- slot — not forever-once semantics. Narrowing the predicate to the
-- pre-terminal statuses keeps the double-dial guarantee while letting a new
-- attempt exist alongside terminal history rows (full audit preserved).
-- "Never redial after a REAL outcome" moves to the dispatcher, which now
-- checks confirmation_call_status across the slot's attempts before dialing;
-- total volume stays capped by the existing 3-attempt audited cap.
--
-- Order: create the narrower index first, then drop the old one — the
-- narrower predicate is a subset of the old, so creation cannot fail on
-- existing data, and there is no window without concurrency protection.

CREATE UNIQUE INDEX callback_request_attempts_dispatch_slot_inflight_uidx
  ON public.callback_request_attempts (callback_request_id, scheduled_at_snapshot)
  WHERE issued_via = 'dispatch'
    AND dispatch_status IN ('queued', 'dialing', 'in_progress');

DROP INDEX public.callback_request_attempts_dispatch_slot_uidx;
