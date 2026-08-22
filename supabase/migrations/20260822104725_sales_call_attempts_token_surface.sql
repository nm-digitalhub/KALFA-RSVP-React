-- Voice-call token/dispatch bookkeeping for the sales-closing agent's
-- outbound call on a callback_requests row (topic = 'מכירות').
--
-- Why a second table rather than reusing callback_request_attempts
-- (20260822103442_callback_request_attempts_token_surface.sql): structurally
-- different call. The meeting-booking agent's call is a short confirm/
-- reschedule PING ahead of a separate human call -- its
-- confirmation_call_status is a genuine second axis alongside
-- callback_requests.call_outcome, because the ping is not the substantive
-- interaction. The sales-closing agent's call IS the substantive
-- interaction (qualify/pricing/objections/verbal-commitment) -- there is no
-- separate human call it is confirming. Confirmed directly from the actual
-- drafted tool schema, not inferred: docs/voice-agent/plans/2026-08-22-
-- sales-closing-agent-script-draft.md's log_outcome tool (lines 322-337)
-- describes itself as writing "the real call outcome ON THE
-- callback_requests row", called through the EXISTING applyCallOutcome()
-- function (callback-scheduling.ts) -- the same one the human-worked flow
-- already uses. So this table carries NO outcome/confirmation-status column
-- at all -- that would be a second, competing outcome axis for a call that
-- only has one. (This also settles that the terminal-outcome vocabulary
-- itself, and whether escalated_to_human needs a CHECK-constraint addition
-- to callback_requests.call_outcome, is a SEPARATE later migration on
-- callback_requests -- not part of this table, not blocked by it.)
--
-- No issued_via discriminator (unlike callback_request_attempts): every row
-- here is dispatch-originated. Confirmed with voximplant-engineer 2026-08-22
-- -- unlike the meeting-booking confirmation call (which also has a live,
-- inbound-identification issuance path via the inbound-answering agent), the
-- sales-closing call fires AT callback_requests.scheduled_at, replacing what
-- a human rep does today at that slot (same DEFAULT_CALLBACK_POLICY/
-- findCallbackSlot-computed slot, same mechanism runCallbackSchedulingSweep
-- already uses -- this table's dispatcher automates WHO dials at an
-- already-computed slot, not WHEN). No live-call-time issuance path exists
-- for this persona.
--
-- No discount_tier_offered/discount_tier_applied: per plan §11 these extend
-- "§4's outcome record", which is callback_requests (see above) -- and the
-- log_outcome tool schema pairs discount_tier_applied with outcome in the
-- SAME call, onto the SAME row, confirming the target. Deferred to a
-- separate, later migration on callback_requests when apply_discount_tier
-- actually ships (tier-1 discount authority, if/when approved) -- not part
-- of this table.
--
-- dispatch_status / vox_call_session_history_id / finish_reason /
-- call_duration_sec: same shape, vocabulary, and reasoning as
-- callback_request_attempts' dispatch-lifecycle columns
-- (20260822104344_callback_request_attempts_dispatch_lifecycle.sql) --
-- dispatch_status tracks whether the call ITSELF was placed (queued/dialing/
-- in_progress pre-terminal, concluded/failed_to_start/start_unknown
-- terminal), independent of what the call accomplished (which, per above,
-- lives entirely on callback_requests here). vox_call_session_history_id is
-- TEXT to match call_attempts' sibling column and
-- src/lib/data/call-attempts.ts:473's String(callSessionHistoryId)
-- convention, not the SDK's raw number type.
--
-- el_conversation_id: present (unlike callback_request_attempts, which has
-- no equivalent yet), unique when set -- same shape as
-- call_attempts.el_conversation_id (see
-- 20260719170227_el_call_analysis_qa_columns.sql: `unique index ... where
-- el_conversation_id is not null`), matched here per voximplant-engineer's
-- request 2026-08-22 for consistency with that established pattern.
--
-- unique index (callback_request_id, scheduled_at_snapshot), NO predicate
-- (unlike callback_request_attempts' issued_via-scoped partial index):
-- reasoned through with voximplant-engineer 2026-08-22. A first draft
-- proposed excluding failed_to_start rows from the uniqueness (to allow a
-- same-slot retry) -- rejected: failed_to_start is a StartScenarios-level
-- provider rejection, and src/lib/voximplant/core.ts is explicit that
-- StartScenarios must never be blind-retried ("a blind retry could place a
-- second live call"); dispatchOutreachCall's own handling of it is terminal-
-- for-that-attempt + alert, never an automatic redial -- this codebase
-- already treats that failure class as non-retryable by design, everywhere
-- else it occurs. The only legitimate case for a second row against the
-- same callback_request_id is a genuine reschedule to a NEW scheduled_at
-- (via the ordinary 3-strikes-no_answer path or an admin reschedule) --
-- which produces a new scheduled_at_snapshot at the next dispatch and never
-- collides with a plain (no predicate) unique constraint. This is also the
-- atomic-create target: INSERT ... ON CONFLICT (callback_request_id,
-- scheduled_at_snapshot) DO NOTHING, no read-then-insert, matching
-- dispatchOutreachCall's existing pattern.
--
-- Partial index (dispatch_status, created_at) WHERE dispatch_status in
-- ('queued','dialing','in_progress'): mirrors callback_request_attempts'
-- own dispatch_pending_idx exactly, for the sales dispatcher's own
-- concurrency-cap count (same stated need voximplant-engineer gave for the
-- meeting-booking table's equivalent index).
--
-- FK on delete restrict, RLS on with zero policies, anon/authenticated
-- grants explicitly revoked (public schema's default ACL otherwise grants
-- them automatically -- verified live via pg_default_acl, same trap
-- documented in 20260812153317_callcenter_s1_call_attempts_revoke_client_
-- grants.sql): identical reasoning and posture to
-- callback_request_attempts, not repeated in full here.
--
-- STATUS -- do not push without an explicit go, same process as the other
-- two migrations in this series (owner runs `db push` directly, confirmed
-- 2026-08-22 via team-lead). Additionally: the surrounding sales-closing
-- feature's attorney sign-off on the agent's script (plan line 233) is NOT
-- done as of this migration's authoring -- the owner has explicitly chosen
-- to continue building/staging ahead of that sign-off (their own stated
-- business-risk call, relayed via team-lead), which is why this table is
-- being built now. That decision covers building and staging; it does not
-- by itself make THIS migration push-ready -- treat as staged-only pending
-- a further explicit go, same as call_request_attempts before it.
--
-- Validated: run inside an explicit BEGIN/ROLLBACK against the linked
-- project (2026-08-22), confirming the table, both CHECK-backed and plain
-- unique indexes, the partial index, RLS state, and the anon/authenticated
-- grant revoke all take effect as written, then rolled back. NOT applied
-- outside that transaction.
--
-- Rollback: drop table public.sales_call_attempts (nothing else references
-- it yet).

create table public.sales_call_attempts (
  id                          uuid primary key default gen_random_uuid(),
  callback_request_id         uuid not null references public.callback_requests(id) on delete restrict,
  access_token                text not null unique,        -- 32 hex (randomBytes(16)); URL path secret
  token_expires_at            timestamptz not null,
  scheduled_at_snapshot       timestamptz not null,         -- callback_requests.scheduled_at at dispatch time
  dispatch_status              text not null default 'queued',
  vox_call_session_history_id text,
  finish_reason                text,
  call_duration_sec           integer,
  el_conversation_id          text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),   -- app-written, no trigger (matches call_attempts)
  constraint sales_call_attempts_dispatch_status_valid
    check (dispatch_status = any (array['queued', 'dialing', 'in_progress', 'concluded', 'failed_to_start', 'start_unknown']))
);

create index sales_call_attempts_request_idx
  on public.sales_call_attempts (callback_request_id);

-- Atomic dispatch-side idempotent create (INSERT ... ON CONFLICT DO
-- NOTHING, no read-then-insert). See header for why no partial predicate
-- is needed here (unlike callback_request_attempts' issued_via-scoped
-- index).
create unique index sales_call_attempts_request_slot_uidx
  on public.sales_call_attempts (callback_request_id, scheduled_at_snapshot);

create index sales_call_attempts_dispatch_pending_idx
  on public.sales_call_attempts (dispatch_status, created_at)
  where dispatch_status in ('queued', 'dialing', 'in_progress');

create unique index sales_call_attempts_el_conversation_id_key
  on public.sales_call_attempts (el_conversation_id)
  where el_conversation_id is not null;

alter table public.sales_call_attempts enable row level security;
-- No policies: service_role (BYPASSRLS) is the only reader/writer -- see
-- header, same posture as callback_request_attempts / call_attempts.

revoke all on table public.sales_call_attempts from anon, authenticated;

comment on table public.sales_call_attempts is
  'One row per Voximplant AI voice-call token/dispatch attempt for the sales-closing agent''s outbound call on a callback_requests row (topic = מכירות). The call IS the substantive interaction -- its outcome is written directly to callback_requests.call_outcome via the existing applyCallOutcome(), never a column on this table. access_token is the URL-path bearer for the future token-scoped route(s). Service-role reachable only.';
comment on column public.sales_call_attempts.dispatch_status is
  'Whether the call ITSELF was placed -- independent of what it accomplished (that lives on callback_requests.call_outcome, not here). queued/dialing/in_progress are pre-terminal; concluded/failed_to_start/start_unknown are terminal dispatch outcomes.';
comment on column public.sales_call_attempts.vox_call_session_history_id is
  'Voximplant StartScenarios result id, stored as text to match call_attempts.vox_call_session_history_id and the String(callSessionHistoryId) convention in src/lib/data/call-attempts.ts.';
comment on column public.sales_call_attempts.el_conversation_id is
  'ElevenLabs conversation id, unique when set -- same shape as call_attempts.el_conversation_id.';
comment on column public.sales_call_attempts.scheduled_at_snapshot is
  'callback_requests.scheduled_at at the moment this row was created (dispatch time, at or just after the slot DEFAULT_CALLBACK_POLICY already computed). Paired with callback_request_id in the unique index below -- the atomic-create target for the dispatcher.';
