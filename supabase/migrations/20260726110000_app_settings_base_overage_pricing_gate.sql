-- =====================================================================
-- Base+overage pricing gate (plan S3). One admin-flippable flag that keeps
-- the flat-base + included + overage model DARK until the owner turns it on
-- AFTER the agreement v4 + attorney sign-off.
--
-- FALSE (default): createCampaign snapshots base_price=0 / included_reached=0
-- onto a new campaign ⇒ the S2 close-charge formula reduces to pure
-- per-reached — TODAY'S behaviour, unchanged. Flipping to TRUE activates base
-- charging for NEW campaigns only (existing campaigns keep their snapshot).
--
-- ADDITIVE + REVERSIBLE. Rollback: drop the column. No destructive SQL.
-- Applied via `supabase db push` — USER-RUN, classifier-gated.
-- =====================================================================
alter table public.app_settings
  add column if not exists base_overage_pricing_enabled boolean not null default false;

comment on column public.app_settings.base_overage_pricing_enabled is
  'Gate for the flat-base + included + overage pricing model (plan S3). FALSE (default) = new campaigns snapshot base/included = 0 (pure per-reached, unchanged). Flip to TRUE only after agreement v4 + attorney sign-off — activates base charging for NEW campaigns.';

-- ROLLBACK: alter table public.app_settings drop column if exists base_overage_pricing_enabled;
