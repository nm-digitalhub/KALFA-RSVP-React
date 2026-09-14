-- A voice-purpose call can now REPORT that it ended.
--
-- Until now `voice_purpose_attempts.dispatch_status` only described the
-- DISPATCH: pending -> confirmed (StartScenarios accepted) / failed / unknown.
-- Nothing described the CALL, because there was no route for a scenario to
-- report one — src/app/api/voximplant/purpose/<key>/ had `ctx` and no `cb`.
-- `finish_reason` was therefore only ever written by the dispatcher's own error
-- paths ('ambiguous_start_response', 'network_error_during_start'), never by an
-- actual outcome.
--
-- 'concluded' is that missing terminal state, and it is the state a workflow
-- step will wait for: 'confirmed' means the call STARTED, 'concluded' means it
-- ENDED and said how. Same word the sibling surfaces already use
-- (callback_request_attempts, sales_call_attempts), so the three read alike.
--
-- Safe to widen: nothing branches on this column today — it is written in four
-- places and read by no gate, cap or reconciler (verified 2026-09-14).
alter table public.voice_purpose_attempts
  drop constraint voice_purpose_attempts_dispatch_status_check;

alter table public.voice_purpose_attempts
  add constraint voice_purpose_attempts_dispatch_status_check check (
    dispatch_status = any (array['pending', 'confirmed', 'concluded', 'failed', 'unknown'])
  );

comment on column public.voice_purpose_attempts.dispatch_status is
  'pending = dispatching; confirmed = the call started; concluded = the scenario reported a terminal outcome; failed/unknown = the dispatch itself did not succeed.';
