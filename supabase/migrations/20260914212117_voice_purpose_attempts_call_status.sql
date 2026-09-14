-- The scenario's own normalized verdict, kept instead of being thrown away.
--
-- WHAT WAS WRONG. The purpose callback receives two separate facts:
--
--     call_status   'completed' | 'no_answer' | 'no_response' | 'failed'
--     error_reason  free text, e.g. 'ctx_parse_error', 'sip_486'
--
-- and the route collapsed them with `body.error_reason ?? body.call_status`
-- into the single `finish_reason` column. Whenever an error_reason was present
-- the normalized status was DISCARDED — and the scenarios do send both
-- together (MeetingConfirmAgent.voxengine.js:327 sends call_status:'failed'
-- with error_reason:'missing_secret'; also ctx_parse_error, ctx_fetch_error,
-- ctx_fetch_failed_<code>).
--
-- The consequence was a wrong answer, not just a lost field. `toBusinessOutcome`
-- reads the row back, sees dispatch_status='concluded' and a finish_reason it
-- does not recognise, and falls to its `default: return 'completed'` — whose
-- reasoning ("it CONCLUDED, so the call reached the guest and ended") is sound
-- for an unmapped SUCCESS reason and false for an error string. A call that
-- never fetched its context was therefore reported to the workflow as COMPLETED,
-- and a diagram took the success branch for a guest nobody spoke to.
--
-- Additive and nullable on purpose: every existing row keeps its finish_reason,
-- and the mapping falls back to the old finish_reason logic when this column is
-- null, so nothing already recorded changes meaning.

alter table public.voice_purpose_attempts
  add column if not exists call_status text;

comment on column public.voice_purpose_attempts.call_status is
  'The scenario''s own normalized verdict (completed | no_answer | no_response | failed), kept apart from finish_reason so an error string cannot hide it. Null on rows written before 2026-09-15.';
