-- Drop the two dashboard-era vestigial campaigns columns (the original manual table, 21–22.06.2026;
-- declared retroactively by base migration 2026062400075):
--   steps   jsonb   — the original in-campaign send plan; superseded by the package's outreach_schedule
--                     snapshot and the send scheduler.
--   enabled boolean — the original on/off switch; superseded by campaigns.status.
--
-- Verified before the drop (12.10.2026, live):
--   * data: 0 of 7 campaigns hold a non-default value in either column;
--   * pg_catalog: no view, index, constraint, policy, trigger or function depends on either column —
--     console_campaigns.enabled is DERIVED from status since 20260721123456 and reads neither;
--   * code: no reader in src/, worker/, scripts/, supabase/functions/ or voxfiles/.
--
-- Rollback (no data to restore — both columns were at their defaults on every row):
--   alter table public.campaigns
--     add column steps   jsonb   not null default '[]'::jsonb,
--     add column enabled boolean not null default false;

alter table public.campaigns
  drop column if exists steps,
  drop column if exists enabled;
