-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the switches and hold settings of the pay-per-result model on app_settings — campaign_holds_enabled,
-- base_overage_pricing_enabled, close_charge_enabled, reasonable_coverage_contacts, extreme_threshold_contacts,
-- agr_charge_window_days, agr_hold_release_days.
--
-- HISTORY: their last values (true, true, true, 300, 400, "30", "14") are recorded in comparison-5-1.md. No code
-- reads them since tasks 2.3 and 2.4.
--
-- ROLLBACK: re-add campaign_holds_enabled, base_overage_pricing_enabled, close_charge_enabled boolean not null default
-- false; reasonable_coverage_contacts integer not null default 300; extreme_threshold_contacts integer not null default
-- 400; agr_charge_window_days, agr_hold_release_days text default ''.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(campaign_holds_enabled|base_overage_pricing_enabled|close_charge_enabled|reasonable_coverage_contacts|extreme_threshold_contacts|agr_charge_window_days|agr_hold_release_days)\M';
  if v_readers <> 0 then
    raise exception 'retired switches: % function(s) still read a column', v_readers;
  end if;
end $$;

alter table public.app_settings
  drop column campaign_holds_enabled,
  drop column base_overage_pricing_enabled,
  drop column close_charge_enabled,
  drop column reasonable_coverage_contacts,
  drop column extreme_threshold_contacts,
  drop column agr_charge_window_days,
  drop column agr_hold_release_days;
