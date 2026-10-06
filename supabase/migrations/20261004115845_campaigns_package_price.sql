-- Fixed package price agreed at signing, snapshotted on the campaign exactly as price and terms are
-- (docs/superpowers/plans/2026-10-04-package-payment-plan.md, Task 2). NULL = a pay-per-result campaign, i.e. every
-- campaign today. When set, the campaign has no settlement and the close-charge formula must never run on it.
--
-- NOT base_price: base_price feeds the old base + overage formula, and storing a package price there would make the
-- old close-charge bill it again.
--
-- Nothing writes this column yet (createCampaign changes in plan P-F), so the guards that read it are dormant.
-- campaigns has a SELECT-only policy for customers, so an owner cannot set their own price.
--
-- ROLLBACK: alter table public.campaigns drop constraint campaigns_package_price_nonneg;
--           alter table public.campaigns drop column package_price;

-- Same type as packages.price_with_vat (numeric(10,2), measured live 2026-10-04): the value is copied from it.
alter table public.campaigns
  add column if not exists package_price numeric(10, 2);

alter table public.campaigns
  add constraint campaigns_package_price_nonneg
  check (package_price is null or package_price >= 0);

comment on column public.campaigns.package_price is
  'Fixed package price agreed at signing (copied from packages.price_with_vat at creation). NULL = pay-per-result campaign. When set, close-charge refuses the campaign: its money is in the payment ledger.';
