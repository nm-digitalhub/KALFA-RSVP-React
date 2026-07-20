-- Agent-console layer, part 3: the human-agent-leg model for monitor/takeover.
--
-- The three console views (console_events / console_me / console_call_analysis)
-- are already tracked by 20260720061244 and 20260720110507 (fetched from the
-- ledger), so they are deliberately NOT (re)declared here — a create-or-replace
-- with a different column set would fail ("cannot change number of columns in a
-- view"). This migration adds ONLY the genuinely-new monitor/takeover objects.
--
-- Additive; verified against the live schema (2026-07-20): human_agent_call_legs
-- absent, and console_call_feed currently carries only handled_by + agent_id.
-- Conventions mirror 20260720025656_console_agent_layer.sql.

-- Current-ownership snapshot on the feed (handled_by / agent_id already exist).
alter table public.console_call_feed
  add column if not exists takeover_claimed_at timestamptz,
  add column if not exists takeover_request_id uuid,
  add column if not exists participation_state text;

-- One row per human-agent attach attempt. A call may have several monitor
-- attempts, cancellations, or a takeover race — a leg is not a single column.
create table if not exists public.human_agent_call_legs (
  id                uuid primary key default gen_random_uuid(),
  call_attempt_id   uuid not null references public.call_attempts(id) on delete cascade,
  -- Audit-log semantics: keep a removed agent's monitor/takeover history rather than
  -- deleting it. Nullable + SET NULL (not CASCADE). RLS gates on agent_id = auth.uid(),
  -- so a null-agent row is unreachable by any console user (service-role only) — history
  -- is preserved without ever being exposed. Insert RLS still forces agent_id = auth.uid().
  agent_id          uuid references public.console_agents(user_id) on delete set null,
  request_id        uuid not null unique,
  mode              text not null check (mode in ('monitor','takeover')),
  status            text not null check (status in
                      ('requested','dialing','ringing','connected','cancelled','failed','disconnected')),
  vox_sdk_call_id   text,
  vox_leg_call_id   text,
  device_id         text,
  requested_at      timestamptz not null default now(),
  connected_at      timestamptz,
  disconnected_at   timestamptz,
  failure_code      text,
  metadata          jsonb not null default '{}'::jsonb
);

-- At most one ACTIVE takeover per call — the atomic-claim guard (loser → 409).
create unique index if not exists one_active_takeover_per_call
  on public.human_agent_call_legs (call_attempt_id)
  where mode = 'takeover' and status in ('requested','dialing','ringing','connected');

create index if not exists human_agent_call_legs_attempt_idx
  on public.human_agent_call_legs (call_attempt_id);
create index if not exists human_agent_call_legs_agent_idx
  on public.human_agent_call_legs (agent_id);

alter table public.human_agent_call_legs enable row level security;

-- A console agent sees + manages only its own legs (mirrors agent_status own-row).
create policy human_agent_call_legs_select_own on public.human_agent_call_legs
  for select to authenticated
  using (agent_id = (select auth.uid()) and public.is_console_agent());
create policy human_agent_call_legs_insert_own on public.human_agent_call_legs
  for insert to authenticated
  with check (agent_id = (select auth.uid()) and public.is_console_agent());
create policy human_agent_call_legs_update_own on public.human_agent_call_legs
  for update to authenticated
  using (agent_id = (select auth.uid()))
  with check (agent_id = (select auth.uid()));

-- Least privilege: strip schema-default grants from BOTH roles, then re-grant only the
-- three verbs RLS actually needs. Without the authenticated revoke, default privileges
-- can leave delete/truncate/references on the role — the same latent hole the console
-- views were born with. This is a base table (RLS-enforced), so this is defense-in-depth.
revoke all on public.human_agent_call_legs from anon;
revoke all on public.human_agent_call_legs from authenticated;
grant select, insert, update on public.human_agent_call_legs to authenticated;

-- Realtime so the console can follow leg lifecycle (attach → connected → ended).
alter publication supabase_realtime add table public.human_agent_call_legs;
