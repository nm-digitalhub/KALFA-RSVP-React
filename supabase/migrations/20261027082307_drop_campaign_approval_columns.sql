-- Drop campaigns.tos_version, approved_at and approved_by. The approval is recorded in full in
-- public.signed_agreements; since 20261027075844 no function writes these columns and no code reads them.
--
-- ROLLBACK (schema): alter table public.campaigns add column tos_version text,
--   add column approved_at timestamptz, add column approved_by uuid;
-- The values can be restored from signed_agreements (agreement_version, signed_at, signer_user_id).

alter table public.campaigns
  drop column tos_version,
  drop column approved_at,
  drop column approved_by;
