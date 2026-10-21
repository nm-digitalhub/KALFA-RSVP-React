# Proposal

## Why

Production carries two pg_tle extensions that no migration in this repository creates and no application
code uses (security audit, 21.10.2026, read-only on the live catalog):

- `supabase-dbdev` 0.0.5 in `public`: the database.dev package manager. Its `dbdev.install(text, text,
  text)` fetches SQL over HTTP and installs it through `pgtle.install_extension`. It is not reachable by
  clients today (`anon`/`authenticated` have no `USAGE` on schema `dbdev`, and no `EXECUTE` on
  `pgtle.install_*`; only `postgres` is in `pgtle_admin`), but it keeps a path open for any full-rights
  session (SQL editor, migration role) to load network-fetched code into the database that holds guest
  data — the pattern `staff-tables-permission-rls` (design D9) rejects.
- `olirice-asciiplot` 0.0.1 in `public` ("A Toy ASCII Plotting Library"): `scatter_internal` and
  `scatter_sfunc` are exposed as `/rpc/scatter_internal` and `/rpc/scatter_sfunc` and executable by `anon`
  and `authenticated`. Pure computation, bounded by `anon`'s 3 s statement timeout, but an unauthenticated
  surface with no purpose.

Both are schema drift: a database rebuilt from `supabase/migrations` (the local `beta` stack) has neither,
and `src/lib/supabase/types.generated.ts` carries the `scatter_*` RPC types only because production has
them. `supabase db advisors --linked` reports both as `extension_in_public`.

`cem-uuidv7` (the UUIDv7 generator behind five tables' `id` defaults) was installed on production through
database.dev on 24.09.2026, but depends only on `pg_tle` (`pg_depend`), and replays register it without
dbdev (`20261004105956_cem_uuidv7_tle_base.sql`). It must stay untouched.

## What Changes

- Remove `olirice-asciiplot` and `supabase-dbdev`, and unregister their pg_tle packages, in a migration
  that is a no-op where they do not exist (local replays).
- As a fast hardening option before removal (owner's choice): revoke `EXECUTE` on the two `scatter_*`
  functions from `anon`, `authenticated` and `PUBLIC`, and `EXECUTE` on `dbdev.install` from `PUBLIC`.
- Regenerate `types.generated.ts` so the `scatter_*` RPC types disappear.
- Prove `cem-uuidv7` and the five UUIDv7 defaults keep working before and after.

## Capabilities

### New Capabilities
- `database-extension-hygiene`: the extensions present in the database are the ones the repository's
  migrations declare, none is installed in `public`, and none exposes an unauthenticated RPC.

### Modified Capabilities
<!-- none -->

## Impact

- **Database (one future migration, local first):** `drop extension` × 2, `pgtle.uninstall_extension` × 2;
  no table, column or data change.
- **Code:** `src/lib/supabase/types.generated.ts` (regenerated); no application code references either
  extension (repository search, 21.10.2026).
- **Risk:** low; the dependency check and the UUIDv7 smoke test gate the migration.
- Out of scope: `pg_tle` itself, `cem-uuidv7`, the `http`/`pg_net` extensions' default grants.
