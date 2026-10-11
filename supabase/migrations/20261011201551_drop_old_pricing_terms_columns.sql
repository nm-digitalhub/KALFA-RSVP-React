-- retire-sumit-campaign-columns task 5.2. APPROVED by the owner on 11.10.2026 ("כן, תיצור את המיגרציות" — the seven
-- groups that no code and no database object reads, listed in comparison-5-1.md). One group per migration.
--
-- Supabase runs this file in one transaction and records it only if every statement succeeds, so a failed check below
-- leaves the columns in place.
--
-- GROUP: the pay-per-result terms — campaigns.price_per_reached, base_price, included_reached, max_charge_ceiling; and
-- packages.price_per_reached, base_price, included_reached, min_hold_floor, hold_buffer_pct. Their CHECK constraints
-- (campaigns_base_overage_nonneg, packages_base_overage_nonneg, packages_price_per_reached_positive,
-- packages_min_hold_floor_nonnegative, packages_hold_buffer_pct_nonnegative) go with them.
--
-- HISTORY: these are terms, not payment facts: the ledger has no counterpart. The three campaigns without a package
-- hold ₪4 per reached, base 0 / 200 / 200, included 0 / 200 / 200, ceiling 152 / 200 / 200 — recorded in
-- comparison-5-1.md, and stated in the stored agreement PDFs of the two signed ones. The package campaigns hold 0, a
-- placeholder the earlier createCampaign wrote. Every package holds the package columns empty or 0.
-- try_record_billed_result stopped reading price_per_reached in 20261011190349.
--
-- ROLLBACK: re-add campaigns.price_per_reached numeric, base_price numeric, included_reached integer,
-- max_charge_ceiling numeric (nullable); packages.price_per_reached numeric, base_price numeric, included_reached
-- integer (nullable), min_hold_floor numeric not null default 0, hold_buffer_pct numeric not null default 0; their
-- CHECKs; and the three campaigns' values from comparison-5-1.md.

set local lock_timeout = '5s';

-- Refuse if any function in public still reads one of the columns (views, policies and indexes were measured: none).
do $$
declare v_readers integer;
begin
  select count(*) into v_readers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ '\m(price_per_reached|base_price|included_reached|max_charge_ceiling|min_hold_floor|hold_buffer_pct)\M';
  if v_readers <> 0 then
    raise exception 'old pricing terms: % function(s) still read a column', v_readers;
  end if;
end $$;

-- Refuse if a package still carries a per-reached term (the packages action refuses one since task 1.2).
do $$
declare v_packages integer;
begin
  select count(*) into v_packages
    from public.packages
   where price_per_reached is not null or coalesce(base_price, 0) <> 0 or coalesce(included_reached, 0) <> 0
      or min_hold_floor <> 0 or hold_buffer_pct <> 0;
  if v_packages <> 0 then
    raise exception 'old pricing terms: % package(s) still carry a per-reached term', v_packages;
  end if;
end $$;

alter table public.campaigns
  drop column price_per_reached,
  drop column base_price,
  drop column included_reached,
  drop column max_charge_ceiling;

alter table public.packages
  drop column price_per_reached,
  drop column base_price,
  drop column included_reached,
  drop column min_hold_floor,
  drop column hold_buffer_pct;
