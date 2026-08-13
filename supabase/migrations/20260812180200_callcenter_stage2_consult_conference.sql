-- Browser call-center stage 2 (post-V1, owner-approved acceleration of the
-- plan's "שלב 2" scope): consult-before-transfer + 3-way conference.
--
-- Design (mirrors console_calls' existing transferred_to_agent_id column and
-- its "PII-free, event-driven bookkeeping" rule — plan "מודל נתונים"): no new
-- table. Two columns hold participant tracking; both are written ONLY by the
-- scenario's own consult_*/conference_* reportEvent() calls via
-- /api/voximplant/console/event (never by the browser directly), exactly like
-- transferred_to_agent_id already is.
--
-- AUTHORED, NOT APPLIED. This migration is part of a code-only build (no
-- `supabase db push`, no live DB change). It documents the schema the DAL
-- (src/lib/data/console-calls.ts) and the new routes are written against;
-- until it is applied and `supabase gen types --linked` is re-run, the two
-- new columns are NOT in src/lib/supabase/types.ts, and the DAL says so at
-- every call site that touches them.

alter table public.console_calls
  add column consult_agent_id uuid references public.console_agents (user_id) on delete set null,
  add column conference_agent_ids jsonb not null default '[]'::jsonb;

comment on column public.console_calls.consult_agent_id is
  'Set by the consult_started event, cleared by consult_cancelled/consult_failed/consult_completed. NULL = no consult in flight.';
comment on column public.console_calls.conference_agent_ids is
  'Agent user_ids currently mixed into the call''s conference (V1: at most one, the conference_add target). [] = no conference live.';

-- Feature flag (all call-center flags default OFF — dark until enabled).
-- Threaded through the same layout -> AdminShell -> SoftphonePanel -> CallBar
-- prop chain as console_softphone_enabled/handoff_enabled (console-softphone-
-- config.ts precedent) — never fetched from the browser directly (app_settings
-- RLS is admin-only).
alter table public.app_settings
  add column console_consult_conference_enabled boolean not null default false;
