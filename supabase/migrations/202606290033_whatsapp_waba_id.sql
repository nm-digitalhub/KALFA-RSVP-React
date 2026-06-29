-- WhatsApp Business Account ID (WABA_ID) on the app_settings singleton.
--
-- The WABA is the node that message-template CRUD targets
-- (POST/GET /{WABA_ID}/message_templates). The existing WhatsApp config only
-- stored the phone-number-id (the SEND node) — there was no place to record the
-- WABA, so template submission/management had nothing to address. This adds it
-- alongside the rest of the Cloud API config so the admin manages it in one
-- place (/admin/channels).
--
-- NOT a secret (an account identifier, not a credential) — stored as plain text,
-- read server-side. Additive + idempotent; nullable (unset until the admin fills
-- it in). Mirrors the whatsapp_* columns added in 202606290028_billing_backhalf.
alter table public.app_settings
  add column if not exists whatsapp_waba_id text;
