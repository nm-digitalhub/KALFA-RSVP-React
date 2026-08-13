-- Browser call-center — internal agent-to-agent chat ("שלב 2" in the approved
-- plan, built now on explicit request).
--
-- DESIGN DECISION (documented here, not just in the PR): Supabase-native — a
-- `console_chat_messages` table + Realtime — over the Voximplant Web SDK's
-- Messaging module (@voximplant/websdk/modules/messaging), even though the
-- SDK is already installed for the call layer. Compared honestly:
--   - Identity: Messaging is a SECOND identity system (Vox users, distinct
--     from console_agents / auth.uid()). This feature needs zero new identity
--     — every console agent already has both.
--   - Billing: every Voximplant login/session is a billed MAU (free tier:
--     1,000/month — already a live constraint on the softphone's single-tab
--     lease, see web-client.ts). Chat riding the SAME phone session costs
--     nothing extra; a chat-only integration would still need its own
--     connect/login and would add MAU for a feature that doesn't need calls.
--   - Authorization: Messaging has no RLS of its own — access control would
--     be hand-built client- or scenario-side, duplicating what Postgres RLS
--     already gives every other console_* table for free.
--   - Persistence/history: Messaging has no Postgres persistence — history
--     and audit would live off-platform, outside pg_dump/backups and outside
--     every other admin surface's query patterns.
--   - Offline delivery: a Postgres row simply exists whether or not a peer is
--     connected; Realtime replays nothing retroactively, but SELECT does.
-- Supabase Realtime is already this repo's wired layer (console-channels.ts)
-- with a proven RLS story (is_console_agent() gates every console_* table;
-- verified pattern: a non-staff subscriber gets zero rows). Reusing it is
-- strictly less code and strictly more consistent than standing up a second
-- live-messaging stack for one panel section.

create table public.console_chat_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.console_agents (user_id) on delete restrict,
  -- Length CHECK is the real gate (project rule: client-side validation is UX
  -- only, the DB constraint is authoritative). Also rejects whitespace-only
  -- bodies — a composer bug or paste-of-blank should not create a row.
  body text not null check (btrim(body) <> '' and char_length(body) <= 2000),
  created_at timestamptz not null default now()
);

-- Hot read path is "latest N, then scroll" — same reasoning as
-- console_calls_agent_recent_idx (20260812154126).
create index console_chat_messages_created_at_idx
  on public.console_chat_messages (created_at desc);

alter table public.console_chat_messages enable row level security;

-- Append-only internal audit trail — same posture as fleet_requests: no
-- UPDATE/DELETE grant to any client role, ever. The default-privileges trap
-- documented in console-view-grants.test.ts applies to TABLES exactly as it
-- does to views (a bare `grant select` never revokes what Postgres's default
-- privileges already handed `authenticated`), so this revokes ALL before
-- granting the two verbs this feature actually needs.
revoke all on table public.console_chat_messages from anon, authenticated;
grant select, insert on table public.console_chat_messages to authenticated;

create policy console_chat_messages_select on public.console_chat_messages
  for select to authenticated
  using (is_console_agent());

create policy console_chat_messages_insert on public.console_chat_messages
  for insert to authenticated
  with check (is_console_agent() and author_id = auth.uid());

-- The live board: browser inserts directly (RLS is the gate — no route),
-- other agents' tabs pick it up over Realtime.
alter publication supabase_realtime add table public.console_chat_messages;
