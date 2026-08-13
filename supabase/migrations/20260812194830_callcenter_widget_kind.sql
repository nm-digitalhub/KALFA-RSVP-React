-- =====================================================================
-- Call-center research (12.8) — capability A, revised: browser widget on a
-- SHARED Voximplant identity (owner-directed pivot; MAU is per unique
-- credential/month per live DOCS, so one shared identity for all visitors
-- costs 1 MAU/month regardless of traffic — see console-calls.ts's
-- evaluateWidgetCallCaps header for the full research trail).
--
-- Adds the one new console_calls.kind value a widget call needs, plus the
-- ONE new column the admission gate needs to bound per-visitor call
-- frequency. Everything else (dial_token_hash/dial_token_expires_at,
-- session_url, recording_url) is reused AS-IS from the existing manual-dial
-- token machinery (mintDialToken/verifyDialToken) — a widget call is
-- architecturally an anonymous-visitor-initiated inbound call, so it reuses
-- console_calls/console_call_pii's existing shape rather than a parallel
-- table.
-- =====================================================================

-- 1 · console_calls.kind — add 'widget' alongside the existing four values.
-- Constraint name verified live (pg_constraint, not information_schema —
-- project convention): console_calls_kind_check.
alter table public.console_calls
  drop constraint console_calls_kind_check;
alter table public.console_calls
  add constraint console_calls_kind_check
  check (kind in ('manual', 'inbound_customer', 'internal', 'ai_handoff', 'widget'));

-- 2 · Per-visitor rate-limit key for the widget admission gate
-- (evaluateWidgetCallCaps's perIpCallsLastHour input — the closest available
-- analogue to PSTN inbound's per-CLI count once every visitor shares one
-- Voximplant identity: the scenario layer can no longer distinguish callers
-- by identity, so the app layer must, at call-intent mint time, from the
-- browser's real IP). SHA-256, never the raw IP — same hashing discipline as
-- this table's own dial_token_hash column (src/lib/security/token-compare.ts
-- sha256Hex). Nullable: every non-widget row leaves this null.
alter table public.console_call_pii
  add column origin_ip_hash text;

comment on column public.console_call_pii.origin_ip_hash is
  'sha256(client IP) at call-intent mint time — widget calls only (kind=widget). Never the raw IP. Feeds evaluateWidgetCallCaps''s per-visitor hourly rate check, the analogue of countAnsweredLastHourForPhone for a shared-identity caller that PSTN''s per-CLI count cannot reach.';

create index if not exists console_call_pii_origin_ip_hash_idx
  on public.console_call_pii (origin_ip_hash, created_at)
  where origin_ip_hash is not null;

-- 3 · Go-live flag — same discipline as every other capability in this
-- project (console_softphone_enabled, console_manual_dial_enabled,
-- inbound_calls_enabled, console_dtmf_handoff_enabled,
-- console_consult_conference_enabled): default FALSE, admin-only RLS
-- (app_settings already has this posture; no new policy needed), a single
-- owner "בצע" flips it. Wiring this on does NOT by itself route any calls —
-- there is no rule bound to the widget's call pattern until that is
-- separately created and approved (see console-calls.ts's
-- evaluateWidgetCallCaps header for the full gate list).
alter table public.app_settings
  add column console_widget_enabled boolean not null default false;

comment on column public.app_settings.console_widget_enabled is
  'Feature flag for the browser call-center widget (capability A, 12.8). Default FALSE. Gates /api/widget/call-intent''s admission check only — has no effect until a Voximplant rule+scenario are separately created and approved.';
