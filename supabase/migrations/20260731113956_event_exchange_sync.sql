-- =====================================================================
-- exchange_calendar_links — correlation between a KALFA event and the
-- appointment(s) written for it into the business's connected Exchange
-- calendar (Layer 2: one-way event → Exchange sync).
--
-- WHY A TABLE AND NOT A DERIVED LOOKUP: the Exchange appointment id
-- (ItemId.UniqueId) is opaque and lives only in the mailbox — nothing about
-- an `events` row lets us find "the appointment we already made for this
-- event" without storing the correlation ourselves. Same rationale as
-- exchange_availability_blocks (20260727205735): MAPI extended properties
-- are unusable on this stack (Node-24 bug in ews-javascript-api), so an
-- app-side row is the only anchor.
--
-- UNIQUE event_id IS THE IDEMPOTENCY GUARD: a duplicate publish/sync attempt
-- for the same event either finds the existing row (no-op — see
-- src/lib/data/event-exchange-sync.ts) or the insert fails, but it can never
-- create a second Exchange appointment for the same event.
--
-- subject_synced records the LAST subject line written, for detecting drift
-- on a future update — not read/used yet (this stage only creates and
-- cancellation-marks; it never re-syncs an edited event, see
-- plans/exchange-ews-stage2 scope notes), but storing it now avoids a second
-- migration once that lands.
--
-- CLOSED-TABLE PATTERN (precedent: exchange_connections, exchange_availability_
-- blocks): RLS enabled with ZERO policies + REVOKE from anon/authenticated. No
-- browser-reachable path; reached only by server-only DAL
-- (src/lib/data/event-exchange-sync.ts) through the service-role client — the
-- sync runs off the BUSINESS's Exchange connection, not the customer's own
-- session, so it is service-role by construction (same reasoning as the
-- callback-scheduling "business connection" loader).
--
-- ROLLBACK: drop table if exists public.exchange_calendar_links;
--   Safe — nothing references it; dropping it leaves any already-created
--   Exchange appointments in place (they simply stop being app-tracked, same
--   as exchange_availability_blocks).
-- =====================================================================

create table if not exists public.exchange_calendar_links (
  id             uuid primary key default gen_random_uuid(),
  -- One correlation row per event — see idempotency note above.
  event_id       uuid not null references public.events(id) on delete cascade,
  -- The Exchange connection the appointment lives in. An appointment id is
  -- only meaningful for the mailbox+credentials that produced it.
  connection_id  uuid not null references public.exchange_connections(id) on delete cascade,
  -- ItemId.UniqueId of the main event appointment (opaque; see provider.ts).
  appointment_id text not null check (btrim(appointment_id) <> ''),
  -- ItemId.UniqueId of the separate all-day "RSVP deadline" item, when the
  -- event has a rsvp_deadline. NULL when the event has none.
  rsvp_deadline_appointment_id text,
  -- Last subject line written to the main appointment — for future drift
  -- detection (see header note); not read by this stage's own code.
  subject_synced text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exchange_calendar_links_event_unique unique (event_id)
);

comment on table public.exchange_calendar_links is
  'Correlation between a KALFA event and the appointment(s) synced for it into the business Exchange calendar (Layer 2, one-way). Closed table: RLS on with no policies, grants revoked — server-only DAL via service-role. unique(event_id) is the idempotency guard against double-creating an appointment.';

drop trigger if exists exchange_calendar_links_set_updated_at
  on public.exchange_calendar_links;
create trigger exchange_calendar_links_set_updated_at
  before update on public.exchange_calendar_links
  for each row execute function public.set_updated_at();

alter table public.exchange_calendar_links enable row level security;

-- No policy ON PURPOSE (deny-all under RLS for every non-bypassing role),
-- plus explicit REVOKE — belt and braces, exactly like exchange_connections
-- and exchange_availability_blocks.
revoke all on public.exchange_calendar_links from anon;
revoke all on public.exchange_calendar_links from authenticated;

-- Cleanup/lookup by connection (e.g. "what did this connection write" if a
-- connection is ever revoked and its links need auditing).
create index if not exists exchange_calendar_links_connection_id_idx
  on public.exchange_calendar_links (connection_id);
