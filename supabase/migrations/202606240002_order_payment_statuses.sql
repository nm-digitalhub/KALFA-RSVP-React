-- Shadow-DB replay repair (27.8.2026): `order_status` and `public.orders` were
-- never created by any migration in this repo — both were applied directly to
-- the live database at the time (the same class of drift this session found
-- and fixed for console_agents_roster / inquiry_messages / signed_agreements).
-- That silently broke `supabase db pull`/`db push`'s shadow-DB replay, which
-- reconstructs the schema from migration files alone, starting from empty.
--
-- The `orders` feature was fully removed by 20260709120000_remove_orders.sql
-- (table dropped, type dropped) — nothing here affects the LIVE database,
-- which already has this migration's version recorded as applied and will
-- never re-run this file. This reconstruction exists solely so a fresh local
-- shadow DB can replay history end-to-end and land in the same final state
-- (no orders table, no order_status type) that production is already in.
--
-- Reconstructed from the last pre-removal commit (f400e3b~1): the generated
-- Database types (src/lib/supabase/types.ts) gave the authoritative column
-- set and the original 3-value enum; src/lib/data/orders.ts confirmed the
-- columns the app actually read; 20260709120000_remove_orders.sql's own
-- DROP CONSTRAINT/DROP INDEX/DROP POLICY names confirm the constraint/index
-- names below.
--
-- `orders` also FKs into `public.events`/`public.packages` — both hit the
-- SAME never-migrated drift (confirmed: no CREATE TABLE for either anywhere
-- in supabase/migrations/), and neither is a removed feature, so there is no
-- git snapshot to reconstruct from. Backfilled here instead verbatim from
-- `supabase db dump` against the LIVE project (27.8.2026) — the exact current
-- shape, not a guess. This is the first migration in sequence that needs
-- them, which is why the bootstrap lives in this file despite the filename.
-- Every downstream migration that touches these tables/types already uses
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / a duplicate_object-guarded
-- `do $$ … exception when duplicate_object then null; end $$` (verified for
-- campaign_channel in 202606240007_outcome_billing_schema.sql), so creating
-- the full current shape here and letting later migrations no-op forward is
-- safe and matches this repo's own established migration idiom.

-- app_role/user_roles/has_role moved here from 202606240005 (28.8.2026 fix):
-- my events_admin_all/packages_admin_all policies below need has_role()+
-- app_role, which must exist BEFORE this point, not after it.
do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role
  );
$$;

-- ur_admin_all / ur_self_read: same drift, original text from
-- 20260713143941_gap1_rls_initplan_optimization.sql's own documentation.
create policy ur_admin_all on public.user_roles for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy ur_self_read on public.user_roles for select
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'::public.app_role));

create type public.event_status as enum ('draft', 'active', 'closed');

create type public.event_type as enum (
  'wedding', 'bar_mitzvah', 'bat_mitzvah', 'brit', 'britah',
  'henna', 'engagement', 'birthday', 'other'
);

do $$ begin
  create type public.campaign_channel as enum ('whatsapp', 'call');
exception when duplicate_object then null; end $$;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  event_type public.event_type not null default 'wedding',
  event_date timestamptz,
  venue_name text,
  venue_address text,
  template text default 'classic',
  package_id uuid,
  with_ai_calls boolean not null default false,
  status public.event_status not null default 'draft',
  rsvp_deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  org_id uuid,
  celebrants jsonb,
  gift_payment_url text,
  gift_link_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  invite_image_path text,
  show_meal_pref boolean not null default true
  -- events_gift_payment_url_https / events_rsvp_deadline_within_event
  -- deliberately NOT included here: both are added later by their own real
  -- migrations (20260705120408 / 20260630072729) via plain `ADD CONSTRAINT`
  -- (no IF NOT EXISTS guard for CHECK constraints in Postgres) — including
  -- them here too would collide with those statements on replay.
);

alter table public.events enable row level security;

-- Same drift, same fix: `events_admin_all` was never created either — the
-- GAP-1 optimization migration (20260713143941) ALTERs it and treats it as
-- pre-existing/untouched. Original qual, verbatim from that file's own
-- documentation comment.
create policy events_admin_all on public.events for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tier text not null,
  category text not null default 'digital',
  price_with_vat numeric(10, 2) not null,
  description text,
  includes jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  price_per_reached numeric,
  channels public.campaign_channel[],
  outreach_schedule jsonb,
  min_hold_floor numeric not null default 0,
  hold_buffer_pct numeric not null default 0,
  base_price numeric,
  included_reached integer
  -- packages_base_overage_nonneg / packages_hold_buffer_pct_nonnegative /
  -- packages_min_hold_floor_nonnegative / packages_price_per_reached_positive
  -- deliberately NOT included here — all four are added later by their own
  -- real migrations via plain `ADD CONSTRAINT` (no guard), so including them
  -- here too would collide on replay. Same reasoning as the events check
  -- constraints above.
);

alter table public.packages enable row level security;

create policy packages_admin_all on public.packages for all
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create type public.order_status as enum ('pending', 'paid', 'failed');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  event_id uuid references public.events (id),
  package_id uuid references public.packages (id),
  status public.order_status not null default 'pending',
  total_with_vat numeric not null,
  vat_rate numeric not null default 0,
  with_ai_addon boolean not null default false,
  terms_accepted boolean not null default false,
  privacy_accepted boolean not null default false,
  authorization_accepted boolean not null default false,
  sumit_document_id integer,
  paid_at timestamptz,
  payment_attempt_ref uuid not null default gen_random_uuid(),
  payment_processing_started_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- Only enum additions — must be committed before _0003 uses these values.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'processing';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'payment_review';
