-- Meeting/reschedule voice-call token surface for callback_requests.
--
-- Why: RSVPAgent's existing bridge (call_attempts + /api/voximplant/ctx|cb/
-- [token]) is hard-wired to a campaign/event/guest call (campaign_id,
-- event_id, contact_id are all NOT NULL on call_attempts). The
-- meeting-booking agent's outbound confirmation/reschedule call and the
-- inbound-answering agent's live reschedule sub-flow both need a voice-call
-- token scoped to a callback_requests row instead -- no campaign, no event,
-- no guest exists for either. Verified live (2026-08-22): call_attempts has
-- no nullable path for this; a parallel table is required, not a schema
-- stretch of call_attempts (see docs/voice-agent/plans/2026-08-22-
-- meeting-booking-agent-plan.md SS7, independently confirmed by
-- docs/voice-agent/plans/2026-08-22-sales-closing-agent-plan.md SS5.1 and
-- docs/voice-agent/plans/2026-08-22-inbound-answering-agent-plan.md SS4/SS4a's
-- reschedule sub-flow, which reuses the SAME token/tool contract, not a
-- second implementation).
--
-- Scope of this migration: the token/attempt bookkeeping table only -- the
-- /api/voximplant/mtg/ctx|cb/[token] route handlers, the confirmation-
-- dispatch sweep, and the outbound dispatcher (SS11a of the meeting-booking
-- plan: balance/concurrency/DNC/timeout gates mirroring dispatchOutreachCall)
-- are separate, not-yet-built application code -- this migration does not
-- assume or block any particular implementation of them. Deliberately
-- deferred: call-lifecycle bookkeeping columns (status/vox_call_session_
-- history_id/finish_reason/call_duration_sec, the call_attempts pattern) are
-- NOT added here -- the dispatcher that would write them doesn't exist yet,
-- and its exact query/result-classification shape is explicitly left to
-- voximplant-engineer's implementation phase (plan SS11a). Add them additively
-- when that lands, the same way call_attempts itself grew ~10 follow-up
-- migrations after its initial shape.
--
-- Two issuance paths share one table and one token contract (plan SS4a):
--   * 'dispatch' -- minted by the confirmation-dispatch sweep ahead of the
--     outbound call (owning: planner-meeting-agent).
--   * 'inbound_identification' -- minted by the inbound-answering agent the
--     instant it matches a live caller's phone to a callback_requests row
--     with a future scheduled_at, short TTL (app-enforced via
--     token_expires_at; not a schema-level distinction), scoped to that one
--     call (owning: planner-inbound-agent, per team-lead 2026-08-23 decision
--     recorded in docs/voice-agent/plans/2026-08-22-inbound-answering-agent-
--     plan.md SS4a).
--
-- scheduled_at_snapshot: callback_requests.scheduled_at at the moment this
-- row was created. mtg/ctx re-verifies live callback_requests.status =
-- 'scheduled', calendar_item_id IS NOT NULL, AND scheduled_at = this
-- snapshot before speaking a meeting time -- reconcileCallbacksWithCalendar
-- can silently release a booked slot between a dispatch (~24h ahead) and the
-- actual call (plan SS7). The freshness gate is therefore entirely against
-- the LIVE callback_requests row, not any status column on this table -- this
-- table intentionally carries no attempt-lifecycle status of its own yet
-- (see "deliberately deferred" above).
--
-- confirmation_call_status / confirmation_call_at: the call's semantic
-- result -- a separate axis from any future dispatch-lifecycle status, same
-- lesson callback_requests.status vs. call_outcome already encodes (see
-- 20260819212112_callback_status_outcome_split.sql). Vocabulary is the
-- meeting-booking plan's own tool contract (SS4): not_sent (default) /
-- confirmed / no_answer / reschedule_requested / opted_out. mark_opt_out
-- does NOT get a new suppression column anywhere -- callback_requests rows
-- are already suppressed by call_dnc_list (normalized_phone primary key),
-- the same list isDncListed() gates every outbound dispatcher against
-- (verified live, grep: src/lib/data/outreach-engine.ts,
-- src/lib/data/console-calls.ts, src/lib/data/call-result-processing.ts all
-- consult it). 'opted_out' here only records that THIS call is what
-- triggered the opt-out, for admin distinguishability from a routine
-- 'cancelled' -- the actual suppression is the future dispatcher's own
-- call_dnc_list upsert (application code, not this migration), the same
-- mechanism call-result-processing.ts already uses for the RSVP flow's
-- mark_dnc tool.
--
-- unique index (callback_request_id, scheduled_at_snapshot) WHERE
-- issued_via = 'dispatch': the dispatcher's atomic create (INSERT ... ON
-- CONFLICT DO NOTHING, plan SS11a -- no read-then-insert) needs a real
-- constraint to conflict against. Scoped to (request, slot) rather than just
-- (request) so a genuine reschedule to a new slot can get its own
-- confirmation call, while a retry against the SAME slot can never double-
-- dispatch. INFERRED, not explicit in either plan -- flagged back to
-- planner-meeting-agent for confirmation, not blocking this migration.
-- issued_via = 'inbound_identification' rows are deliberately unconstrained:
-- the same caller may ring in and match the same row more than once.
--
-- FK on delete restrict, not cascade: no code path deletes callback_requests
-- (grep-verified live 2026-08-22 -- the status vocabulary is soft-delete-only,
-- 'cancelled'/'closed'). This repo already has one CASCADE-wipes-audit
-- incident on record (RLS audit 2026-07-13); restrict costs nothing here and
-- keeps a stray future DELETE from silently erasing the record that an
-- automated call was placed to a consumer.
--
-- RLS/grants: mirrors call_attempts' CURRENT (post-2026-08-12 hardening)
-- posture, not its original 2026-07-14 shape -- RLS enabled, ZERO client
-- policies, no anon/authenticated grants at all. access_token is a bearer
-- credential; every real reader (admin callbacks UI, the future mtg/ctx|cb
-- routes, the future dispatcher/worker) already uses service_role
-- (createAdminClient()) or runs as postgres -- verified against
-- src/lib/data/admin/callbacks.ts. This is a deliberate exception to the
-- general has_role-cookie-client admin pattern used elsewhere, matching why
-- call_attempts itself was hardened to service-role-only rather than given
-- an admin-read policy (see 20260812153317_callcenter_s1_call_attempts_
-- revoke_client_grants.sql). Table is created by `postgres` via `db push`;
-- public schema's default ACL (verified live, pg_default_acl, 2026-08-22)
-- grants anon/authenticated full arwdDxtm on every new table born in
-- `public` unless explicitly revoked -- the exact trap that migration
-- documents call_attempts having fallen into originally. Revoked below so
-- this table is never exposed even for the moment before a policy exists.
--
-- Validated: DDL below was run inside an explicit BEGIN/ROLLBACK against the
-- linked project (2026-08-22) to confirm syntax, the FK, both indexes, RLS
-- state, and the anon/authenticated grant revoke all take effect as written,
-- then rolled back and confirmed gone (to_regclass returned null). NOT
-- applied outside that transaction. Left staged for explicit go/no-go.
--
-- Rollback: drop table public.callback_request_attempts (nothing else
-- references it yet -- the routes/dispatcher that will use it are not part
-- of this migration).

