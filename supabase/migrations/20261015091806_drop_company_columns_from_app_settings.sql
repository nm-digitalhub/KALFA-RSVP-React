-- Contract step of the company_profile move (expand: 20261013224338_create_company_profile).
--
-- The nine company columns on app_settings are superseded by public.company_profile, the single
-- source of truth. Verified against the linked project on 15.10.2026, before this file was written:
--   * company_profile holds exactly one row and no app_settings value is missing from it
--     (EXCEPT comparison over all nine columns returned 0 rows);
--   * pg_catalog: no function body, view, policy or pg_depend entry references any of the nine
--     columns of app_settings; the only constraints/trigger on app_settings concern other columns;
--   * repo: the application readers/writers (getCompanyLegal, getCompanySettings,
--     updateCompanySettings, relocation step G1) read company_profile.
--
-- APPLY ONLY AFTER:
--   1. the code that reads company_profile is deployed (until then the running app still
--      reads these columns from app_settings and would fail);
--   2. (done, same deploy) src/lib/relocation/wiring-helpers.ts resolveCertEmail() reads
--      company_contact_email from company_profile; it used to query app_settings and would have
--      silently fallen back to admin@<apex> once the column was gone.
--
-- ROLLBACK: re-add the columns (all nullable text) and copy the values back:
--   alter table public.app_settings
--     add column company_legal_name text, add column company_legal_id text,
--     add column company_legal_address text, add column company_contact_phone text,
--     add column company_contact_email text, add column privacy_url text,
--     add column terms_url text, add column warranty_text text,
--     add column company_instagram_url text;
--   update public.app_settings s set
--     company_legal_name = p.company_legal_name, company_legal_id = p.company_legal_id,
--     company_legal_address = p.company_legal_address, company_contact_phone = p.company_contact_phone,
--     company_contact_email = p.company_contact_email, privacy_url = p.privacy_url,
--     terms_url = p.terms_url, warranty_text = p.warranty_text,
--     company_instagram_url = p.company_instagram_url
--   from public.company_profile p where s.id = true and p.id = true;

do $$
begin
  if (select count(*) from public.company_profile where id = true) <> 1 then
    raise exception 'company_profile must hold its single row before the app_settings columns are dropped';
  end if;
end;
$$;

alter table public.app_settings
  drop column if exists company_legal_name,
  drop column if exists company_legal_id,
  drop column if exists company_legal_address,
  drop column if exists company_contact_phone,
  drop column if exists company_contact_email,
  drop column if exists privacy_url,
  drop column if exists terms_url,
  drop column if exists warranty_text,
  drop column if exists company_instagram_url;
