-- HISTORICAL BASE MIGRATION #4 — mirrors a production DATA change made through the admin screen. Written
-- 12.10.2026 (the drift-repair procedure). Version 20261011201550 sorts one tick before
-- 20261011201551_drop_old_pricing_terms_columns, whose fail-closed check requires that no package still carries a
-- per-reached term.
--
-- WHY: the June/July seed migrations created the packages WITH the old pay-per-result terms. On production the
-- owner cleared those values through the admin packages screen well before 11.10.2026 (measured zeros recorded in
-- openspec/changes/retire-sumit-campaign-columns/comparison-5-1.md). No migration performed that clearing, so a
-- from-scratch replay still carries the seeded terms and 201551's check refuses. This file performs exactly that
-- clearing, at the point in history before the drop.
--
-- On production it is a no-op by WHERE (every value already cleared) and is recorded with
--   supabase migration repair 20261011201550 --status applied
-- like its sibling base files.

update public.packages
   set price_per_reached = null,
       base_price        = 0,
       included_reached  = 0,
       min_hold_floor    = 0,
       hold_buffer_pct   = 0
 where price_per_reached is not null
    or coalesce(base_price, 0) <> 0
    or coalesce(included_reached, 0) <> 0
    or min_hold_floor <> 0
    or hold_buffer_pct <> 0;
