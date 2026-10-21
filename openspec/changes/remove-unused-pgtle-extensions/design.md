# Design

## Context

See proposal.md - Why. Live catalog, read-only, 21.10.2026:

- `pg_extension`: `supabase-dbdev` 0.0.5 (schema `public`, owner `postgres`), `olirice-asciiplot` 0.0.1
  (`public`, `postgres`), `cem-uuidv7` 1.0.2 (`extensions`), `pg_tle` 1.4.0 (`pgtle`).
- `pg_depend` (extension → extension): all three TLEs depend only on `pg_tle`; nothing depends on
  `supabase-dbdev` or `olirice-asciiplot` (no object outside them references their members).
- Members: dbdev = schema `dbdev` + `dbdev.install(text,text,text)` (SECURITY INVOKER, calls
  `extensions.http` then `pgtle.install_extension`); asciiplot = type `scatter_state`, functions
  `scatter_internal`, `scatter_sfunc`, aggregate `scatter`.
- Reachability: schema `dbdev` has no `USAGE` for `anon`/`authenticated`; `pgtle.install_*` not executable
  by them; `pgtle_admin` = `postgres` only. `scatter_internal`/`scatter_sfunc` are in the PostgREST OpenAPI
  document (`/rpc/scatter_internal`, `/rpc/scatter_sfunc`) with `EXECUTE` for `anon` and `authenticated`.
- `pgtle.available_extension_versions()`: `cem-uuidv7` 1.0.0–1.0.2, `olirice-asciiplot` 0.0.1–0.0.2,
  `supabase-dbdev` 0.0.5.
- UUIDv7 users: `id` defaults of `payment_operations`, `payment_operation_lines`, `rdp_access_events`,
  `rdp_access_grants`, `rdp_access_requests` call `extensions.uuid_generate_v7()` (member of `cem-uuidv7`).
- Migrations: only `20261004105956_cem_uuidv7_tle_base.sql` / `…957` mention the TLEs; neither
  `dbdev` nor `asciiplot` appears in any migration. The local `beta` database has `pg_tle` and
  `cem-uuidv7` only (registered by `…956` directly, without dbdev).
- Repository: no reference outside `types.generated.ts` (`scatter_*` RPC types) and two September audit
  notes under `docs/superpowers/plans/`.

## Goals / Non-Goals

**Goals:** remove both extensions and their pg_tle registrations from production; keep `cem-uuidv7`
byte-identical; leave local replays unchanged (no-op); regenerate types.

**Non-Goals:** removing `pg_tle`; touching `http`/`pg_net` grants (Supabase defaults, separate change);
re-installing anything through database.dev.

## Decisions

**D1 — Remove, not just revoke.** Revoking `EXECUTE` closes the `anon` RPC surface in minutes and is
offered as a stop-gap (task 2.1), but leaves the network installer and the drift. Removal closes both.

**D2 — Order.** In one migration, guarded so every statement is a no-op where the object is absent:
1. `drop extension if exists "olirice-asciiplot";` (no dependents; drops type, functions, aggregate)
2. `drop extension if exists "supabase-dbdev";` (drops schema `dbdev` and `dbdev.install`)
3. `select pgtle.uninstall_extension_if_exists('olirice-asciiplot');`
4. `select pgtle.uninstall_extension_if_exists('supabase-dbdev');`
`cem-uuidv7` is never named. Without `cascade`: an unexpected dependent makes the migration fail instead
of dropping it. Alternative: `cascade` — rejected for that reason.

**D3 — Who runs it.** `pgtle.uninstall_*` needs `pgtle_admin`; the migration role `postgres` holds it on
production (catalog). Locally the guarded statements are no-ops.

**D4 — Drift handling.** After the push, the extension inventory of production equals the one of a
migration-built database; `types.generated.ts` is regenerated in the same commit as the migration.

## Risks / Trade-offs

- [Something outside the catalog calls `scatter` or `dbdev.install` (a dashboard snippet, a manual job)]
  → Supabase logs / `pg_stat_statements` checked for calls before the push (task 1.2); the stop-gap
  revoke first surfaces any caller as an error.
- [Uninstalling a TLE also removes its stored versions] → intended; rollback re-registers from the
  recorded SQL (below).
- [`cem-uuidv7` affected by mistake] → smoke insert + `uuid_extract_version = 7` check before and after
  (task 3.2); D2 never names it.

## Migration Plan

1. Local: write the migration (no-op locally), run it, verify inventories.
2. Stop-gap (optional, owner): the revoke statements of task 2.1, pushed alone.
3. Owner `db push`; live read-only verification (inventory, OpenAPI paths, UUIDv7 check).
Rollback: re-create from the recorded package bodies — before the push, export
`pgtle."olirice-asciiplot--0.0.1.sql"()` / `…0.0.2` and `pgtle."supabase-dbdev--0.0.5.sql"()` (read-only
reads of the live registration) into the migration header, then `pgtle.install_extension(...)` +
`create extension …` restores them exactly.
