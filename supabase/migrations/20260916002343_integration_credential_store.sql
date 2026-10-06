-- =====================================================================
-- Integration credential store — generic OAuth2 / API-key infrastructure.
--
-- Design: docs/superpowers/specs/2026-09-16-integration-credential-store-design.md
--
-- NOTHING HERE IS PROVIDER-SPECIFIC, AND THAT IS THE POINT. `provider` is
-- free text, not an enum; `metadata` is jsonb this layer never reads inside.
-- Adding a second provider must be a registry entry in application code, never
-- another migration. A column named after a vendor would be a design failure.
--
-- CLOSED-TABLE PATTERN (precedent: 20260727171428_exchange_connections.sql,
-- itself following 20260721200551_console_agent_secrets.sql). RLS is enabled
-- with ZERO policies and every default grant to anon/authenticated is revoked.
-- Both matter and neither is redundant: `public.guests` carries
-- `anon=adDxtm authenticated=arwdDxtm` purely from Supabase's default
-- privileges, and RLS does not remove a GRANT. Measured 2026-09-16.
--
-- SECRET MATERIAL IS NOT IN THESE TABLES. Tokens live in `vault.secrets`;
-- `vault_secret_id` is the only link, and a uuid is worthless without the
-- vault privilege that anon and authenticated do not hold.
--
-- WHY THE ACCESSOR FUNCTIONS ARE `SECURITY INVOKER`. A definer function runs
-- as its OWNER, and every one of the 60 definer functions in `public` is owned
-- by `postgres` — so inside one, `current_user` is always 'postgres' and a
-- guard written as `current_user <> 'postgres'` can never fire. Measured in a
-- rolled-back transaction: outside a definer function `current_user` reads
-- `service_role`, inside it reads `postgres`. Invoker inverts that: the vault
-- ACL becomes a real second lock, measured as service_role ALLOWED /
-- authenticated DENIED 42501. Supabase says the same thing more plainly —
-- "Never create [a security definer function] in a schema listed under
-- 'Exposed schemas'" — and `public` is exposed here.
--
-- GRANTS ARE DERIVED, NOT ASSUMED. Every privilege below traces to a statement
-- the accessor, the OAuth callback or the cleanup job actually runs. Anything
-- without an operation behind it is not granted — hence no DELETE on
-- `integration_connections`, because disconnect is a soft revoke.
--
-- ROLLBACK:
--   drop function if exists public.integrations_read_credential(uuid, text, text);
--   drop function if exists public.integrations_write_credential(text, text, text, text[], jsonb, text, timestamptz);
--   drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
--   drop table if exists public.integration_oauth_states;
--   drop table if exists public.integration_connections;
--   Safe — no FK points at either table and nothing on the money, outreach or
--   RSVP path references them. Vault secrets created through the write
--   function are NOT removed by this rollback; delete them by name prefix
--   ('conn:') if the feature is abandoned rather than re-applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Connections — metadata only.
-- ---------------------------------------------------------------------
create table if not exists public.integration_connections (
  id                uuid primary key default gen_random_uuid(),

  -- Free identifier. Deliberately NOT an enum and NOT constrained to a list:
  -- a new provider is a registry entry in application code, and a check
  -- constraint here would make every addition a migration.
  provider          text        not null,

  -- What kind of material the vault secret holds. Also free text, for the
  -- same reason — 'oauth2' and 'api_key' are simply the first two.
  credential_kind   text        not null,

  label             text        not null,
  status            text        not null default 'pending',
  scopes            text[]      not null default '{}',

  -- The ONLY link to secret material. Null once a connection is revoked.
  vault_secret_id   uuid,

  expires_at        timestamptz,
  last_refresh_at   timestamptz,
  last_error        text,

  -- Adapter-defined and opaque to this layer. Whatever one provider needs and
  -- another does not lives here instead of becoming a column.
  metadata          jsonb       not null default '{}'::jsonb,

  created_by        uuid        references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint integration_connections_status_check
    check (status in ('pending', 'active', 'expired', 'revoked', 'failed'))
);

-- The accessor resolves a connection by provider + status, never by id from a
-- caller, so that is the index that exists.
create index if not exists integration_connections_provider_status_idx
  on public.integration_connections (provider, status);

drop trigger if exists integration_connections_set_updated_at
  on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2. OAuth authorization states — temporary PKCE material.
-- ---------------------------------------------------------------------
create table if not exists public.integration_oauth_states (
  id                uuid primary key default gen_random_uuid(),

  -- sha256 of the state sent to the provider. The raw value is never stored,
  -- so a leak of this table yields nothing replayable.
  state_hash        text        not null unique,

  provider          text        not null,

  -- PKCE proof. Sensitive but short-lived: it belongs here with a TTL rather
  -- than in Vault, which is for material that outlives a single request.
  code_verifier     text        not null,

  redirect_to       text        not null,
  requested_scopes  text[]      not null default '{}',

  created_by        uuid        not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz
);

-- Drives the cleanup job's range delete.
create index if not exists integration_oauth_states_expires_at_idx
  on public.integration_oauth_states (expires_at);

