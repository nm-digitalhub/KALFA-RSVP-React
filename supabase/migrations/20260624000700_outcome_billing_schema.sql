-- =====================================================================
-- Outcome-based billing schema (campaign approval + reached-contact).
-- Spec: plans/plan-paid.md · Plan: .claude/plans/outcome-billing-model.md
-- All billing/state WRITES go through createAdminClient() (service-role) in
-- server code with explicit ownership checks; RLS here is for READ scoping
-- (owner SELECT via owns_event) + admin. The client never creates billed rows.
-- New enum types are CREATEd and used in the same migration (allowed; only
-- ALTER TYPE ... ADD VALUE on an existing enum is restricted intra-txn).
-- =====================================================================

-- ---------- enums ----------
do $$ begin
  create type campaign_status as enum (
    'draft','pending_approval','approved','scheduled','active',
    'paused','closed','awaiting_invoice','billed','paid','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_channel as enum ('whatsapp','call');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_route as enum ('saved_token','hold_j5');
exception when duplicate_object then null; end $$;

-- Per-contact operational status (§11). Richer than the existing guests.contact_status.
do $$ begin
  create type contact_op_status as enum (
    'pending_contact','not_eligible',
    'whatsapp_sent','whatsapp_delivered','whatsapp_read','whatsapp_responded',
    'pending_call','call_dialed','no_answer','voicemail','human_interaction_call',
    'wrong_number','removal_requested','reached_billed','not_reached');
exception when duplicate_object then null; end $$;

-- Shadow-DB replay repair (27.8.2026): `public.campaigns` itself was never
-- created by any migration (same drift as events/packages/app_role above) —
-- this is the first file that ALTERs it. Bootstrapped minimal (id + event_id
-- only), matching `supabase db dump`'s own campaigns definition exactly at
-- this point — every other column below is added by this file's own ADD
-- COLUMN IF NOT EXISTS statements, so no further columns are needed here.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id)
);

alter table public.campaigns enable row level security;

create policy camp_admin_all on public.campaigns for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Same drift, same fix: owns_event() is used by camp_owner_select below but
-- was never created by any migration. Verbatim from `supabase db dump`.
create or replace function public.owns_event(_event_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists(select 1 from public.events where id = _event_id and owner_id = auth.uid());
$$;

-- Same drift, same fix: `public.guests` (+ its guest_status/contact_status
-- enums) were never created by any migration, and this file is the first to
-- ALTER it (the "link guests → contact" step below). Verbatim from
-- `supabase db dump`, full current shape (including contact_id) — the later
-- ADD COLUMN IF NOT EXISTS in this same file simply no-ops on it.
do $$ begin
  create type public.guest_status as enum ('pending', 'attending', 'declined', 'maybe');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contact_status as enum (
    'not_contacted', 'contacted', 'responded', 'wrong_number',
    'unclear', 'unavailable', 'callback');
exception when duplicate_object then null; end $$;

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  group_id uuid,
  rsvp_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  full_name text not null,
  phone text,
  language text default 'he',
  expected_count integer default 1,
  status public.guest_status not null default 'pending',
  confirmed_adults integer default 0,
  confirmed_kids integer default 0,
  meal_pref text,
  note text,
  contact_status public.contact_status not null default 'not_contacted',
  callback_requested boolean not null default false,
  extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  contact_id uuid,
  rsvp_token_revoked_at timestamptz,
  confirmed_headcount integer not null default 0,
  headcount_requested_at timestamptz,
  headcount_answered_at timestamptz,
  headcount_attempts integer not null default 0,
  rsvp_note text,
  show_in_guest_list boolean not null default false
  -- guests_confirmed_adults_nonneg / guests_confirmed_headcount_range /
  -- guests_confirmed_kids_nonneg / guests_expected_count_positive
  -- deliberately NOT included here — all four are added later by their own
  -- real migrations via plain `ADD CONSTRAINT` (no guard); including them
  -- here too would collide on replay.
);

alter table public.guests enable row level security;

create policy guests_admin_all on public.guests for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ---------- 1. campaigns: expand to "campaign approval" + billing ----------
alter table public.campaigns
  add column if not exists status                 campaign_status not null default 'draft',
  add column if not exists price_per_reached       numeric,
  add column if not exists max_contacts            integer,
  add column if not exists max_charge_ceiling       numeric,
  add column if not exists allowed_channels         campaign_channel[] not null default '{whatsapp,call}',
  add column if not exists start_at                 timestamptz,
  add column if not exists tos_version              text,
  add column if not exists approved_by              uuid,
  add column if not exists approved_at              timestamptz,
  add column if not exists escalation_delay_seconds integer,
  -- billing route + shared
  add column if not exists billing_route            billing_route,
  add column if not exists final_charge_amount      numeric,
  add column if not exists final_invoice_document_id integer,
  -- route A (J5 hold)
  add column if not exists auth_amount              numeric,
  add column if not exists auth_number              text,
  add column if not exists authorized_at            timestamptz,
  add column if not exists auth_expires_at          timestamptz,
  add column if not exists capture_status           text,   -- pending|captured|failed
  add column if not exists release_status           text,   -- pending|released|expired
  add column if not exists sumit_order_document_id  integer,
  -- route B (saved card token)
  add column if not exists card_token_ref           text;   -- SUMIT saved payment method ref

