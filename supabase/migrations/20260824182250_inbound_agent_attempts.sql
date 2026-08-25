-- Inbound customer-service voice-agent token surface:
--   * public.inbound_agent_attempts -- one row per short-lived (15 min,
--     app-enforced via token_expires_at) voice-tool token minted for an
--     IDENTIFIED inbound caller.
--   * public.app_settings.inbound_ai_answer_enabled -- admin kill-switch for
--     the whole branch, fail-closed (default false).
--
-- Why a new table (not call_attempts / callback_request_attempts /
-- console_call_pii.dial_token_hash) -- verified live 2026-08-24, same
-- reasoning 20260822103442 already recorded: call_attempts has NOT NULL
-- campaign_id/touchpoint_index and feeds console_call_feed + billing (an
-- inbound row there = billing contamination); callback_request_attempts is
-- scoped to a callback_requests row (meetings), not guest/event;
-- dial_token_hash is a single-use manual-dial token consumed by
-- verifyDialToken -- one column serving two flows is exactly the bug fixed
-- 2026-08-12. So: one attempt table per token surface, one named guard per
-- table (agent-tool-guard.ts convention), FK to the console_calls row that
-- route-inbound already creates, plus a SNAPSHOT of event/guest/contact taken
-- at identification time. Identity for /api/voximplant/agent-tool/lookup and
-- /api/voximplant/inb/cb is THIS row -- never a phone in a request body, so
-- the tool can never become a phone-validation oracle (CLAUDE.md, Public RSVP
-- Security). Design: scratchpad plan-inbound-lookup-vox.md SS2.1 +
-- spec-inbound-lookup-sentinel.md SS3 (2026-08-24).
--
-- token_hash, not access_token: the raw token (randomBytes(16) hex, held only
-- in ConsoleInbound's session memory) is NEVER persisted -- only its sha256
-- hex (src/lib/security/token-compare.ts sha256Hex, 64 hex chars). Same
-- posture as console_call_pii.dial_token_hash; deliberately NOT the weaker
-- call_attempts/sales_call_attempts access_token-in-clear precedent. Lookup
-- is WHERE token_hash = sha256Hex(presented) -- the UNIQUE constraint is the
-- index. The shape CHECK is a tripwire: a raw 32-hex token written by
-- mistake fails 23514 instead of silently landing in clear.
--
-- No verified_at / verify_failures (the spec's optional second-factor step):
-- the owner declined that step (team-lead, 2026-08-24). revoked_at stays --
-- the console/event 'ended' handler marks the call's token dead
-- (belt-and-braces alongside the TTL); the DAL treats revoked_at IS NOT NULL
-- like an expired token (generic 404).
--
-- status vocabulary (issued -> bridged -> completed | no_response | failed):
-- issued = minted at accept time (a human agent may still answer -- the row
-- then just expires, cheap, counts toward nothing); bridged = ConsoleInbound
-- handed the caller to the ElevenLabs agent; the three terminals come from
-- the scenario's inb/cb report. CAS-guarded in application code (only from
-- issued|bridged), same as recordSalesDispatchConcluded.
--
-- FK on delete restrict on ALL FOUR (decided by owner/lead, 2026-08-24; the
-- billed_results / callback_request_attempts precedent -- this repo has a
-- CASCADE-wipes-audit incident on record, RLS audit 2026-07-13).
-- PRODUCT IMPLICATION, flagged, not decided here: console_calls.guest_id /
-- contact_id and call_attempts.guest_id are ON DELETE SET NULL live, and
-- src/lib/data/guests.ts deleteGuest() + contacts.ts (orphan-contact prune)
-- DO hard-delete rows. With restrict, an owner deleting a guest who once
-- reached the inbound AI branch gets 23503 -> 'מחיקת המוזמן נכשלה' until the
-- attempt row is gone. Alternative if that is unwanted: guest_id/contact_id
-- nullable + on delete set null (the console_calls precedent). events(id)
-- already restricts most children since 20260821141118.
--
-- Indexes: console_call_id (the cb/lookup path and the 'ended' revoke
-- batch), plus event_id/guest_id/contact_id so every restrict FK check on a
-- parent DELETE is an index probe, not a seq scan (and the
-- unindexed_foreign_keys advisor stays clean). el_conversation_id unique-
-- when-set mirrors call_attempts/sales_call_attempts (20260719170227,
-- 20260822104725).
--
-- RLS/grants: RLS enabled, ZERO policies, anon/authenticated revoked --
-- token_hash is still credential-adjacent and every reader is
-- createAdminClient() (service_role, BYPASSRLS). public schema's default ACL
-- grants anon/authenticated full arwdDxtm on every new table (re-verified
-- live via pg_default_acl 2026-08-24), hence the explicit revoke. Identical
-- posture to callback_request_attempts / sales_call_attempts (relacl live:
-- {postgres, service_role} only, 0 policies).
--
-- app_settings.inbound_ai_answer_enabled: same shape as
-- voximplant_meeting_confirm_enabled (20260822114850) -- boolean not null
-- default false on the single-row settings table (id boolean = true, 1 row
-- live). app_settings already has admin-only RLS (1 policy live); adding a
-- column changes nothing there. Needs an /admin/channels control in the same
-- change set as the reader (memory: kill-switches-need-admin-ui-not-db-only).
-- Never affects unidentified callers: route-inbound only mints when
-- identified !== null AND this flag is true.
--
-- Validated: DDL below run inside an explicit BEGIN/ROLLBACK against the
-- linked project (2026-08-24) -- table, 4 FKs (all restrict), both CHECKs,
-- unique token_hash, 5 indexes, RLS on / 0 policies, anon+authenticated
-- revoked, app_settings column present with default false on the live row --
-- then rolled back and confirmed gone (to_regclass null, column absent).
-- NOT applied outside that transaction. Staged pending explicit owner go.
--
-- Rollback:
--   drop table public.inbound_agent_attempts;
--   alter table public.app_settings drop column inbound_ai_answer_enabled;
-- (nothing else references either yet -- the routes/DAL/scenario that will
-- use them are separate, not-yet-built application code).

create table public.inbound_agent_attempts (
  id                       uuid primary key default gen_random_uuid(),
  console_call_id          uuid not null references public.console_calls(id) on delete restrict,
  event_id                 uuid not null references public.events(id) on delete restrict,
  guest_id                 uuid not null references public.guests(id) on delete restrict,
  contact_id               uuid not null references public.contacts(id) on delete restrict,
  token_hash               text not null unique,        -- sha256 hex of the raw token; raw is NEVER stored
  token_expires_at         timestamptz not null,        -- mint + 15 min, app-enforced
  status                   text not null default 'issued',
  revoked_at               timestamptz,                 -- set by the call's 'ended' handler; treated like expiry
  el_conversation_id       text,
  conversation_started_at  timestamptz,
  finish_reason            text,
  call_duration_sec        integer,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),   -- app-written, no trigger (matches call_attempts)
  constraint inbound_agent_attempts_status_valid
    check (status = any (array['issued', 'bridged', 'completed', 'no_response', 'failed'])),
  constraint inbound_agent_attempts_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$')
);

