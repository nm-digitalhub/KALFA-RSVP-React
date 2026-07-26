-- =====================================================================
-- channels: admin-managed display/metadata catalog for outreach channels.
--
-- Purpose (Stage 1 of plans/channels-data-driven-plan.md): make the channel
-- SET's metadata — display label, built-flag, active-flag, sort order — into
-- admin-managed DATA, removing the hardcoded ['whatsapp','call'] +
-- CHANNEL_LABELS literals in the admin package UI (package-form.tsx).
--
-- This table is a CATALOG ONLY. Its `key` MIRRORS the campaign_channel enum
-- labels (VERIFIED-LIVE 2026-07-26: enum labels are exactly 'whatsapp','call').
-- Nothing on the money/outreach path changes:
--   * the campaign_channel enum is UNTOUCHED (still the storable-value guard),
--   * packages.channels and campaigns.allowed_channels arrays are UNTOUCHED,
--   * validation stays enum-based in Stage 1.
-- A catalog row alone does NOT make a channel functional and does NOT let a new
-- channel be added without a migration (the enum + arrays remain the storable
-- constraint) — this only removes hardcode of the SET's labels/status/order.
--
-- Access model (mirrors app_settings — the admin-config precedent):
--   * SELECT: any authenticated user (cookie/session client). The catalog is
--     non-sensitive display metadata read by the admin package form. A column
--     without a GRANT fails 42501 even with a perfect policy, so SELECT is
--     granted explicitly to authenticated.
--   * INSERT/UPDATE/DELETE: platform admins only, enforced by RLS
--     (has_role admin). Admin writes go through the cookie client, so the
--     authenticated role holds the write GRANTs and the admin policy gates them.
--     anon has all privileges revoked and no policy — public flows never touch
--     this table.
--
-- has_role signature (VERIFIED-LIVE pg_catalog 2026-07-26):
--   public.has_role(_user_id uuid, _role app_role) returns boolean  [SECDEF, STABLE]
--   app_role labels: 'admin','user' (admin value confirmed = 'admin').
-- Policy predicates use the post-audit initplan-wrapped form
--   (select public.has_role((select auth.uid()), 'admin'::app_role))
-- so the auth expression is hoisted to a single per-statement InitPlan
-- (audit migration 20260713143941). New policies are born initplan-correct.
--
-- ROLLBACK: drop trigger if exists channels_set_updated_at on public.channels;
--           drop table if exists public.channels;
--   Safe — no FK depends on this table in Stage 1; nothing on the money path
--   references it.
-- =====================================================================

create table if not exists public.channels (
  key          text primary key,           -- mirrors campaign_channel labels: 'whatsapp','call'
  display_name text not null,
  is_built     boolean not null default false,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint channels_key_not_blank check (btrim(key) <> ''),
  constraint channels_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.channels is
  'Admin-managed display/metadata catalog for outreach channels. key mirrors the campaign_channel enum labels; not a storable-value constraint. See plans/channels-data-driven-plan.md Stage 1.';

-- Shared moddatetime trigger (public.set_updated_at, VERIFIED-LIVE: exists,
-- plpgsql, sets new.updated_at = now()). Same wiring as app_settings.
drop trigger if exists channels_set_updated_at on public.channels;
create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

alter table public.channels enable row level security;

-- Grant layer (explicit revoke + minimum, per 20260721193019 convention;
-- service_role untouched). authenticated needs write grants because admin
-- writes flow through the cookie client, gated by the admin RLS policy below.
revoke all on public.channels from anon;
revoke all on public.channels from authenticated;
grant select, insert, update, delete on public.channels to authenticated;

-- Writes + admin reads: admin only (mirrors app_settings_admin_all).
drop policy if exists channels_admin_all on public.channels;
create policy channels_admin_all
  on public.channels for all
  using ((select public.has_role((select auth.uid()), 'admin'::app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::app_role)));

-- Read: any signed-in user may read the non-sensitive catalog via the session
-- client (mirrors app_settings_auth_read).
drop policy if exists channels_auth_read on public.channels;
create policy channels_auth_read
  on public.channels for select
  to authenticated
  using (true);

create index if not exists channels_active_sort_idx
  on public.channels (active, sort_order);

-- Seed the current SET. Keys == campaign_channel enum labels (VERIFIED-LIVE).
-- is_built = true: both channels have a live code stack today. on conflict makes
-- the seed idempotent.
insert into public.channels (key, display_name, is_built, active, sort_order) values
  ('whatsapp', 'וואטסאפ',              true, true, 1),
  ('call',     'שיחת AI (Voximplant)', true, true, 2)
on conflict (key) do nothing;
