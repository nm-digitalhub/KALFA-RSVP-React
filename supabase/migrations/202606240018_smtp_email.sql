-- SMTP config (IONOS Exchange) for KALFA business emails — first use: emailing
-- the signed agreement PDF to the customer (§14ג(ב) — deliver the contract in
-- writing). Secrets in app_settings (admin-managed, server-only), like SMS/SUMIT.
alter table public.app_settings
  add column if not exists email_enabled  boolean not null default false,
  add column if not exists smtp_host       text,
  add column if not exists smtp_port       integer,
  add column if not exists smtp_secure     boolean not null default false, -- true=465/SSL, false=587/STARTTLS
  add column if not exists smtp_user       text,
  add column if not exists smtp_password   text,
  add column if not exists smtp_from       text; -- e.g. "KALFA <noreply@kalfa.me>"
