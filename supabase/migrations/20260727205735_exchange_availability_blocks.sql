-- =====================================================================
-- exchange_availability_blocks — the owner's availability constraints,
-- correlated to the Exchange appointments that express them.
--
-- WHY A TABLE AND NOT A SINGLE "current status" COLUMN: an availability
-- constraint is a TIME RANGE, not a state. "Unavailable from now until
-- tomorrow 09:00" simply stops applying when tomorrow arrives — Exchange
-- itself stops counting a past appointment toward free/busy, so status
-- returns to available with NO timer, NO cron, NO expiry job on our side.
-- Several constraints can also overlap (an "out of office" evening plus a
-- "working elsewhere" day), which one column could not express.
--
-- WHY WE STORE THEM AT ALL (Exchange already holds the appointment): the
-- correlation is what lets "I'm available again" delete ONLY the blocks WE
-- created — never a real meeting the owner booked himself. Same reason the
-- calendar-sync design keeps its own link table: MAPI extended properties
-- are unusable here (Node-24 bug in ews-javascript-api, see
-- plans/exchange-ews-stage1.md §0), so an app-side row is the only anchor.
--
-- CLOSED-TABLE PATTERN (precedent: exchange_connections, console_agent_secrets):
-- RLS enabled with ZERO policies + REVOKE from anon/authenticated. No
-- browser-reachable path; reached only by server-only DAL through the
-- service-role client, which is itself gated by
-- requirePlatformPermission('manage_settings') — the same gate as the
-- Exchange connection screens (business-admin feature, owner ruling 27.07).
--
-- ROLLBACK: drop table if exists public.exchange_availability_blocks;
--   Safe — nothing references it; dropping it leaves the Exchange
--   appointments in place (they simply stop being app-managed).
-- =====================================================================

create table if not exists public.exchange_availability_blocks (
  id             uuid primary key default gen_random_uuid(),
  -- Whose availability this expresses; also the row's ownership filter.
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- The Exchange connection the appointment lives in. An appointment id is
  -- only meaningful for the mailbox+credentials that produced it.
  connection_id  uuid not null references public.exchange_connections(id) on delete cascade,
  -- ItemId.UniqueId of the blocking appointment (opaque; see provider.ts).
  appointment_id text not null check (btrim(appointment_id) <> ''),

  -- The constraint window. `ends_at > starts_at` is enforced; expiry is
  -- implicit (a past window simply no longer affects availability).
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  -- Mirrors EWS LegacyFreeBusyStatus (verified against the installed d.ts):
  -- busy / oof / working_elsewhere / tentative. 'free' is NOT a stored state —
  -- becoming available again means DELETING the active block(s), not writing
  -- a "free" row.
  show_as        text not null check (show_as in ('busy', 'oof', 'working_elsewhere', 'tentative')),
  -- Hebrew label shown in the UI and used as the appointment subject. Kept
  -- from a fixed server-side vocabulary — never free-form user text, so
  -- nothing unexpected is ever written to the third-party mailbox.
  label          text not null check (btrim(label) <> ''),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint exchange_availability_blocks_window check (ends_at > starts_at)
);

comment on table public.exchange_availability_blocks is
  'Owner availability constraints, each backed by a blocking Exchange appointment (LegacyFreeBusyStatus). Closed table: RLS on with no policies, grants revoked — server-only DAL via service-role. Expiry is implicit: a past window stops affecting free/busy on its own.';

drop trigger if exists exchange_availability_blocks_set_updated_at
  on public.exchange_availability_blocks;
create trigger exchange_availability_blocks_set_updated_at
  before update on public.exchange_availability_blocks
  for each row execute function public.set_updated_at();

alter table public.exchange_availability_blocks enable row level security;

-- No policy ON PURPOSE (deny-all under RLS for every non-bypassing role),
-- plus explicit REVOKE — belt and braces, exactly like exchange_connections.
revoke all on public.exchange_availability_blocks from anon;
revoke all on public.exchange_availability_blocks from authenticated;

-- The hot query: "which of my blocks are still in effect / upcoming?"
create index if not exists exchange_availability_blocks_user_window_idx
  on public.exchange_availability_blocks (user_id, ends_at desc);
