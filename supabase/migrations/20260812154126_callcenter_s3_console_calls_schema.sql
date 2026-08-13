-- Browser call-center stage 3: console-call data model + feature flags.
--
-- Design (approved plan, "מודל נתונים"): console_calls holds every human-console
-- call (manual outbound / inbound / internal / linked ai_handoff) with NO PII —
-- safe for Realtime + agent SELECT. PII and live-session capabilities live in
-- console_call_pii, closed to every client role (console_agent_secrets
-- precedent). call_attempts is untouched — its UNIQUE keys and billing
-- semantics are AI-outreach-shaped; a handed-off AI call keeps its full
-- call_attempts row and gains a LINKED console_calls row (kind='ai_handoff').

-- 1 · The call ledger (PII-free).
create table public.console_calls (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  kind text not null check (kind in ('manual', 'inbound_customer', 'internal', 'ai_handoff')),
  status text not null default 'initiated'
    check (status in ('initiated', 'ringing', 'connected', 'ended', 'missed', 'failed', 'no_agent')),
  agent_id uuid references public.console_agents (user_id) on delete set null,
  peer_agent_id uuid references public.console_agents (user_id) on delete set null,
  transferred_to_agent_id uuid references public.console_agents (user_id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  guest_id uuid references public.guests (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  call_attempt_id uuid references public.call_attempts (id) on delete set null,
  -- Masked display hint for inbound CLI (e.g. "05x-xxx1234"). NEVER a full
  -- number and NEVER authorization — the full E.164 lives in console_call_pii.
  caller_masked text,
  disclosure_played boolean not null default false,
  has_recording boolean not null default false,
  ended_reason text,
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_sec integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index console_calls_agent_recent_idx
  on public.console_calls (agent_id, created_at desc);
-- The live board: only calls still in flight.
create index console_calls_live_idx
  on public.console_calls (status)
  where status in ('initiated', 'ringing', 'connected');
create index console_calls_event_idx on public.console_calls (event_id);
create index console_calls_attempt_idx on public.console_calls (call_attempt_id);

alter table public.console_calls enable row level security;

-- Written by server routes / the worker sweep only; agents read.
revoke all on table public.console_calls from anon, authenticated;
grant select on table public.console_calls to authenticated;

create policy console_calls_select on public.console_calls
  for select to authenticated
  using (is_console_agent());

drop trigger if exists console_calls_set_updated_at on public.console_calls;
create trigger console_calls_set_updated_at
  before update on public.console_calls
  for each row execute function public.set_updated_at();

-- 2 · PII + capability side table (server-only, console_agent_secrets precedent).
create table public.console_call_pii (
  call_id uuid primary key references public.console_calls (id) on delete cascade,
  phone_e164 text,
  vox_session_id bigint,
  -- The media-session URLs are CAPABILITIES (the power to command a live call)
  -- — same rule as call_attempts.media_session_access_*: they never cross the
  -- API boundary to a client.
  session_url text,
  secure_session_url text,
  recording_url text,
  -- Manual-dial handshake: only the HASH of the one-time dial token is stored.
  dial_token_hash text,
  dial_token_expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.console_call_pii enable row level security;
-- RLS on with ZERO policies + zero client grants: service-role only.
revoke all on table public.console_call_pii from anon, authenticated;

-- 3 · Agent roster view. Views run as postgres (RLS bypass) — the WHERE
-- predicate IS the gate (standing rule: every console view repeats
-- is_console_agent()). PII-free: names + presence only.
create view public.console_agents_roster as
select
  ca.user_id,
  ca.display_name,
  coalesce(ast.status, 'not_ready') as status,
  ast.updated_at as status_updated_at,
  (ca.vox_username is not null and cas.user_id is not null) as provisioned
from public.console_agents ca
left join public.agent_status ast on ast.agent_id = ca.user_id
left join public.console_agent_secrets cas on cas.user_id = ca.user_id
where is_console_agent();

revoke all on public.console_agents_roster from anon;
grant select on public.console_agents_roster to authenticated;

-- 4 · Feature flags (all default OFF — dark until each stage's gate).
alter table public.app_settings
  add column console_softphone_enabled boolean not null default false,
  add column console_manual_dial_enabled boolean not null default false,
  add column inbound_calls_enabled boolean not null default false,
  add column handoff_enabled boolean not null default false,
  -- The DTMF-'9' smoke hook (stage 6) — an app_settings flag, not a scenario
  -- constant, so enabling a regression test never costs a scenario redeploy.
  add column console_dtmf_handoff_enabled boolean not null default false;

-- 5 · Realtime: the live board subscribes to console_calls (postgres_changes;
-- subscribers see only what the SELECT policy grants them — non-staff = zero
-- rows, verified pattern on the existing four published tables).
alter publication supabase_realtime add table public.console_calls;
