-- =====================================================================
-- Make the derived grants on the integration tables actually take effect.
--
-- WHY A SECOND MIGRATION, AND WHY THE FIRST ONE WAS NOT WRONG.
--
-- 20260916002343 revoked the default privileges from `anon` and
-- `authenticated`, then granted `service_role` a narrow, derived set: SELECT +
-- INSERT plus column-level UPDATE. Verified after it was applied, the real ACL
-- read `service_role=arwdDxtm` on both tables — ALL, not the derived set.
--
-- The cause, measured on this project:
--
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--
-- so every new table in `public` arrives with ALL already granted to all four
-- roles. A narrower GRANT is ADDITIVE and cannot take a privilege away, which
-- is why the column-level UPDATE was inert on top of a table-level UPDATE that
-- was already there. The revokes worked precisely because they were REVOKEs.
--
-- ⚠️ THE FIRST MIGRATION MATCHED SUPABASE'S OWN DOCUMENTED PATTERN. Their
-- reference migration for a server-only table (`status_cache.sql`) does exactly
-- what it did: enable RLS, then "revoke all privileges from anon and
-- authenticated — service_role inherently bypasses RLS via the BYPASSRLS
-- attribute, so no explicit policies for service_role are needed". Their
-- custom-schema guide is where the blanket grant comes from in the first place:
-- `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated,
-- service_role`.
--
-- This migration goes BEYOND that pattern deliberately, because
-- `service_role=arwdDxtm` on a credential table means the only control left is
-- the application code that chooses which statement to run. Confirmed here:
-- `rolbypassrls` is true for `service_role` and `postgres`, false for
-- `authenticated` and `anon` — so for the one role that can reach these tables,
-- RLS is not a control at all and the GRANT is the entire control.
--
-- THE RULE THIS LEAVES BEHIND: on this project a closed table needs THREE
-- statements, not two — enable RLS, revoke from every role INCLUDING
-- `service_role`, then grant back only what an operation requires. And check
-- the resulting `relacl`, because a silent ALL looks identical to a correct
-- migration in the diff.
--
-- ROLLBACK: grant all on public.integration_connections  to service_role;
--           grant all on public.integration_oauth_states to service_role;
--   Restores the pre-existing (over-broad) state; nothing depends on the
--   narrow set beyond the tests that assert it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- integration_connections
-- ---------------------------------------------------------------------
revoke all on public.integration_connections from service_role;

-- The callback inserts a connection; the accessor resolves one and records
-- refreshes; the management surface lists them. No DELETE: disconnect is a
-- soft revoke, so no code path removes a row.
grant select, insert on public.integration_connections to service_role;

-- Column-level, so that provider, credential_kind, scopes, created_by and
-- created_at are immutable after insert — enforced by the grant rather than by
-- convention. A connection cannot silently become a connection to something
-- else.
grant update (status, vault_secret_id, expires_at, last_refresh_at,
              last_error, metadata, updated_at)
  on public.integration_connections to service_role;

-- ---------------------------------------------------------------------
-- integration_oauth_states
-- ---------------------------------------------------------------------
revoke all on public.integration_oauth_states from service_role;

-- startConnection inserts; the callback consumes; the cleanup job deletes.
-- SELECT is required and is not optional: PostgreSQL requires SELECT "on any
-- column whose values are read in the expressions or condition", and
-- separately that "use of the RETURNING clause requires SELECT privilege on
-- all columns mentioned in RETURNING". The consumption CAS does both.
grant select, insert, delete on public.integration_oauth_states to service_role;

-- Consuming is the only update that exists, so code_verifier and expires_at
-- are un-rewritable after insert.
grant update (consumed_at) on public.integration_oauth_states to service_role;
