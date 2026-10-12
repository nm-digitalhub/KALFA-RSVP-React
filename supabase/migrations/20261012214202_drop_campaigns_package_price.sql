-- personal-coupons task 8.3 (D8 phase 3): drop the legacy price mirror.
--
-- campaigns.package_price was the pre-rounds price column. Since 20261012021203 the
-- campaign_pricing round IS the price; the column was only a trigger-maintained MIRROR
-- for readers that had not moved yet. All readers moved (task 4.1, deployed); verified
-- before this drop (13.10.2026):
--   * 8.1 equality query on live: 0 of 8 campaigns differ between the column and the
--     current round (verification-8-1.md);
--   * repo: no reader of campaigns.package_price (every match is campaign_pricing's
--     own column of the same name, or comments);
--   * pg_catalog: exactly two objects write the OLD column — the mirror and the
--     insert backstop below. bind/release/supersede/create/change and
--     payment_operations_open_guard touch only campaign_pricing.package_price and stay.
--     (create_package_campaign and change_campaign_package keep a stale COMMENT line
--     mentioning the mirror; the behavior is unchanged.)
--
-- ROLLBACK: re-add the column and re-create campaign_pricing_mirror and
-- campaigns_pricing_insert_backstop from 20261012021203, then backfill:
--   update campaigns c set package_price = p.package_price
--   from campaign_pricing p where p.campaign_id = c.id and p.superseded_at is null;

drop trigger if exists campaign_pricing_mirror on public.campaign_pricing;
drop function if exists public.campaign_pricing_mirror();
drop trigger if exists campaigns_pricing_insert_backstop on public.campaigns;
drop function if exists public.campaigns_pricing_insert_backstop();

alter table public.campaigns drop column if exists package_price;
