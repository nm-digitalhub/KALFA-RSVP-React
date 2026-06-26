-- SMS provider config (ExtrA / exm.co.il) for OTP identity verification at
-- agreement signing. Secrets live in app_settings (admin-managed, server-only,
-- like SUMIT) — never NEXT_PUBLIC, never logged.
alter table public.app_settings
  add column if not exists sms_enabled       boolean not null default false,
  add column if not exists extra_sms_token   text,
  add column if not exists extra_sms_sender  text;

-- One-time-password challenges. Server-managed only (created + verified via the
-- service-role client); no client read/write. The code itself is NEVER stored —
-- only a SHA-256 hash. Short-lived + attempt-limited + rate-limited.
create table if not exists public.otp_challenges (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                 -- E.164
  purpose     text not null,                 -- e.g. 'agreement_signing'
  code_hash   text not null,                 -- sha256(code + phone)
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists otp_challenges_lookup_idx
  on public.otp_challenges (phone, purpose, created_at desc);

alter table public.otp_challenges enable row level security;
-- admin-only; the server uses the service-role client (RLS-exempt).
drop policy if exists otp_challenges_admin_all on public.otp_challenges;
create policy otp_challenges_admin_all on public.otp_challenges for all
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
