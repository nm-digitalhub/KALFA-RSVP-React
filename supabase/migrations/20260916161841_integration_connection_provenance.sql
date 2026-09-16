-- =====================================================================
-- Provenance: who connected this, and who configured that.
--
-- THE BUG THIS FIXES IS SILENT, WHICH IS WHY IT SURVIVED TWO MIGRATIONS.
--
-- `integration_connections.created_by` and `integration_provider_configs.created_by`
-- were both populated from `auth.uid()` inside a SECURITY INVOKER function. That
-- reads a claim off the request's JWT:
--
--   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
--     select coalesce(
--       nullif(current_setting('request.jwt.claim.sub', true), ''),
--       (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
--     )::uuid
--   $fn$
--
-- Every caller of these RPCs is server-side and authenticates with the SERVICE
-- ROLE key, whose JWT carries a role and an issuer and NO `sub` claim. Measured
-- on this project, 2026-09-16:
--
--   request.jwt.claims = '{"role":"service_role","iss":"supabase",...}'
--     → auth.uid() = NULL
--   request.jwt.claims = '{"role":"authenticated","sub":"1111...-5555"}'
--     → auth.uid() = 1111...-5555
--
-- So `created_by` was ALWAYS NULL. Nothing failed, nothing logged, and the
-- column looked like a feature that simply had no data yet.
--
-- WHY IT CANNOT BE FIXED AFTER THE INSERT. `created_by` is deliberately outside
-- the column-level UPDATE grant — it is immutable by design, so that a
-- connection cannot be reattributed later. Measured on the live database:
--
--   integration_connections.created_by        INSERT=true  UPDATE=false
--   integration_provider_configs.created_by   INSERT=true  UPDATE=false
--
-- A follow-up `update ... set created_by = ...` therefore fails with 42501. The
-- actor has to arrive WITH the insert or it is unrecoverable, which is why this
-- is a parameter and not a second statement.
--
-- WHY `auth.uid()` IS REMOVED RATHER THAN KEPT AS A FALLBACK. A
-- `coalesce(p_created_by, auth.uid())` would read as a safety net while being
-- dead code on every path that exists — and dead code that looks like it works
-- is exactly what produced this. The caller knows who the actor is; it says so.
--
-- WHY THE PARAMETER HAS NO DEFAULT. A default would let a call site forget,
-- and forgetting reproduces the bug in a form that is once again invisible.
-- NULL remains a legal VALUE — an automated path with no human behind it says
-- so explicitly — but it must be said.
--
-- The `auth.users` foreign key already validates it: a uuid that is not a real
-- user fails loudly instead of being stored as decorative provenance.
--
-- STILL OPEN, DELIBERATELY NOT DONE HERE: neither table records who last
-- ROTATED a secret. `created_by` is immutable and `updated_at` has no actor
-- beside it. Rotating an OAuth client secret is exactly the act an auditor would
-- want attributed, so an `updated_by` column is a real candidate — but it is a
-- schema question with its own grant and backfill decisions, not a rider on
-- this one.
--
-- ROLLBACK:
--   drop function if exists public.integrations_write_credential(
--     text, text, text, text[], jsonb, text, timestamptz, uuid);
--   drop function if exists public.integrations_upsert_provider_config(
--     text, text, jsonb, text, boolean, uuid);
--   -- then restore the previous forms, which are identical except that they
--   -- take one fewer argument and write `auth.uid()` into `created_by`:
--   --   integrations_write_credential      20260916002343, 7 arguments
--   --   integrations_upsert_provider_config 20260916142159, 5 arguments
--   -- Rows written in the meantime keep whatever actor they were given; nothing
--   -- needs backfilling, because the previous behaviour was NULL anyway.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Connections
-- ---------------------------------------------------------------------

-- Dropped, not replaced: the argument list changes, and `create or replace`
-- would leave the old form behind as an overload — still callable, still
-- writing NULL.
drop function if exists public.integrations_write_credential(
  text, text, text, text[], jsonb, text, timestamptz
);

create or replace function public.integrations_write_credential(
  p_provider         text,
  p_credential_kind  text,
  p_label            text,
  p_scopes           text[],
  p_metadata         jsonb,
  p_secret           text,
  p_expires_at       timestamptz,
  -- The authenticated user who completed the authorization. NULL for an
  -- automated path with no human behind it — said, not defaulted.
  p_created_by       uuid
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
     v_secret_id, p_expires_at, coalesce(p_metadata, '{}'::jsonb), p_created_by);

  return v_connection_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Provider configuration
-- ---------------------------------------------------------------------

drop function if exists public.integrations_upsert_provider_config(
  text, text, jsonb, text, boolean
);

create or replace function public.integrations_upsert_provider_config(
  p_provider   text,
  p_client_id  text,
  p_extra      jsonb,
  p_secret     text,
  p_enabled    boolean,
  -- Set on creation only. `created_by` is immutable, so the rotation path below
  -- deliberately leaves it alone rather than reattributing an existing row.
  p_created_by uuid
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
    p_created_by
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3. RPC execution boundary
-- ---------------------------------------------------------------------

revoke execute on function public.integrations_write_credential(
  text, text, text, text[], jsonb, text, timestamptz, uuid
) from public, anon, authenticated;

revoke execute on function public.integrations_upsert_provider_config(
  text, text, jsonb, text, boolean, uuid
) from public, anon, authenticated;

grant execute on function public.integrations_write_credential(
  text, text, text, text[], jsonb, text, timestamptz, uuid
) to service_role;

grant execute on function public.integrations_upsert_provider_config(
  text, text, jsonb, text, boolean, uuid
) to service_role;
