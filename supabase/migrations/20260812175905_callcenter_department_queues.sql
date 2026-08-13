-- Browser call-center — department queues (plan §10 extension point: "מחלקות
-- (נקודת הרחבה = ring-order בשרת)"). Adds queue membership as an ADDITIVE layer
-- on top of the existing server-side ring-order mechanism
-- (findRoutableAgentVoxUsernames + computeRingOrder in console-calls.ts) — no
-- SmartQueue/ACDv2 adoption (deferred+rejected by the plan: duplicates the
-- agent_status presence model and has no v5 integration guide).
--
-- NOT YET APPLIED to the linked project (task scope: migration FILE only, no
-- `supabase db push`). src/lib/data/console-queues.ts carries a documented,
-- narrow local TypeScript augmentation of the generated `Database` type for
-- exactly the two new tables + the one new column below, because
-- `supabase gen types --linked` cannot run before this file is pushed. Once
-- the owner applies this migration and types are regenerated, that
-- augmentation becomes redundant and should be deleted (its header says so).

-- 1 · Queue catalog. Four departments seeded below; is_active gates whether a
-- queue is ever offered as a ring-order source (see console-queues.ts
-- resolveActiveQueueForRing — an inactive queue is treated exactly like a
-- queue with zero members: fall through to the next candidate).
create table public.console_queues (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name_he text not null,
  is_active boolean not null default true,
  -- Display/tie-break ordering only in V1 (admin listing, ascending). NOT yet
  -- read by any routing decision — ring order is resolved for exactly one
  -- queue at a time (no multi-queue matching in V1), so there is nothing to
  -- break ties between today. Typed extension point for a future
  -- multi-signal queue selector (e.g. DTMF-IVR, plan §10).
  priority integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.console_queues enable row level security;

-- Queue membership is an admin decision, not self-service (task brief) — the
-- ONLY writers are Server Actions running under createAdminClient() +
-- requirePlatformPermission('manage_voice'), which bypass RLS entirely as the
-- service role. Explicit revoke-before-grant (console-view-grants.test.ts's
-- documented reason: a bare `grant select` does NOT remove the schema
-- default privileges already handed to `authenticated`).
revoke all on table public.console_queues from anon, authenticated;
grant select on table public.console_queues to authenticated;

create policy console_queues_select on public.console_queues
  for select to authenticated
  using (is_console_agent());

-- 2 · Queue membership (many-to-many, console_agents <-> console_queues).
create table public.console_agent_queues (
  agent_id uuid not null references public.console_agents (user_id) on delete cascade,
  queue_id uuid not null references public.console_queues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (agent_id, queue_id)
);

-- Reverse lookup: "who is in queue X" (routing + admin membership listing).
-- The primary key already covers "which queues is agent X in" via its
-- leading column.
create index console_agent_queues_queue_idx on public.console_agent_queues (queue_id);

alter table public.console_agent_queues enable row level security;

revoke all on table public.console_agent_queues from anon, authenticated;
grant select on table public.console_agent_queues to authenticated;

create policy console_agent_queues_select on public.console_agent_queues
  for select to authenticated
  using (is_console_agent());

-- 3 · console_calls gains a nullable queue_id so an inbound call records which
-- queue served it (the ACTIVE queue actually used to build its ring order —
-- never an inactive/unresolvable queue; see resolveActiveQueueForRing). No
-- RLS/grant change needed: console_calls' existing policies already cover the
-- whole row.
alter table public.console_calls
  add column queue_id uuid references public.console_queues (id) on delete set null;

create index console_calls_queue_idx on public.console_calls (queue_id);

-- 4 · Seed the four departments from the plan's scope decision (מכירות/תמיכה/
-- אירועים/גבייה). 'support' is also DEFAULT_QUEUE_KEY in console-queues.ts —
-- see that module's header for why V1 always resolves to a single flat
-- default (no caller-history-based department guess).
insert into public.console_queues (key, name_he, is_active, priority) values
  ('sales', 'מכירות', true, 10),
  ('support', 'תמיכה', true, 20),
  ('events', 'אירועים', true, 30),
  ('billing', 'גבייה', true, 40);
