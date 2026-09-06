-- 2026-09-06 — customer-agreement archive export to SharePoint
-- (docs/sharepoint-contracts-archive-plan-2026-09-06.md §6/§9).
--
-- 1. signed_agreements.sharepoint_exported_at / sharepoint_item_id — set by the
--    daily worker sweep (src/lib/data/agreement-archive.ts) once the signed PDF
--    (hash-verified against content_hash) has been uploaded to the
--    Customer-Agreements library and its evidence metadata written. NULL = not
--    yet exported; the sweep selects on the partial index below, oldest first.
-- 2. app_settings.agreement_archive_enabled — the sweep's own kill-switch, off
--    by default, toggled at /admin/settings (owner rule: a switch needs an
--    admin control, not a DB column alone).
--
-- RLS: no policy change. signed_agreements stays admin-only (existing
-- policies); nullable columns inherit. The worker writes with the service-role
-- client. Supabase remains the system of record — this only records that a
-- copy exists in SharePoint; nothing here deletes anything.
--
-- Rollback (manual, in this order):
--   drop index if exists public.signed_agreements_unexported_idx;
--   alter table public.signed_agreements drop column if exists sharepoint_item_id;
--   alter table public.signed_agreements drop column if exists sharepoint_exported_at;
--   alter table public.app_settings drop column if exists agreement_archive_enabled;

alter table public.signed_agreements
  add column if not exists sharepoint_exported_at timestamptz,
  add column if not exists sharepoint_item_id text;

create index if not exists signed_agreements_unexported_idx
  on public.signed_agreements (signed_at)
  where sharepoint_exported_at is null;

alter table public.app_settings
  add column if not exists agreement_archive_enabled boolean not null default false;

comment on column public.signed_agreements.sharepoint_exported_at is
  'When the signed PDF was archived to the SharePoint Customer-Agreements library (hash-verified). NULL = pending export.';
comment on column public.signed_agreements.sharepoint_item_id is
  'Microsoft Graph driveItem id of the archived PDF copy in SharePoint.';
comment on column public.app_settings.agreement_archive_enabled is
  'Kill-switch for the daily SharePoint archive sweep of signed agreements (off by default; /admin/settings).';
