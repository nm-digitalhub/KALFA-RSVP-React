-- Closed by default: objects created from now on in `public` are NOT reachable by `anon` or
-- `authenticated` until a migration grants access explicitly.
--
-- WHY. On this (existing) Supabase project the default ACL of the migration role gives every new table
-- `arwdDxtm` (insert, select, update, delete, truncate, references, trigger, maintain) for `anon`,
-- `authenticated` and `service_role`, every new sequence `rwU`, and every new function `EXECUTE`.
-- Only RLS then stands between an anonymous visitor and a new table; one forgotten
-- `enable row level security` or one over-wide policy exposes it. Measured on the live catalog,
-- 13.10.2026: `anon` holds a privilege on 48 of 125 public tables, a write privilege on 35.
-- Supabase documents this exact fix ("Securing your API > Revoke default privileges") and is moving the
-- platform default to opt-in; existing projects apply it themselves.
--
-- SCOPE. Only objects created by `postgres` (it owns all 125 tables; migrations run as it).
-- `service_role` is deliberately NOT revoked: it bypasses RLS but not grants, so revoking it (as the
-- guide's snippet does) would lock the server out of every new table, and every past migration relies
-- on the default. Existing objects are not touched here (see the next migration for `anon`).
--
-- CONVENTION FROM NOW ON. A migration that creates a table, sequence or function states its grants:
--   grant select, insert, update, delete on table public.<t> to authenticated;   -- only what is used
--   grant execute on function public.<f>(...) to authenticated;                  -- only if called by users
-- A table created without a grant is unreachable by client roles (loud 42501), not open.
--
-- FUNCTIONS NEED THE GLOBAL FORM. Measured on a local copy: `... in schema public revoke execute on
-- functions from public` (the form in the Supabase guide) does NOT remove PUBLIC's built-in EXECUTE on a
-- new function — a schema-level default can only add to the global default — so a function created
-- afterwards stayed callable by `anon` and `authenticated` (ACL `=X/postgres`). Only the statement without
-- `in schema` removes it (new function ACL becomes `{postgres=X, service_role=X}`). PostgreSQL's own
-- ALTER DEFAULT PRIVILEGES page says the same: "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON
-- FUNCTIONS FROM PUBLIC; This command has no effect ... per-schema default privileges can only add
-- privileges to the global setting, not remove privileges granted by it" (the Supabase "Database
-- functions" guide shows that per-schema form). The global form applies to functions created by
-- `postgres` in any schema; functions of extensions are created by `supabase_admin`
-- and keep their ACL (checked by creating `ltree` in a rolled-back transaction).
--
-- ROLLBACK (restores the exact prior default ACL):
--   alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
--   alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
--   alter default privileges for role postgres grant execute on functions to public;
-- Prior ACL: tables arwdDxtm, sequences rwU, functions X, each for postgres, anon, authenticated, service_role.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

alter default privileges for role postgres
  revoke execute on functions from public;
