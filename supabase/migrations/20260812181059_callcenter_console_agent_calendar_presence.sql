-- =====================================================================
-- console_agent_calendar_presence — a THIRD, advisory axis for console-agent
-- presence, derived from each agent's OWN Exchange calendar.
--
-- Research finding (Outlook/Exchange presence-sync task, 12.8): there is no
-- Teams-presence API reachable from this stack (Graph-only; this project
-- deliberately has no Graph/Entra auth — see ews-impl.ts's OAuth-closed
-- note), and EWS GetUserAvailability is MEASURED DEAD on this IONOS mailbox
-- (HTTP 500 / ErrorInternalServerError 127, ews-impl.ts:686-711). The one
-- working signal is calendar-derived free/busy (LegacyFreeBusyStatus per
-- item via listAppointments/getAvailability) — exactly what
-- exchange-availability.ts's getMyPresence() already uses for the owner's
-- admin-shell avatar dot. This table is the SAME computation, run
-- unattended per console agent by a worker cron, for the call-routing side.
--
-- TWO-AXIS RULE (project decision, plans/shimmering-snuggling-neumann.md
-- §"נוכחות"): agent_status is the business truth; a technical/derived signal
-- is never merged into it. This table is that third axis: ADVISORY only —
-- it may de-prioritize an agent in ring order and it is shown to the agent
-- ("בפגישה עד 14:30"), but it can never flip agent_status.status and a
-- console agent can never write to it (see CLOSED-TABLE PATTERN below).
--
-- WHY A SEPARATE TABLE, NOT COLUMNS ON agent_status (verified, not assumed):
-- `authenticated` holds table-wide UPDATE/INSERT/SELECT on agent_status
-- (RLS scopes ROWS via agent_id = auth.uid(), not columns), and
-- softphone-panel.tsx already upserts that row from the browser client
-- directly. A "server-derived" column added to agent_status would be
-- trivially forgeable from the browser — the exact hole this table avoids
-- by living in its own closed table.
--
-- CLOSED-TABLE PATTERN (precedent: exchange_connections,
-- exchange_availability_blocks — 20260727171428 / 20260727205735). RLS
-- enabled with ZERO policies + REVOKE from anon/authenticated. Written only
-- by the worker's service-role sync job; read only via console_agents_roster
-- below (that view runs as its postgres owner — bypasses RLS by design, see
-- the console_agents_roster comment in 20260812154126 — gated solely by its
-- own `where is_console_agent()`).
--
-- NO SUBJECT/BODY COLUMN, EVER: only the end time of the current blocking
-- window and its LegacyFreeBusyStatus category. What a meeting is ABOUT is
-- never read for this feature — getAvailability() itself never asks Exchange
-- for Subject/Body (see ews-impl.ts's getAvailability, which reuses
-- listAppointments' explicit, minimal property set).
--
-- ROLLBACK: drop view if exists public.console_agents_roster; (recreate the
--   prior definition from 20260812154126+20260812154544);
--           drop table if exists public.console_agent_calendar_presence;
--   Safe — nothing else references this table; findRoutableAgents/
--   findRoutableAgentVoxUsernames never read it (by design, this pass).
-- =====================================================================

create table if not exists public.console_agent_calendar_presence (
  agent_id uuid primary key references public.console_agents(user_id) on delete cascade,
  -- When the CURRENT blocking window ends; null = not currently busy per the
  -- last successful sync (or never synced). Expiry is implicit, same
  -- reasoning as exchange_availability_blocks: a past window just stops
  -- applying, no cron needed to clear it — the NEXT sync tick naturally
  -- recomputes null once the meeting ends.
  busy_until   timestamptz,
  -- Mirrors EWS LegacyFreeBusyStatus, excluding 'free' (a free window is
  -- represented by busy_until = null, not a stored 'free' row) — same
  -- vocabulary and the same reason as exchange_availability_blocks.show_as.
  show_as      text check (show_as in ('busy', 'oof', 'working_elsewhere', 'tentative')),
  -- Last successful-OR-attempted sync. Distinct from "last successful": on a
  -- transient EWS failure the sync job updates ONLY this + last_error_code,
  -- deliberately leaving busy_until/show_as at their last-known value rather
  -- than clobbering a real meeting to "free" on a blip (voximplant-balance-
  -- cache.ts's stale-grace precedent: prefer stale-but-known over
  -- fail-to-unknown on a single missed tick).
  synced_at    timestamptz not null default now(),
  -- Classified ExchangeErrorCode (auth_failed/unreachable/not_found/
  -- provider_error) ONLY — never a raw SOAP fault or stack (plan §5.4, same
  -- rule as exchange_connections.last_error). Null on a clean sync.
  last_error_code text,

  constraint console_agent_calendar_presence_error_code check (
    last_error_code is null or last_error_code in
      ('auth_failed', 'unreachable', 'not_found', 'recurring_locked', 'provider_error')
  )
);

comment on table public.console_agent_calendar_presence is
  'Per-console-agent calendar-derived busy window (advisory third axis — never merged into agent_status). Closed table: RLS on with no policies, grants revoked — written only by the worker sync job via service-role. See plans/shimmering-snuggling-neumann.md "נוכחות" and this migration''s header.';

alter table public.console_agent_calendar_presence enable row level security;

-- No policy ON PURPOSE (deny-all under RLS for every non-bypassing role),
-- plus explicit REVOKE — belt and braces, exactly like exchange_connections
-- and exchange_availability_blocks.
revoke all on public.console_agent_calendar_presence from anon;
revoke all on public.console_agent_calendar_presence from authenticated;

-- ---------------------------------------------------------------------
-- console_agents_roster — additive extension (two new trailing columns).
-- Existing callers (softphone-panel.tsx) select an explicit column list, so
-- this is non-breaking. Left join: an agent with no sync row yet, or whose
-- last sync found nothing blocking, simply shows null (== "not known to be
-- calendar-busy"), never a false busy signal.
--
-- Re-declared in full (CREATE OR REPLACE VIEW cannot ALTER a WHERE clause
-- incrementally) — verified identical to 20260812154126's definition except
-- for the two added trailing columns and this join.
-- ---------------------------------------------------------------------
create or replace view public.console_agents_roster as
select
  ca.user_id,
  ca.display_name,
  coalesce(ast.status, 'not_ready') as status,
  ast.updated_at as status_updated_at,
  (ca.vox_username is not null and cas.user_id is not null) as provisioned,
  cp.busy_until as calendar_busy_until,
  cp.show_as as calendar_show_as
from public.console_agents ca
left join public.agent_status ast on ast.agent_id = ca.user_id
left join public.console_agent_secrets cas on cas.user_id = ca.user_id
left join public.console_agent_calendar_presence cp on cp.agent_id = ca.user_id
where is_console_agent();

-- Re-assert the grants explicitly (20260812154544's fix-up: CREATE OR
-- REPLACE VIEW preserves prior grants on the same relation oid, but this
-- states intent rather than relying on that carrying forward silently).
revoke all on public.console_agents_roster from anon, authenticated;
grant select on public.console_agents_roster to authenticated;
