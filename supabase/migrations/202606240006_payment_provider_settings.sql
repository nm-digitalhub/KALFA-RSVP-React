-- Move SUMIT clearing config into admin-managed storage (industry-standard:
-- gateway keys are edited via the admin UI, not via redeploys). The secret API
-- key is stored here too.
alter table public.app_settings
  add column if not exists sumit_company_id     text,
  add column if not exists sumit_api_public_key text,
  add column if not exists sumit_api_key        text;

-- SECURITY: the table now holds a secret (sumit_api_key). Revoke the
-- authenticated read policy added in _0005 — from here on EVERY read is
-- server-side via the service role (createAdminClient) or an admin session
-- under app_settings_admin_all. The secret therefore never reaches the browser:
-- the admin UI shows only "configured ✓", and the customer pay page receives
-- only the non-secret company id + public key as props.
drop policy if exists app_settings_auth_read on public.app_settings;
