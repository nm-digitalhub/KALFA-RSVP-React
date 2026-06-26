-- Identity verification on the signed agreement moves from an ID photo to a
-- phone OTP (Privacy-Authority-preferred). Record the verified phone + the OTP
-- verification time as evidence (alongside the existing ip / user_agent /
-- content_hash). id_document_ref stays for backward-compat but is no longer used.
alter table public.signed_agreements
  add column if not exists verified_phone   text,
  add column if not exists otp_verified_at  timestamptz;

-- KALFA's legal identity is a §14ג mandatory disclosure in the agreement. It is
-- admin-managed config (not hardcoded) — the agreement reads it. Filled via
-- /admin/settings; a lawyer confirms the final wording before go-live.
alter table public.app_settings
  add column if not exists company_legal_name    text,
  add column if not exists company_legal_id      text,
  add column if not exists company_legal_address text;
