-- Integration connections: the end of a connection's life.
--
-- Everything up to now could CREATE a connection and REFRESH it. Nothing could
-- end one. Measured against the live database before writing this:
--
--   service_role UPDATE  expires_at, last_error, last_refresh_at, metadata,
--                        refresh_lease_id, refresh_lease_until, status,
--                        updated_at, vault_secret_id
--   service_role DELETE  (none)
--   label                INSERT/SELECT only — not updatable
--
-- So `status` could already be moved, but a connection could never be renamed
-- and never removed, and the Vault secret behind a connection nobody wanted had
-- no way out of the vault at all.
--
-- This migration adds the three operations that close that gap, and deliberately
-- keeps them apart, because they are not the same decision:
--
--   disconnect  status -> 'revoked' AND the secret is destroyed. The row stays.
--   rename      label only. Cosmetic, reversible, touches nothing else.
--   delete      the row is gone. Refused while anything still points at it.

-- ---------------------------------------------------------------------
-- 1. Renaming needs a grant that does not exist yet
-- ---------------------------------------------------------------------
--
-- Narrow on purpose: `label` and nothing else. The columns absent from this
-- grant — provider, credential_kind, scopes, created_by, vault_secret_id, id —
-- are what a connection IS, and none of them may be edited after the fact.

grant update (label) on public.integration_connections to service_role;

-- ---------------------------------------------------------------------
-- 2. Disconnect
-- ---------------------------------------------------------------------
--
-- ⚠️ THE SECRET IS DESTROYED, NOT ORPHANED. Setting `status = 'revoked'` alone
-- would leave a usable access/refresh token sitting in Vault forever, reachable
-- by anything that can still read the row. The whole point of disconnecting is
-- that the token stops existing on our side.
--
-- ⚠️ AND THE ROW STAYS. A hard delete here would be wrong twice over:
-- `workflow_runs` is an audit record of what an automation did, and an armed
-- workflow holds this uuid in its diagram. Deleting would leave a dead uuid the
-- editor reports as "the selected connection is no longer available" — which is
-- the right message, but only because the row survived to be recognised.
--
-- Idempotent: disconnecting an already-revoked connection returns false rather
-- than raising, so a double click is not an error.

