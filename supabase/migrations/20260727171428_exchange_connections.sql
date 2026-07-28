-- =====================================================================
-- exchange_connections — IONOS Hosted Exchange (EWS) calendar credentials.
--
-- Stage 1 of plans/exchange-ews-stage1.md: connection test, mailbox info,
-- calendar listing, test-appointment create/delete. NOT covered here:
-- send-mail, message sync, any UI beyond the "connect Exchange" screen.
--
-- CLOSED-TABLE PATTERN (precedent: 20260721200551_console_agent_secrets.sql).
-- This table holds an encrypted mailbox credential. RLS is enabled with ZERO
-- policies and every grant to anon/authenticated is revoked — there is no
-- browser-reachable path to this table at all, not even SELECT for the owning
-- user. Access is service-role only, from server-only DAL code
-- (src/lib/data/exchange-connections.ts), matching the existing DAL for
-- console_agent_secrets (src/lib/data/console-agent-provisioning.ts). The
-- credential is not a hash — EWS/NTLM needs the original password — so unlike
-- console_agent_secrets it is not stored plaintext but AES-256-GCM encrypted
-- (src/lib/exchange-ews/crypto.ts), with the ciphertext/iv/auth-tag kept in
-- separate columns per plan §4.
--
-- OWNERSHIP MODEL. `user_id` always records who connected the mailbox.
-- `org_id` is populated only for a shared org-wide connection (owner decision
-- 27.07, plan §3.1) — the schema supports BOTH per_user and per_org from day
-- one; app_settings.exchange_connection_mode (below) controls which mode new
-- connections are created under and which UI path is active. Switching modes
-- does NOT delete or disconnect existing connections.
--
-- SSRF NOTE (plan §5.1): there is deliberately NO ews_endpoint_url column.
-- The EWS endpoint is a hardcoded allowlisted constant in ews-impl.ts — no
-- user-controlled input ever selects where the server connects.
--
-- ROLLBACK: drop view if exists public.exchange_connections_status;
--           drop trigger if exists exchange_connections_set_updated_at
--             on public.exchange_connections;
--           drop table if exists public.exchange_connections;
--           alter table public.app_settings drop column if exists
--             exchange_connection_mode;
--   Safe — no FK depends on this table; nothing on the money/outreach path
--   references it.
-- =====================================================================

create table if not exists public.exchange_connections (
  id         uuid primary key default gen_random_uuid(),
  -- Always: who connected this mailbox. NOT nulled when org_id is set — the
  -- connecting user stays attributable even for a shared org connection.
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Populated only for a shared, org-wide connection (per_org mode). NULL in
  -- the Stage-1 default (per_user) mode.
  org_id     uuid references public.organizations(id) on delete cascade,

  mailbox_email text not null check (btrim(mailbox_email) <> ''),
  auth_method   text not null default 'ntlm' check (auth_method in ('ntlm', 'basic')),

  -- AES-256-GCM output (src/lib/exchange-ews/crypto.ts). Three separate
  -- columns rather than one packed blob so a corrupted/truncated tag or iv is
  -- visibly distinct from a corrupted ciphertext during troubleshooting.
  credential_ciphertext text not null check (btrim(credential_ciphertext) <> ''),
  credential_iv         text not null check (btrim(credential_iv) <> ''),      -- 12B, base64, unique per encryption
  credential_auth_tag   text not null check (btrim(credential_auth_tag) <> ''), -- 16B GCM tag, base64
  encryption_key_version smallint not null default 1,

  status          text not null default 'pending'
                     check (status in ('pending', 'verified', 'failed', 'revoked')),
  last_verified_at timestamptz,
  last_error       text, -- filtered/summarized message ONLY — never a raw SOAP/library error (plan §5.4)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exchange_connections_mailbox_per_user unique (user_id, mailbox_email)
);

comment on table public.exchange_connections is
  'IONOS Hosted Exchange (EWS) calendar connection credentials, AES-256-GCM encrypted. Closed table: RLS enabled with no policies, all grants revoked from anon/authenticated — service-role (server-only DAL) access only. See plans/exchange-ews-stage1.md.';

drop trigger if exists exchange_connections_set_updated_at on public.exchange_connections;
create trigger exchange_connections_set_updated_at
  before update on public.exchange_connections
  for each row execute function public.set_updated_at();

alter table public.exchange_connections enable row level security;

-- No policy is created ON PURPOSE. RLS enabled + zero policies denies every
-- row to every role that isn't the table owner / doesn't bypass RLS
-- (service_role). Combined with the REVOKE below, this is deny-all even
-- before RLS is evaluated — belt and braces, exactly console_agent_secrets.
revoke all on public.exchange_connections from anon;
revoke all on public.exchange_connections from authenticated;

create index if not exists exchange_connections_org_id_idx
  on public.exchange_connections (org_id)
  where org_id is not null;

-- Thin status view for future display surfaces — deliberately excludes every
-- encryption column. security_invoker = true (NOT the plan sketch's
-- provisional `off`): with invoker-security the view enforces RLS/grants of
-- the CALLING role rather than the view owner's, so even if the view is ever
-- granted to a wider role by mistake, the underlying table's zero-policy
-- deny-all still applies to that caller. The grants below keep it revoked
-- from anon/authenticated too, matching the base table — Stage 1's DAL reads
-- this table exclusively via the service-role client
-- (src/lib/data/exchange-connections.ts), so nothing today requires opening
-- this view to the session client. Widening it later is a one-line GRANT.
create or replace view public.exchange_connections_status
  with (security_invoker = true) as
  select id, user_id, org_id, mailbox_email, status, last_verified_at
  from public.exchange_connections;

revoke all on public.exchange_connections_status from anon;
revoke all on public.exchange_connections_status from authenticated;

-- ---------------------------------------------------------------------
-- app_settings.exchange_connection_mode — ownership-model switch (plan §3.1)
-- ---------------------------------------------------------------------
-- Admin-controlled, not hardcoded. Existing app_settings RLS policies
-- (app_settings_admin_all / app_settings_auth_read) already cover this new
-- column — policies are row-scoped, not column-scoped, so no new policy is
-- needed here. Switching modes does not touch existing exchange_connections
-- rows; it only decides which mode NEW connections are created under and
-- which UI path (/app/settings) is active.
alter table public.app_settings
  add column if not exists exchange_connection_mode text not null default 'per_user'
    check (exchange_connection_mode in ('per_user', 'per_org'));

comment on column public.app_settings.exchange_connection_mode is
  'Exchange (EWS) calendar ownership model: per_user (default, Stage-1 live state) or per_org shared connection. See plans/exchange-ews-stage1.md §3.1.';
