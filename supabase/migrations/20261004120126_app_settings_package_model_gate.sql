-- Package model gate (docs/superpowers/plans/2026-10-04-package-payment-plan.md, D9). One admin-flippable switch that
-- keeps the fixed-price package purchase DARK until the owner turns it on.
--
-- FALSE (default): the purchase route refuses every request, so no campaign can be charged for a package.
-- Turning it on is refused by the admin settings action unless the approved package agreement is the active contract,
-- the same way the pricing toggle is gated. Existing campaigns are unaffected either way.
--
-- ADDITIVE + REVERSIBLE.
-- ROLLBACK: alter table public.app_settings drop column if exists package_model_enabled;
alter table public.app_settings
  add column if not exists package_model_enabled boolean not null default false;

comment on column public.app_settings.package_model_enabled is
  'Gate for the fixed-price package purchase. FALSE (default) = the purchase route refuses every request. Enabling is refused by the admin action unless the approved package agreement is the active contract.';
