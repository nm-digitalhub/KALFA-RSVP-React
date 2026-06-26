-- Remaining company/legal config for the agreement (§14ג disclosures + privacy
-- + warranty). Admin-managed via a dedicated /admin/company screen; the agreement
-- reads these live. (company_legal_name/id/address were added in _0016.)
alter table public.app_settings
  add column if not exists company_contact_phone text,
  add column if not exists company_contact_email text,
  add column if not exists privacy_url            text,
  add column if not exists terms_url              text,
  add column if not exists warranty_text          text;
