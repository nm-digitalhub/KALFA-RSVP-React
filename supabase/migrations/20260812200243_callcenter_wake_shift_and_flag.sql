-- =====================================================================
-- Call-center research (12.8) — capability B follow-on: wake-and-answer.
-- The measured problem (real PSTN call, real browser answer, same night):
-- an agent is only reachable while a browser tab is OPEN with the softphone
-- connected — the SDK connection lives in the tab, and softphone-panel.tsx's
-- 60s heartbeat only runs while phoneSnap.state==='logged_in', so a closed
-- tab means agent_status.updated_at goes stale and findRoutableAgents()'s
-- <90s freshness gate correctly drops the agent. This migration adds the two
-- new pieces of server-persisted state the wake design needs: an explicit,
-- bounded-freshness "on shift" intent (read with its own staleness window in
-- console-calls.ts, NOT a reuse of agent_status.status='ready' — see below),
-- and the go-live flag for the whole capability.
-- =====================================================================

-- 1 · console_agent_shift — deliberately its OWN table, not a repurposing of
-- agent_status. agent_status is a LIVE technical/business presence signal
-- driven by the 60s heartbeat and the <90s freshness gate in
-- findRoutableAgents() — collapsing "I am on shift today" into it would mean
-- a 'ready' an agent set in the morning and forgot to clear silently
-- reactivates auto-connect on an unrelated page view that afternoon, with no
-- heartbeat yet running to make the staleness visible. console_agent_shift
-- is read through its OWN bounded-freshness window instead (see
-- CONSOLE_SHIFT_FRESHNESS_MS / isShiftActiveAndFresh in console-calls.ts) —
-- a forgotten toggle degrades to inert within hours, not indefinitely. Same
-- table shape and RLS posture as agent_status (console_agent_layer.sql) and
-- console_agent_calendar_presence: own-row select via is_console_agent(),
-- own-row insert/update gated on agent_id = auth.uid().
create table if not exists public.console_agent_shift (
  agent_id uuid primary key references public.console_agents(user_id) on delete cascade,
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.console_agent_shift enable row level security;

create policy console_agent_shift_select on public.console_agent_shift
  for select to authenticated using (public.is_console_agent());
create policy console_agent_shift_upsert_own on public.console_agent_shift
  for insert to authenticated with check (agent_id = auth.uid() and public.is_console_agent());
create policy console_agent_shift_update_own on public.console_agent_shift
  for update to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

comment on table public.console_agent_shift is
  'Explicit, agent-set "on shift" intent (wake-and-answer research, 12.8) — read through a bounded freshness window (console-calls.ts), never treated as permanently valid. Distinct from agent_status: that is live SDK/business presence, this is a standing intent that drives auto-connect on app launch and expands the inbound push-wake audience beyond already-connected agents.';

-- 2 · Go-live flag — same discipline as every other capability in this
-- project (console_softphone_enabled, console_manual_dial_enabled,
-- inbound_calls_enabled, console_dtmf_handoff_enabled,
-- console_consult_conference_enabled, console_widget_enabled): default
-- FALSE, admin-only RLS (app_settings already has this posture; no new
-- policy needed), a single owner "בצע" flips it. Gates three things read
-- fail-closed in console-calls.ts: (1) whether the softphone panel attempts
-- an auto-connect at all, (2) whether route-inbound also pushes off-duty
-- shift-active agents (not just already-routable ones) via
-- notifyOffDutyShiftAgentsOfInboundCall, (3) whether the scenario's
-- late-ring-arrival retry endpoint (route-inbound-retry) ever returns a
-- non-empty ring order. The ConsoleInbound.voxengine.js scenario change that
-- calls the retry endpoint is written but NOT deployed in this pass — this
-- flag being off is a second, independent kill switch even after a future
-- deploy.
alter table public.app_settings
  add column console_wake_enabled boolean not null default false;

comment on column public.app_settings.console_wake_enabled is
  'Feature flag for the wake-and-answer capability (PWA push wake + shift-intent auto-connect + late-ring-arrival retry, 12.8 research). Default FALSE. See console-calls.ts (consoleWakeEnabled, notifyOffDutyShiftAgentsOfInboundCall) and route-inbound-retry/route.ts.';