-- campaigns RLS: owner read-only (writes via server/admin, like orders).
-- The minimal table is empty and unused by app code, so this is safe.
drop policy if exists camp_owner on public.campaigns;
create policy camp_owner_select on public.campaigns for select
  using (public.owns_event(event_id));
-- camp_admin_all (ALL, has_role admin) is left intact.

-- ---------- 2. contacts: unique reachable phone per event ----------
create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete cascade,
  normalized_phone  text not null,                       -- E.164
  op_status         contact_op_status not null default 'pending_contact',
  removal_requested boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contacts_event_phone_unique unique (event_id, normalized_phone)
);
-- link guests → contact (many guests may share one phone/contact)
alter table public.guests
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
create index if not exists contacts_event_idx on public.contacts (event_id);
create index if not exists guests_contact_idx on public.guests (contact_id);

alter table public.contacts enable row level security;
drop policy if exists contacts_owner_select on public.contacts;
create policy contacts_owner_select on public.contacts for select
  using (public.owns_event(event_id));
drop policy if exists contacts_admin_all on public.contacts;
create policy contacts_admin_all on public.contacts for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));
drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------- 3. billed_results: SOURCE OF TRUTH for billing (§12/§13) ----------
create table if not exists public.billed_results (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  channel       campaign_channel not null,
  attempt_id    text,
  reached_at    timestamptz not null default now(),
  locked_price  numeric not null,                        -- price locked at creation (§354)
  evidence_source text not null,                         -- whatsapp_inbound|call_asr|call_dtmf
  provider_ref  text,                                    -- whatsapp message id / call session id
  control_status text not null default 'confirmed',      -- confirmed|adjusted|disputed
  manual_adjustment jsonb,
  created_at    timestamptz not null default now(),
  -- §13: at most one billed result per contact per event (DB-level guarantee)
  constraint billed_results_event_contact_unique unique (event_id, contact_id)
);
create index if not exists billed_results_campaign_idx on public.billed_results (campaign_id);

alter table public.billed_results enable row level security;
-- owner may READ (transparency §16); only the server (admin client) writes.
drop policy if exists billed_results_owner_select on public.billed_results;
create policy billed_results_owner_select on public.billed_results for select
  using (public.owns_event(event_id));
drop policy if exists billed_results_admin_all on public.billed_results;
create policy billed_results_admin_all on public.billed_results for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ---------- 4. contact_interactions: provider event log + webhook dedup ----------
create table if not exists public.contact_interactions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references public.events(id) on delete cascade,
  campaign_id  uuid references public.campaigns(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete set null,
  channel      campaign_channel not null,
  direction    text not null,                            -- inbound|outbound
  kind         text not null,                            -- whatsapp_message|whatsapp_status|call_result
  provider_id  text not null,                            -- messages[].id / voximplant session id
  billable     boolean not null default false,
  payload_meta jsonb,                                    -- NON-sensitive only
  created_at   timestamptz not null default now(),
  -- dedup: Meta retries the same messages[].id for up to 7 days
  constraint contact_interactions_provider_unique unique (channel, provider_id)
);
create index if not exists contact_interactions_contact_idx on public.contact_interactions (contact_id);

alter table public.contact_interactions enable row level security;
drop policy if exists contact_interactions_owner_select on public.contact_interactions;
create policy contact_interactions_owner_select on public.contact_interactions for select
  using (event_id is not null and public.owns_event(event_id));
drop policy if exists contact_interactions_admin_all on public.contact_interactions;
create policy contact_interactions_admin_all on public.contact_interactions for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ---------- 5. credits / billing adjustments (§16 — append-only) ----------
create table if not exists public.billing_credits (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  amount      numeric not null,                          -- positive = credit to customer
  reason      text not null,
  created_by  uuid,                                      -- admin user id
  created_at  timestamptz not null default now()
);
create index if not exists billing_credits_campaign_idx on public.billing_credits (campaign_id);

alter table public.billing_credits enable row level security;
drop policy if exists billing_credits_owner_select on public.billing_credits;
create policy billing_credits_owner_select on public.billing_credits for select
  using (public.owns_event(event_id));
drop policy if exists billing_credits_admin_all on public.billing_credits;
create policy billing_credits_admin_all on public.billing_credits for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));

-- ---------- 6. signed_agreements (legal: signature + ID) — ADMIN-ONLY ----------
-- Holds references to the signature image, ID document (private Storage), and
-- the signed-PDF hash. Sensitive PII → NO owner read; server/admin only.
create table if not exists public.signed_agreements (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  signer_user_id    uuid not null,
  agreement_version text not null,
  signed_at         timestamptz not null default now(),
  ip                text,
  user_agent        text,
  signature_ref     text,                                -- storage path
  id_document_ref   text,                                -- storage path (private bucket)
  content_hash      text not null,                       -- SHA-256 of final PDF bytes
  pdf_ref           text,                                -- storage path
  created_at        timestamptz not null default now()
);
create index if not exists signed_agreements_campaign_idx on public.signed_agreements (campaign_id);

alter table public.signed_agreements enable row level security;
-- admin-only (no owner read of ID/signature refs). Server writes via service-role.
drop policy if exists signed_agreements_admin_all on public.signed_agreements;
create policy signed_agreements_admin_all on public.signed_agreements for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));