create table public.callback_request_attempts (
  id                        uuid primary key default gen_random_uuid(),
  callback_request_id       uuid not null references public.callback_requests(id) on delete restrict,
  issued_via                text not null,
  access_token              text not null unique,        -- 32 hex (randomBytes(16)); URL path secret
  token_expires_at          timestamptz not null,
  scheduled_at_snapshot     timestamptz not null,         -- callback_requests.scheduled_at at issuance; freshness-gate baseline
  confirmation_call_status  text not null default 'not_sent',
  confirmation_call_at      timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),   -- app-written, no trigger (matches call_attempts)
  constraint callback_request_attempts_issued_via_valid
    check (issued_via = any (array['dispatch', 'inbound_identification'])),
  constraint callback_request_attempts_confirmation_call_status_valid
    check (confirmation_call_status = any (array['not_sent', 'confirmed', 'no_answer', 'reschedule_requested', 'opted_out']))
);

create index callback_request_attempts_request_idx
  on public.callback_request_attempts (callback_request_id);

-- Atomic dispatch-side idempotent create (plan SS11a: INSERT ... ON CONFLICT
-- DO NOTHING, no read-then-insert). See header for the (request, slot) vs.
-- (request) scoping decision.
create unique index callback_request_attempts_dispatch_slot_uidx
  on public.callback_request_attempts (callback_request_id, scheduled_at_snapshot)
  where issued_via = 'dispatch';

alter table public.callback_request_attempts enable row level security;
-- No policies: service_role (BYPASSRLS) is the only reader/writer -- see
-- header. Deliberately born with zero policies, not an admin-read policy
-- added now and removed later (the call_attempts lesson).

-- public schema's default ACL grants anon/authenticated full privileges on
-- every new table (verified live via pg_default_acl, 2026-08-22) -- revoke
-- immediately so this bearer-token table is never exposed even transiently.
revoke all on table public.callback_request_attempts from anon, authenticated;

comment on table public.callback_request_attempts is
  'One row per Voximplant AI voice-call token scoped to a callback_requests row (meeting-confirmation/reschedule calls: planner-meeting-agent outbound dispatch + planner-inbound-agent live reschedule sub-flow). Parallel to call_attempts (event/campaign/guest-scoped, not reusable here). access_token is the URL-path bearer for /api/voximplant/mtg/ctx|cb/[token]. Service-role reachable only.';
comment on column public.callback_request_attempts.issued_via is
  'dispatch = minted ahead of an outbound confirmation call by the sweep; inbound_identification = minted live by the inbound-answering agent the instant it matches a caller to a scheduled callback_requests row. TTL differs by path -- enforced by token_expires_at, not by this column.';
comment on column public.callback_request_attempts.scheduled_at_snapshot is
  'callback_requests.scheduled_at at the moment this row was created. mtg/ctx compares this against the LIVE value before speaking a meeting time, catching a slot reconcileCallbacksWithCalendar released between issuance and the call.';
comment on column public.callback_request_attempts.confirmation_call_status is
  'Semantic result of the confirmation/reschedule exchange -- separate axis from any future call-dispatch-lifecycle status (same split as callback_requests.status vs. call_outcome). opted_out records that this call triggered a DNC request; the actual suppression is a call_dnc_list upsert (application code), not this column.';
