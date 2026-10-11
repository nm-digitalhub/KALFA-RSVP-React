-- Drop app_settings.call_consent_required — it now lives in call_compliance_settings.
--
-- The contract step of the split made by 20261011130827_call_compliance_settings.sql (owner decision 11.10.2026;
-- openspec/changes/dnc-registry-dial-gate, task 2b.4). Checked before this migration (11.10.2026, after the deploy of
-- the code that reads the new table):
--   * no code in src/, worker/ or scripts/ reads app_settings.call_consent_required;
--   * no function or view in the public schema references it;
--   * both columns hold the same value (false).
--
-- ROLLBACK:
--   alter table public.app_settings add column call_consent_required boolean not null default true;
--   update public.app_settings set call_consent_required = (select call_consent_required from public.call_compliance_settings);

alter table public.app_settings drop column call_consent_required;
