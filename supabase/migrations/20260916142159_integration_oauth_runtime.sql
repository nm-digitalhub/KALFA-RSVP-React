-- =====================================================================
-- Integration OAuth runtime primitives
--
-- Adds the database operations required by the OAuth runtime:
--
--   1. Read an enabled provider OAuth client secret from Vault.
--   2. Create/update provider configuration and rotate its Vault secret.
--   3. Replace an existing connection credential after successful refresh.
--   4. Permit the dedicated refresh path to read an expired OAuth credential.
--
-- SECURITY MODEL
--
-- All functions are SECURITY INVOKER deliberately.
--
-- Application callers use service_role. EXECUTE is revoked from PUBLIC,
-- anon and authenticated and granted explicitly to service_role.
--
-- Decrypted Vault material is never exposed through ordinary table reads.
--
-- PROVIDER ENABLEMENT SEMANTICS
--
-- integrations_read_provider_secret deliberately distinguishes:
--
--   provider row missing        -> NULL
--   provider configured/disabled -> raises integration_provider_disabled
--   provider enabled/no secret  -> NULL
--   provider enabled/has secret -> decrypted secret
--
-- This distinction matters because disabling a provider does NOT invalidate
-- an access token that is already usable, but it DOES refuse authorization,
-- callback completion that requires platform credentials, and refresh.
--
-- REFRESH RECOVERY SEMANTICS
--
-- integrations_replace_credential may recover:
--
--   active
--   expired
--   failed
--   requires_reauthorization
--
-- back to active after a refresh has ACTUALLY succeeded.
--
-- It never accepts pending or revoked.
--
-- The application must still refuse to START a refresh when the provider
-- configuration is disabled. This RPC only persists an already-successful
-- token exchange.
--
-- Vault compatibility notes:
--
-- * `new_key_id` is passed as NULL because the parameter is VESTIGIAL, not
--   because a non-null value would be legacy. Measured in pg_proc on
--   2026-09-16: neither vault.create_secret nor vault.update_secret references
--   `new_key_id` in its body -- the row is inserted without it and encryption
--   hardcodes `key_id := 0`.
--
--   Supabase documents Vault as independent of the deprecated pgsodium
--   extension. NULL is retained here only to match the published function
--   signature; the runtime does not assign semantics to this parameter.
--
-- * vault.update_secret is always called with the secret name and description
--   spelled out. The installed implementation does:
--
--       name = coalesce(new_name, s.name)
--
--   measured from pg_proc on 2026-09-16, so NULL currently preserves the
--   existing value. Supabase does not document those NULL semantics, however,
--   so this migration does not rely on them.
--
--   For connection credentials the explicit values reproduce exactly what
--   integrations_write_credential created:
--
--       conn:<connection_id>
--       integration credential — <provider>
--
--   Therefore this is a no-op for credentials created by the integration
--   subsystem. If a future migration points vault_secret_id at a differently
--   named Vault secret, refresh will NORMALIZE that name deliberately: the
--   deterministic name is an invariant, not merely an observed property.
--
-- * vault.secrets.name carries the measured partial unique index:
--
--       CREATE UNIQUE INDEX secrets_name_idx
--         ON vault.secrets (name)
--         WHERE (name IS NOT NULL)
--
--   Therefore a duplicate oauth_app:<provider> secret cannot coexist: a
--   concurrent second creation would raise 23505 rather than corrupting data.
--
--   The advisory transaction lock in integrations_upsert_provider_config does
--   NOT add an integrity guarantee. Its purpose is only to convert that first-
--   insert 23505 race into deterministic serialization.
--
-- ROLLBACK
--
-- Drop the newly introduced RPCs:
--
--   drop function if exists public.integrations_replace_credential(
--     uuid, text, text, text, timestamptz
--   );
--
--   drop function if exists public.integrations_upsert_provider_config(
--     text, text, jsonb, text, boolean
--   );
--
--   drop function if exists public.integrations_read_provider_secret(text);
--
-- Restore integrations_read_credential to its exact pre-migration contract:
--
--   create or replace function public.integrations_read_credential(
--     p_connection_id      uuid,
--     p_expected_provider  text,
--     p_expected_kind      text
--   )
--   returns text
--   language plpgsql
--   security invoker
--   stable
--   set search_path = ''
--   as $$
--   declare
--     v_secret_id uuid;
--     v_secret    text;
--   begin
--     select c.vault_secret_id
--       into v_secret_id
--       from public.integration_connections c
--      where c.id = p_connection_id
--        and c.provider = p_expected_provider
--        and c.credential_kind = p_expected_kind
--        and c.status = 'active';
--
--     if v_secret_id is null then
--       return null;
--     end if;
--
--     select s.decrypted_secret
--       into v_secret
--       from vault.decrypted_secrets s
--      where s.id = v_secret_id;
--
--     return v_secret;
--   end;
--   $$;
--
--   revoke execute on function public.integrations_read_credential(
--     uuid, text, text
--   ) from public, anon, authenticated;
--
--   grant execute on function public.integrations_read_credential(
--     uuid, text, text
--   ) to service_role;
--
-- This rollback cannot reconstruct previous provider client-secret values or
-- connection token values if these RPCs were already exercised. Those values
-- must be restored from their preceding known-good versions when necessary.
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Read provider OAuth client secret
-- ---------------------------------------------------------------------

