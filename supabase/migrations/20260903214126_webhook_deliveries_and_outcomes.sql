-- 2026-09-03 — webhook inspector: raw Meta deliveries, billing outcome, import linkage
--
-- Three additive changes behind the /admin/webhooks detail view:
--
-- 1. public.webhook_deliveries — the verified POST body exactly as Meta sent it
--    (the full envelope: object / entry[] / changes[] / value{metadata,
--    contacts[], messages[] | statuses[] | …}). webhook_inbox keeps ONE row per
--    normalized event (message / status / template / generic field); the
--    envelope around those events (entry.id = WABA, entry.time, display phone,
--    the contacts block, messaging_product) was dropped on the floor. Now every
--    accepted delivery is stored once (UNIQUE on its sha256 — a Meta retry of
--    the same body is a no-op) and each inbox row points at it, so the admin can
--    always see "what Meta actually sent" next to "what we normalized".
--    Signature-rejected / malformed bodies are NOT stored (fail-closed — an
--    unverified body is untrusted input; they raise an ids-only alert instead).
--
-- 2. contact_interactions.billing_outcome — the try_record_billed_result RPC
--    outcome ('billed' | 'not_active' | 'not_authorized' | 'already_billed' |
--    …) recorded on the inbound interaction that triggered it. Until now only
--    the classification (billable=true) was visible, never whether the RPC
--    actually billed or WHY it refused — an inbound "היי" on a closed campaign
--    showed as billable with no trace that billing was declined.
--
-- 3. guest_import_staging.source_message_id — the inbound wamid a WhatsApp
--    guest-list import was staged from. Gives the inspector a hard link
--    (message → staged list) and makes a manual "reprocess" of that message
--    idempotent (the importer skips a wamid it already staged instead of
--    creating a duplicate pending list and re-sending the owner reply).
--
-- Security: webhook_deliveries holds PII (phones, names, message bodies) —
-- RLS on, admin-only SELECT for authenticated, service_role writes (the
-- webhook route + worker use the admin client). No policy change on the two
-- extended tables: a nullable column inherits their existing RLS.
--
-- Rollback (manual, in this order):
--   drop index if exists public.guest_import_staging_source_message_uidx;
--   alter table public.guest_import_staging drop column if exists source_message_id;
--   alter table public.contact_interactions drop column if exists billing_outcome;
--   alter table public.webhook_inbox drop column if exists delivery_id;
--   drop table if exists public.webhook_deliveries;

-- 1) Raw deliveries ------------------------------------------------------------

create table public.webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'whatsapp',
  body         jsonb not null,
  body_sha256  text not null,
  byte_length  integer not null,
  received_at  timestamptz not null default now(),
  constraint webhook_deliveries_provider_sha_key unique (provider, body_sha256)
);

comment on table public.webhook_deliveries is
  'Verified provider webhook POST bodies, stored verbatim (PII: phones, names, message text). One row per distinct body (sha256); webhook_inbox rows reference it via delivery_id. Admin-only read.';
comment on column public.webhook_deliveries.body_sha256 is
  'sha256 hex of the raw request body — dedupes a provider retry of the identical delivery.';
comment on column public.webhook_deliveries.byte_length is
  'Raw body length in bytes (diagnostics; Meta caps deliveries at 3MB).';

create index webhook_deliveries_received_idx
  on public.webhook_deliveries (received_at desc);

alter table public.webhook_deliveries enable row level security;

create policy webhook_deliveries_admin_select on public.webhook_deliveries
  for select
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

revoke all on public.webhook_deliveries from anon, authenticated;
grant select on public.webhook_deliveries to authenticated;

-- 2) Inbox rows → their delivery ----------------------------------------------

alter table public.webhook_inbox
  add column delivery_id uuid null
    references public.webhook_deliveries (id) on delete set null;

comment on column public.webhook_inbox.delivery_id is
  'The verified delivery (webhook_deliveries) this normalized event was extracted from. NULL for rows persisted before 2026-09-03 and for providers that do not store deliveries.';

create index webhook_inbox_delivery_idx
  on public.webhook_inbox (delivery_id)
  where delivery_id is not null;

-- 3) Billing outcome on the inbound interaction --------------------------------

alter table public.contact_interactions
  add column billing_outcome text null;

comment on column public.contact_interactions.billing_outcome is
  'try_record_billed_result outcome for the inbound interaction that triggered it (billed | already_billed | not_active | not_authorized | ceiling_reached | closed_window | before_window | removal_requested | event_passed | event_not_active | event_mismatch | no_campaign | no_exposure). NULL = not a billing trigger or recorded before 2026-09-03. billable=true is the classification; this is what actually happened.';

-- 4) Import staging ↔ inbound message ------------------------------------------

alter table public.guest_import_staging
  add column source_message_id text null;

comment on column public.guest_import_staging.source_message_id is
  'Inbound WhatsApp wamid the list was staged from (webhook_inbox.message_id). Unique when set: reprocessing that message is a no-op instead of a duplicate list.';

create unique index guest_import_staging_source_message_uidx
  on public.guest_import_staging (source_message_id)
  where source_message_id is not null;
