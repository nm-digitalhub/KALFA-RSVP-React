-- §B phase 1 — let the schema state the truth, and remove a key nothing signs with.
--
-- This is deliberately NOT the EWS teardown. `ews-impl.ts`, its packages and the
-- EXCHANGE_PROVIDER=ews switch all stay: measured 2026-08-16, Graph has ~10
-- error-free hours (the 15 failures that day were the worker env-order bug,
-- fixed the same day, last at 05:10). The plan's own gate is "several days of
-- proven stability" and ten hours is not that.
--
-- One correction to the risk model that was nearly got wrong: our EWS path
-- targets exchange.ionos.com (ews-impl.ts:87) — IONOS HOSTED Exchange, not
-- Exchange Online. Microsoft's EWS retirement (October 2026 begins, April 2027
-- complete — learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-ews-exchange-online,
-- fetched 2026-08-16) applies to Exchange ONLINE only. It therefore puts no
-- deadline on this rollback path at all; the rollback's lifetime is however long
-- the IONOS account stays active, which is an owner fact, not a Microsoft date.

-- ── 1. app_settings: a private key nothing signs with ────────────────────────
-- MEASURED: no code anywhere reads dkim_domain / dkim_selector /
-- dkim_private_key by name (searched src, scripts, worker; the only hits are in
-- the generated types.ts). Meanwhile the row holds a live 1704-character RSA
-- private key, and `k1._domainkey.kalfa.me` is still published in DNS — so the
-- keypair is real and complete, and nothing in this codebase uses it.
-- `sender.ts:128` states outright that this path does no DKIM signing; outbound
-- mail goes through Resend, whose own SPF (include:amazonses.com on
-- send.kalfa.me) and alignment satisfy the DMARC policy (p=quarantine; adkim=r).
--
-- Four call sites do `select('*')` on app_settings (alerts-config, payments,
-- outreach-config, voximplant-config). All four are `server-only` and field-pick
-- from the result, so the key never reached a client — but it was being loaded
-- into server memory on every config read, for nothing.
--
-- ROLLBACK: none, by design. A retired signing key must never be restored — the
-- correct recovery is a NEW keypair and a replaced DNS record. The public half
-- stays in DNS until the owner removes it; a published public key alone is
-- harmless, and DNS changes are the owner's to make.
alter table public.app_settings
  drop column if exists dkim_private_key,
  drop column if exists dkim_selector,
  drop column if exists dkim_domain;

-- ── 2. exchange_connections: allow a row to be honest ────────────────────────
-- The blocker §B names. `auth_method` was CHECK IN ('ntlm','basic') — neither of
-- which describes how the active backend actually authenticates — and the three
-- credential columns were NOT NULL, so a connection could not exist without a
-- mailbox secret that Graph provably never reads.
--
-- Widened rather than replaced: 'ntlm' and 'basic' remain valid because the EWS
-- path remains available, and the existing row keeps its credential. This
-- changes what the schema PERMITS, not what it currently holds.
alter table public.exchange_connections
  drop constraint if exists exchange_connections_auth_method_check;

alter table public.exchange_connections
  add constraint exchange_connections_auth_method_check
  check (auth_method in ('ntlm', 'basic', 'certificate'));

-- Nullable, so a Graph-era connection need not invent a secret. The CHECKs are
-- rewritten as "absent, or non-empty" — an empty string stays invalid, which is
-- the case that would silently look like a credential and not be one.
alter table public.exchange_connections
  alter column credential_ciphertext drop not null,
  alter column credential_iv drop not null,
  alter column credential_auth_tag drop not null;

alter table public.exchange_connections
  drop constraint if exists exchange_connections_credential_ciphertext_check,
  drop constraint if exists exchange_connections_credential_iv_check,
  drop constraint if exists exchange_connections_credential_auth_tag_check;

alter table public.exchange_connections
  add constraint exchange_connections_credential_ciphertext_check
    check (credential_ciphertext is null or btrim(credential_ciphertext) <> ''),
  add constraint exchange_connections_credential_iv_check
    check (credential_iv is null or btrim(credential_iv) <> ''),
  add constraint exchange_connections_credential_auth_tag_check
    check (credential_auth_tag is null or btrim(credential_auth_tag) <> '');

-- All three or none: a half-present credential cannot be decrypted, and the
-- shape that fails at decrypt time is worse than the shape rejected at write.
alter table public.exchange_connections
  add constraint exchange_connections_credential_all_or_none
  check (
    (credential_ciphertext is null and credential_iv is null and credential_auth_tag is null)
    or (credential_ciphertext is not null and credential_iv is not null and credential_auth_tag is not null)
  );

-- DELIBERATELY NOT DONE: the existing row's credential is NOT cleared, and its
-- auth_method stays 'ntlm'. That credential IS the rollback — EXCHANGE_PROVIDER
-- =ews authenticates to IONOS with it, and NTLM cannot work without it. Clearing
-- it here would remove the rollback while claiming to be a schema change.
-- Retiring it belongs with the teardown, once the owner confirms IONOS is done.