create or replace function public.integrations_read_provider_secret(
  p_provider text
)
returns text
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_provider  text := btrim(p_provider);
  v_enabled   boolean;
  v_secret_id uuid;
  v_secret    text;
begin
  if nullif(v_provider, '') is null then
    raise exception using
      errcode = '22023',
      message = 'provider is required';
  end if;

  select c.enabled, c.vault_secret_id
    into v_enabled, v_secret_id
    from public.integration_provider_configs c
   where c.provider = v_provider;

  if not found then
    return null;
  end if;

  if not v_enabled then
    raise exception using
      errcode = 'P0001',
      message = 'integration_provider_disabled';
  end if;

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


-- ---------------------------------------------------------------------
-- 2. Create/update provider configuration and rotate client secret
-- ---------------------------------------------------------------------

create or replace function public.integrations_upsert_provider_config(
  p_provider text,
  p_client_id text,
  p_extra jsonb,
  p_secret text,
  p_enabled boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_provider  text := btrim(p_provider);
  v_client_id text := btrim(p_client_id);
  v_secret_id uuid;
begin
  if nullif(v_provider, '') is null then
    raise exception using
      errcode = '22023',
      message = 'provider is required';
  end if;

  if nullif(v_client_id, '') is null then
    raise exception using
      errcode = '22023',
      message = 'client_id is required';
  end if;

  if p_enabled is null then
    raise exception using
      errcode = '22023',
      message = 'enabled is required';
  end if;

  -- The unique Vault name already guarantees integrity. This lock exists only
  -- to serialize two concurrent FIRST writes for the same provider so the
  -- loser waits instead of surfacing a raw 23505.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'integration_provider_config:' || v_provider,
      0
    )
  );

  select c.vault_secret_id
    into v_secret_id
    from public.integration_provider_configs c
   where c.provider = v_provider
   for update;

  if found then
    -- Blank secret on an existing provider means "keep the current secret".
    if nullif(btrim(coalesce(p_secret, '')), '') is not null then
      if v_secret_id is null then
        v_secret_id := vault.create_secret(
          p_secret,
          'oauth_app:' || v_provider,
          'integration OAuth client secret — ' || v_provider,
          null
        );
      else
        perform vault.update_secret(
          v_secret_id,
          p_secret,
          'oauth_app:' || v_provider,
          'integration OAuth client secret — ' || v_provider
        );
      end if;
    end if;

    update public.integration_provider_configs
       set client_id       = v_client_id,
           vault_secret_id = v_secret_id,
           extra           = coalesce(p_extra, '{}'::jsonb),
           enabled         = p_enabled
     where provider = v_provider;

    return;
  end if;

  -- A newly-created confidential OAuth provider configuration needs initial
  -- secret material. Existing providers may subsequently retain their current
  -- secret by submitting a blank p_secret.
  if nullif(btrim(coalesce(p_secret, '')), '') is null then
    raise exception using
      errcode = '22023',
      message = 'client secret is required for a new provider configuration';
  end if;

  v_secret_id := vault.create_secret(
    p_secret,
    'oauth_app:' || v_provider,
    'integration OAuth client secret — ' || v_provider,
    null
  );

  insert into public.integration_provider_configs (
    provider,
    client_id,
    vault_secret_id,
    extra,
    enabled,
    created_by
  )
  values (
    v_provider,
    v_client_id,
    v_secret_id,
    coalesce(p_extra, '{}'::jsonb),
    p_enabled,
    auth.uid()
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Persist a successfully refreshed connection credential
-- ---------------------------------------------------------------------

create or replace function public.integrations_replace_credential(
  p_connection_id uuid,
  p_expected_provider text,
  p_expected_kind text,
  p_secret text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if nullif(btrim(p_expected_provider), '') is null
     or nullif(btrim(p_expected_kind), '') is null
     or nullif(p_secret, '') is null
     or p_expires_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'connection refresh arguments are incomplete';
  end if;

  select c.vault_secret_id
    into v_secret_id
    from public.integration_connections c
   where c.id = p_connection_id
     and c.provider = p_expected_provider
     and c.credential_kind = p_expected_kind
     and c.status in (
       'active',
       'expired',
       'failed',
       'requires_reauthorization'
     )
   for update;

  if v_secret_id is null then
    return false;
  end if;

  -- Explicit name/description are intentional. Do not depend on the currently
  -- installed update_secret(NULL) preservation semantics.
  perform vault.update_secret(
    v_secret_id,
    p_secret,
    'conn:' || p_connection_id::text,
    'integration credential — ' || p_expected_provider
  );

  -- A token refresh that actually succeeded is authoritative evidence that
  -- the credential is usable again.
  update public.integration_connections
     set status          = 'active',
         expires_at      = p_expires_at,
         last_refresh_at = now(),
         last_error      = null
   where id = p_connection_id;

  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Permit the dedicated refresh path to read an expired credential
-- ---------------------------------------------------------------------

create or replace function public.integrations_read_credential(
  p_connection_id      uuid,
  p_expected_provider  text,
  p_expected_kind      text
)
returns text
language plpgsql
security invoker
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
     and c.status in ('active', 'expired');

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


-- ---------------------------------------------------------------------
-- 5. RPC execution boundary
-- ---------------------------------------------------------------------

revoke execute on function public.integrations_read_provider_secret(text)
  from public, anon, authenticated;

revoke execute on function public.integrations_upsert_provider_config(
  text,
  text,
  jsonb,
  text,
  boolean
)
  from public, anon, authenticated;

revoke execute on function public.integrations_replace_credential(
  uuid,
  text,
  text,
  text,
  timestamptz
)
  from public, anon, authenticated;

revoke execute on function public.integrations_read_credential(
  uuid,
  text,
  text
)
  from public, anon, authenticated;


grant execute on function public.integrations_read_provider_secret(text)
  to service_role;

grant execute on function public.integrations_upsert_provider_config(
  text,
  text,
  jsonb,
  text,
  boolean
)
  to service_role;

grant execute on function public.integrations_replace_credential(
  uuid,
  text,
  text,
  text,
  timestamptz
)
  to service_role;

grant execute on function public.integrations_read_credential(
  uuid,
  text,
  text
)
  to service_role;
