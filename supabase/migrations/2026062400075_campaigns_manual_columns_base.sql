-- HISTORICAL BASE MIGRATION #2 — the five dashboard-era campaigns columns. Written 12.10.2026 (the drift-repair
-- procedure; sibling of 20260713143940_drift_base_tables.sql). The version 2026062400075 deliberately sorts BETWEEN
-- 202606240007 (which runs `create table if not exists public.campaigns (id, event_id)` — a no-op on production,
-- where the table already existed from the 21–22.06 dashboard era) and 202606240008.
--
-- MEASURED (12.10.2026): a full masked-column scan across all live tables created with `if not exists` found exactly
-- these five — campaigns attnums 3–7, declared by no migration and added by none: the original manual table's
-- columns, hidden by 0007's `if not exists`. First replay blocker: console_campaigns (20260720025656) selects
-- c.enabled. Definitions below are the live ones; no migration ever altered any of the five, so live = historical.
-- Confirmed independently: the 19.07.2026 types snapshot (git 677e4d91) already carries `enabled: boolean`.
--
-- ⚠️ NEVER RUN ON PRODUCTION — recorded there as applied only:
--   supabase migration repair 2026062400075 --status applied
-- (`if not exists` keeps even an accidental run harmless.)

alter table public.campaigns
  add column if not exists steps      jsonb       not null default '[]'::jsonb,
  add column if not exists close_at   timestamptz,
  add column if not exists enabled    boolean     not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