-- ---------------------------------------------------------------------
-- 3. Closed-table lockdown.
-- ---------------------------------------------------------------------
alter table public.integration_connections   enable row level security;
alter table public.integration_oauth_states  enable row level security;

-- Zero policies, deliberately. Under service_role RLS is bypassed, so a policy
-- would be decoration; under any other role the grant below is already gone.
-- RLS stays enabled because a table in an exposed schema must have it, and as
-- the backstop if a grant is ever restored by accident.

revoke all on public.integration_connections  from anon, authenticated;
revoke all on public.integration_oauth_states from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Grants, one per operation that exists.
-- ---------------------------------------------------------------------

-- connections: the callback inserts, the accessor reads and records refreshes,
-- disconnect marks revoked. No DELETE — disconnect is a soft revoke, so no
-- code path removes a row.
grant select, insert on public.integration_connections to service_role;

-- Column-level on purpose. Everything omitted — provider, credential_kind,
-- scopes, created_by, created_at — is immutable after insert, enforced by the
-- grant rather than by convention. A connection cannot silently become a
-- connection to something else.
grant update (status, vault_secret_id, expires_at, last_refresh_at,
              last_error, metadata, updated_at)
  on public.integration_connections to service_role;

-- oauth states: startConnection inserts, the callback consumes, the cleanup
-- job deletes. SELECT is required and is not optional — PostgreSQL requires
-- SELECT "on any column whose values are read in the expressions or
-- condition", and separately states that "use of the RETURNING clause requires
-- SELECT privilege on all columns mentioned in RETURNING". The consumption CAS
-- reads several columns in its WHERE and returns several more.
grant select, insert, delete on public.integration_oauth_states to service_role;

-- Consuming is the only update that exists. code_verifier and expires_at are
-- therefore un-rewritable after insert: a bug that tried to extend a state's
-- life or swap its verifier fails here instead of succeeding quietly.
grant update (consumed_at) on public.integration_oauth_states to service_role;

-- ---------------------------------------------------------------------
-- 5. Accessor functions — the only route from application code to Vault.
-- ---------------------------------------------------------------------

-- Read. Returns NULL rather than raising when the connection does not match,
-- so a guessed id is indistinguishable from a wrong provider.
create or replace function public.integrations_read_credential(
  p_connection_id      uuid,
  p_expected_provider  text,
  p_expected_kind      text
)
returns text
language plpgsql
security invoker              -- see the header: definer would defeat its own guard
stable
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_secret    text;
begin
  select c.vault_secret_id
    into v_secret_id
    from public.integration_connections c
   where c.id = p_connection_id
     and c.provider = p_expected_provider
     and c.credential_kind = p_expected_kind
     and c.status = 'active';

  if v_secret_id is null then
    return null;
  end if;

  select s.decrypted_secret
    into v_secret
    from vault.decrypted_secrets s
   where s.id = v_secret_id;

  return v_secret;
end;
$$;

-- Write. One transaction: the vault secret and the row land together or
-- neither does, so there is no orphan to sweep. PostgREST runs each RPC in its
-- own transaction, which is what makes that true without explicit BEGIN.
create or replace function public.integrations_write_credential(
  p_provider         text,
  p_credential_kind  text,
  p_label            text,
  p_scopes           text[],
  p_metadata         jsonb,
  p_secret           text,
  p_expires_at       timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection_id uuid := gen_random_uuid();
  v_secret_id     uuid;
begin
  -- Named by connection id, which the unique partial index on
  -- vault.secrets.name then makes singular for free.
  v_secret_id := vault.create_secret(
    p_secret,
    'conn:' || v_connection_id::text,
    'integration credential — ' || p_provider,
    null
  );

  insert into public.integration_connections
    (id, provider, credential_kind, label, status, scopes,
     vault_secret_id, expires_at, metadata, created_by)
  values
    (v_connection_id, p_provider, p_credential_kind, p_label, 'active', p_scopes,
     v_secret_id, p_expires_at, coalesce(p_metadata, '{}'::jsonb), auth.uid());

  return v_connection_id;
end;
$$;

-- Revoking EXECUTE from PUBLIC is not covered by revoking it from anon:
-- PUBLIC holds a default EXECUTE on every new function, and anon inherits it
-- separately. Both are required.
revoke execute on function public.integrations_read_credential(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.integrations_write_credential(text, text, text, text[], jsonb, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.integrations_read_credential(uuid, text, text)
  to service_role;
grant execute on function public.integrations_write_credential(text, text, text, text[], jsonb, text, timestamptz)
  to service_role;

comment on table public.integration_connections is
  'Generic integration connection metadata. Secret material lives in vault.secrets; this table holds only the uuid. Server-only: RLS enabled, zero policies, no grants to anon/authenticated.';
comment on table public.integration_oauth_states is
  'Single-use OAuth authorization states. Stores sha256(state), never the raw value. Consumed by an atomic UPDATE ... RETURNING; expired rows are swept by a scheduled job.';
