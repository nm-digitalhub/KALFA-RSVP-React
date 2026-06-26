-- Self-DKIM-signing for outgoing SMTP mail. IONOS only DKIM-signs NATIVE
-- Exchange mail, not basic-auth SMTP submission (our nodemailer path), so we
-- sign ourselves: nodemailer signs with the private key, and the matching public
-- key is published at <selector>._domainkey.<domain> in DNS. Private key is a
-- secret (server-only, app_settings). Aligns with the From domain → DMARC pass.
alter table public.app_settings
  add column if not exists dkim_domain      text,
  add column if not exists dkim_selector    text,
  add column if not exists dkim_private_key text;