create or replace function public.integrations_disconnect_credential(
  p_connection_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_found     boolean;
begin
  -- ⚠️ THE OLD SECRET ID IS CAPTURED IN A CTE, NOT BY `RETURNING`.
  --
  -- `update ... set vault_secret_id = null returning vault_secret_id` returns
  -- the NEW value — null — because plain RETURNING reports the row as updated.
  -- The secret would then never be destroyed and the whole point of this
  -- function would be silently lost: the row would read 'revoked' while a
  -- working refresh token stayed in the vault. (`RETURNING OLD.` would say it
  -- directly, but that is PostgreSQL 18; this database is 17.6 — measured.)
  --
  -- So `target` snapshots the id under `for update` first, and the UPDATE
  -- returns the CTE's copy. One statement, so two callers cannot both claim the
  -- same secret: the row lock makes the second see `status = 'revoked'` and
  -- match nothing.
  with target as (
    select id, vault_secret_id
      from public.integration_connections
     where id = p_connection_id
       and status <> 'revoked'
     for update
  ), updated as (
    update public.integration_connections c
       set status              = 'revoked',
           vault_secret_id     = null,
           refresh_lease_id    = null,
           refresh_lease_until = null,
           last_error          = null
      from target t
     where c.id = t.id
    returning t.vault_secret_id as old_secret
  )
  select old_secret into v_secret_id from updated;

  get diagnostics v_found = row_count;
  if not v_found then
    return false;
  end if;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Rename
-- ---------------------------------------------------------------------
--
-- A label is what a person reads in the node picker. Since the OAuth callback
-- started writing `preferred_username` into it, the default is already the
-- connected address — so this exists for the cases the provider cannot name:
-- two mailboxes on one address, or a tenant that returns no identity at all.
--
-- ⚠️ TRIMMED AND LENGTH-CAPPED HERE rather than in the caller. The column is
-- `not null` with no check, so an empty string is a legal value that renders as
-- an invisible row in a dropdown — a connection that exists and cannot be
-- picked. 200 characters is well past any real address and short of anything
-- that would break the layout.

create or replace function public.integrations_rename_credential(
  p_connection_id uuid,
  p_label         text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_label text := btrim(coalesce(p_label, ''));
  v_found boolean;
begin
  if v_label = '' then
    raise exception using errcode = '22023', message = 'connection label may not be empty';
  end if;
  if length(v_label) > 200 then
    raise exception using errcode = '22023', message = 'connection label is too long';
  end if;

  update public.integration_connections
     set label = v_label
   where id = p_connection_id;

  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Delete
-- ---------------------------------------------------------------------
--
-- ⚠️ SEPARATE FROM DISCONNECT, AND IT REFUSES MORE THAN IT ACCEPTS.
--
-- There is no foreign key from `workflows` to this table — a node holds the
-- uuid inside `definition` jsonb, which the database cannot enforce. So the
-- check has to be written out, and it is the only thing standing between a
-- delete and an armed automation that fails at run time with a uuid pointing at
-- nothing.
--
-- Two refusals:
--   • still active        — disconnect first, so the token is destroyed in the
--                           one place that knows how
--   • referenced anywhere — by ANY workflow, armed or not. A draft that names
--                           this connection is a draft someone is still writing.
--
-- `jsonb_path_exists` searches every node's properties without the query having
-- to know the diagram's shape, so a new node type that stores a connectionId
-- is covered on the day it is added rather than the day someone remembers.

create or replace function public.integrations_delete_credential(
  p_connection_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_uses   integer;
  v_found  boolean;
begin
  select status into v_status
    from public.integration_connections
   where id = p_connection_id;

  if v_status is null then
    return false;              -- already gone; not an error
  end if;

  if v_status = 'active' then
    raise exception using
      errcode = '22023',
      message = 'disconnect the connection before deleting it';
  end if;

  select count(*) into v_uses
    from public.workflows w
   where jsonb_path_exists(
           w.definition,
           '$.nodes[*].data.properties.connectionId ? (@ == $id)',
           jsonb_build_object('id', p_connection_id::text)
         );

  if v_uses > 0 then
    raise exception using
      errcode = '23503',
      message = format('connection is still referenced by %s workflow(s)', v_uses);
  end if;

  delete from public.integration_connections where id = p_connection_id;
  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

-- Deleting needs the privilege the table never granted.
grant delete on public.integration_connections to service_role;

-- ---------------------------------------------------------------------
-- 5. RPC execution boundary
-- ---------------------------------------------------------------------
--
-- ⚠️ REVOKE FROM `public` EXPLICITLY. A newly created function carries EXECUTE
-- for PUBLIC, and revoking from `anon` and `authenticated` alone leaves that
-- grant in place — the role inherits it from PUBLIC, so the connection ends up
-- reachable by exactly the roles the revoke was written to exclude.

revoke execute on function public.integrations_disconnect_credential(uuid)
  from public, anon, authenticated;
revoke execute on function public.integrations_rename_credential(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.integrations_delete_credential(uuid)
  from public, anon, authenticated;

grant execute on function public.integrations_disconnect_credential(uuid)
  to service_role;
grant execute on function public.integrations_rename_credential(uuid, text)
  to service_role;
grant execute on function public.integrations_delete_credential(uuid)
  to service_role;

comment on function public.integrations_disconnect_credential(uuid) is
  'Ends a connection: status -> revoked and the Vault secret is destroyed. The row survives because workflows and run history reference it by uuid.';
comment on function public.integrations_rename_credential(uuid, text) is
  'Changes only the human-readable label. Trimmed, non-empty, max 200 chars.';
comment on function public.integrations_delete_credential(uuid) is
  'Removes a non-active, unreferenced connection. Refuses while any workflow definition still names it.';
