-- Agreement-document configuration tokens (the numeric/textual legal parameters
-- that get injected into the signed agreement template — e.g. service-activation
-- window, offer validity, charge window, hold-release period, liability cap, and
-- data/record retention periods). Admin-managed via a dedicated /admin screen;
-- the agreement reads these live, exactly like the §14ג company/legal config
-- (see 202606240017_company_legal_config.sql). NOT secret — they are disclosed
-- inside the agreement itself.
--
-- These are free TEXT (not integers): values may be Hebrew phrases ("14 ימים",
-- a cap amount, etc.), and storing them as text keeps the agreement free of any
-- hardcoded business facts — the wording lives in admin DB config, not in code.
--
-- Nullable + default '' (deliberately NOT `not null`): empty = "unset". This
-- tolerates both writer styles the admin form may use (`value || null` like
-- updateCompanySettings, OR `value || ''`) — the data layer coalesces
-- null/undefined → '' on read either way (src/lib/data/agreement-config.ts).
-- Additive + idempotent; touches no existing data.
--
-- Token-key ↔ column mapping (the contract the template + admin form rely on;
-- see getAgreementConfigTokens in src/lib/data/agreement-config.ts):
--   serviceActivationWindow → agr_service_activation_window
--   offerValidityDays       → agr_offer_validity_days
--   chargeWindowDays        → agr_charge_window_days
--   holdReleaseDays         → agr_hold_release_days
--   liabilityCap            → agr_liability_cap
--   retentionDays           → agr_retention_days
--   recordRetentionMonths   → agr_record_retention_months
--
-- ⚠️ NOT YET APPLIED. beta is linked to the LIVE Supabase project — apply only
-- with explicit approval, then regenerate src/lib/supabase/types.ts.
alter table public.app_settings
  add column if not exists agr_service_activation_window text default '',
  add column if not exists agr_offer_validity_days       text default '',
  add column if not exists agr_charge_window_days         text default '',
  add column if not exists agr_hold_release_days          text default '',
  add column if not exists agr_liability_cap              text default '',
  add column if not exists agr_retention_days             text default '',
  add column if not exists agr_record_retention_months    text default '';
