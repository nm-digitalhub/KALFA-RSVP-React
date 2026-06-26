-- Route A (J5 card hold): an independent kill-switch for the campaign
-- authorization-hold path, separate from the orders `payments_enabled` switch.
-- Default OFF (fail-closed): nothing places a hold until an admin turns this on
-- AND payments_enabled is on. Additive + idempotent; no existing data changes.
--
-- ⚠️ NOT YET APPLIED. beta is linked to the LIVE Supabase project — apply only
-- with explicit approval, then regenerate src/lib/supabase/types.ts.
alter table public.app_settings
  add column if not exists campaign_holds_enabled boolean not null default false;
