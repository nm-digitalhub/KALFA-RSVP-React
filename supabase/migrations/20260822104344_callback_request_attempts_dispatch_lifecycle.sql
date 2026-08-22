-- Dispatch-lifecycle columns for callback_request_attempts.
--
-- Follow-up to 20260822103442_callback_request_attempts_token_surface.sql,
-- which deliberately left these out (the dispatcher that would write them
-- was explicit future implementation work, not yet designed). Now designed:
-- voximplant-engineer's confirmation-dispatch sweep (meeting-booking plan
-- SS11a) needs somewhere to track whether the CALL ITSELF was placed,
-- separate from confirmation_call_status (the call's semantic result,
-- written by the scenario's tool calls). Same axis-split lesson
-- callback_requests.status vs. call_outcome already encodes twice over (see
-- 20260819212112/20260819233736) -- dispatch_status here is the scheduling/
-- placement axis, confirmation_call_status (already on this table) is the
-- outcome axis. Proposed by voximplant-engineer 2026-08-22, reviewed and
-- accepted with one correction (see below).
--
-- dispatch_status vocabulary: queued (row created, not yet dialed) / dialing
-- / in_progress (mirrors call_attempts' own PRE_TERMINAL states exactly, so
-- the dispatcher's concurrency-cap count can reuse that shape) / concluded
-- (the call session ended -- business outcome is confirmation_call_status,
-- not this column) / failed_to_start / start_unknown (StartScenarios
-- definite-vs-ambiguous result classification, same pattern
-- dispatchOutreachCall already uses in outreach-calls.ts).
--
-- vox_call_session_history_id is TEXT, not the bigint originally proposed.
-- Correction: the sibling column on call_attempts is TEXT (verified live),
-- and src/lib/data/call-attempts.ts:473 explicitly writes
-- `vox_call_session_history_id: String(ids.callSessionHistoryId)` rather
-- than storing the SDK's `number` (core.ts:738) directly -- an existing,
-- deliberate choice for this exact field, not an oversight to diverge from.
-- Matched here for consistency with the established convention.
--
-- finish_reason / call_duration_sec: same shape and meaning as their
-- call_attempts namesakes.
--
-- Partial index on (dispatch_status, created_at) WHERE dispatch_status in
-- ('queued','dialing','in_progress'): mirrors call_attempts_stale_idx
-- exactly. Justified now, not speculative -- voximplant-engineer named the
-- concrete need (the dispatcher's concurrency-cap count) when proposing
-- dispatch_status.
--
-- No RLS/GRANT changes: this table's posture (RLS on, zero policies, no
-- anon/authenticated grants) was set in the parent migration and is
-- unaffected by adding columns.
--
-- Validated: run inside an explicit BEGIN/ROLLBACK against the linked
-- project (2026-08-22), confirming the ALTER, CHECK, and index all apply
-- cleanly against the live (already-applied) parent table, then rolled back.
-- NOT applied outside that transaction -- left staged pending team-lead
-- go/no-go, same as the parent migration.
--
-- Rollback: drop index callback_request_attempts_dispatch_pending_idx; alter
-- table public.callback_request_attempts drop constraint
-- callback_request_attempts_dispatch_status_valid, drop column dispatch_status,
-- drop column vox_call_session_history_id, drop column finish_reason, drop
-- column call_duration_sec.

alter table public.callback_request_attempts
  add column dispatch_status              text not null default 'queued',
  add column vox_call_session_history_id  text,
  add column finish_reason                text,
  add column call_duration_sec            integer;

alter table public.callback_request_attempts
  add constraint callback_request_attempts_dispatch_status_valid
    check (dispatch_status = any (array['queued', 'dialing', 'in_progress', 'concluded', 'failed_to_start', 'start_unknown']));

create index callback_request_attempts_dispatch_pending_idx
  on public.callback_request_attempts (dispatch_status, created_at)
  where dispatch_status in ('queued', 'dialing', 'in_progress');

comment on column public.callback_request_attempts.dispatch_status is
  'Whether the confirmation call ITSELF was placed -- a separate axis from confirmation_call_status (the semantic result). queued/dialing/in_progress are pre-terminal (mirrors call_attempts); concluded/failed_to_start/start_unknown are terminal dispatch outcomes, independent of what the call accomplished.';
comment on column public.callback_request_attempts.vox_call_session_history_id is
  'Voximplant StartScenarios result id, stored as text to match call_attempts.vox_call_session_history_id and src/lib/data/call-attempts.ts String(callSessionHistoryId) convention -- not the SDK number type directly.';
comment on column public.callback_request_attempts.finish_reason is
  'Voximplant call-termination reason string (e.g. "Insufficient funds") -- same meaning as call_attempts.finish_reason.';
comment on column public.callback_request_attempts.call_duration_sec is
  'Call duration in seconds, same meaning as call_attempts.call_duration_sec.';
