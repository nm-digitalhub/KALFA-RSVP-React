-- Minimal evidence-based CHECK constraints for the packages operational
-- fields (plan: plans/admin-packages-operational-fields-plan.md §6, option B).
--
-- price_per_reached: NULL is a VALID state (non-campaign package, §1.6/§2#1);
-- a non-null value must be strictly positive — prepareCampaignHold
-- (campaigns.ts) hard-throws on price <= 0, and listCampaignTemplates filters
-- only IS NOT NULL, so a 0-priced package would pass template selection and
-- crash only at the J5 hold. If free campaigns are ever allowed, this CHECK,
-- the prepareCampaignHold guard, and the listCampaignTemplates filter must
-- all change together (§6).
--
-- No upper bound on hold_buffer_pct (no business evidence for a ceiling,
-- §2#3). No JSON-shape constraint on outreach_schedule (campaign_channel[]
-- already enforces the enum for channels at the DB level).
--
-- Preflight (§6, run 2026-07-02 on the live DB): 0 violating rows,
-- 0 pre-existing CHECK constraints on packages.
alter table public.packages
  add constraint packages_price_per_reached_positive
    check (price_per_reached is null or price_per_reached > 0),
  add constraint packages_min_hold_floor_nonnegative
    check (min_hold_floor >= 0),
  add constraint packages_hold_buffer_pct_nonnegative
    check (hold_buffer_pct >= 0);