create index inbound_agent_attempts_console_call_idx
  on public.inbound_agent_attempts (console_call_id);
create index inbound_agent_attempts_event_idx
  on public.inbound_agent_attempts (event_id);
create index inbound_agent_attempts_guest_idx
  on public.inbound_agent_attempts (guest_id);
create index inbound_agent_attempts_contact_idx
  on public.inbound_agent_attempts (contact_id);

create unique index inbound_agent_attempts_el_conversation_id_key
  on public.inbound_agent_attempts (el_conversation_id)
  where el_conversation_id is not null;

alter table public.inbound_agent_attempts enable row level security;
-- No policies: service_role (BYPASSRLS) is the only reader/writer -- see
-- header. Born with zero policies, same as the two sibling attempt tables.

-- public schema's default ACL grants anon/authenticated full privileges on
-- every new table (verified live via pg_default_acl, 2026-08-24) -- revoke
-- immediately so this table is never exposed even transiently.
revoke all on table public.inbound_agent_attempts from anon, authenticated;

comment on table public.inbound_agent_attempts is
  'One row per short-lived (15 min, app-enforced via token_expires_at) voice-tool token minted by route-inbound for an IDENTIFIED inbound caller (identifyInboundCaller). Identity for /api/voximplant/agent-tool/lookup and /api/voximplant/inb/cb is THIS row (event/guest/contact snapshot at identification time), never a phone lookup from a request body. token_hash = sha256 hex of the raw token; the raw token lives only in ConsoleInbound session memory and is never stored. Service-role reachable only (RLS on, zero policies, anon/authenticated revoked).';
comment on column public.inbound_agent_attempts.token_hash is
  'sha256 hex (64 chars) of the raw voice-tool token (randomBytes(16) hex). The raw token is never persisted -- lookup is WHERE token_hash = sha256Hex(presented). Same posture as console_call_pii.dial_token_hash.';
comment on column public.inbound_agent_attempts.token_expires_at is
  'Hard TTL, mint + 15 min (call-scoped: disclosure + ring + AI cap + slack). Enforced by the guard in application code; expired rows are a generic 404.';
comment on column public.inbound_agent_attempts.status is
  'issued (minted at accept; a human may still answer) -> bridged (handed to the ElevenLabs agent) -> completed | no_response | failed (scenario''s inb/cb report). CAS-guarded in app code: terminals only from issued|bridged.';
comment on column public.inbound_agent_attempts.revoked_at is
  'Set by the console/event ''ended'' handler for the call''s token(s) -- belt-and-braces alongside token_expires_at. The DAL treats a revoked row exactly like an expired one (generic 404).';
comment on column public.inbound_agent_attempts.el_conversation_id is
  'ElevenLabs conversation id, unique when set -- same shape as call_attempts.el_conversation_id.';

-- Kill-switch (fail-closed, default OFF) -- same shape as
-- voximplant_meeting_confirm_enabled (20260822114850).
alter table public.app_settings
  add column inbound_ai_answer_enabled boolean not null default false;

comment on column public.app_settings.inbound_ai_answer_enabled is
  'Admin toggle: when the inbound ring exhausts for an IDENTIFIED caller, bridge to the ElevenLabs customer-service agent instead of NO_AGENT_LINE_HE. Default false (dark). Never affects unidentified callers -- route-inbound mints a token only when identified AND this is true.';
