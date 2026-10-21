# Tasks

Ground rules: planning only until approved. Production is read-only from this change's side; the owner
runs `db push`. Local commands pass `SUPABASE_DB_PORT=54322` on the command line, never in `.env.local`.

## 1. Evidence (no schema change)

- [ ] 1.1 Re-read the live catalog (read-only): extension list, `pg_depend` for both extensions'
  members, pg_tle registrations, `EXECUTE` grants, OpenAPI `/rpc/scatter_*` presence. Verify: matches
  design Context or the differences are recorded.
- [ ] 1.2 Look for callers: `pg_stat_statements` and Supabase logs for `scatter`, `dbdev.install`;
  repository search. Verify: zero callers recorded with the query used.
- [ ] 1.3 Export the registered package bodies for rollback (read-only `select` of the pg_tle version
  functions). Verify: stored in the migration header draft, sha256 recorded.

## 2. Stop-gap (optional, owner decides)

- [ ] 2.1 Draft `migration new revoke_unused_extension_rpcs`: revoke `EXECUTE` on `scatter_internal`,
  `scatter_sfunc` (and the `scatter` aggregate) from `anon`, `authenticated`, `PUBLIC`; on
  `dbdev.install` from `PUBLIC`; guarded to no-op where absent. Verify: applied locally (no-op); a
  rolled-back transaction on a database that has the extension shows `anon` refused.

## 3. Removal

- [ ] 3.1 `migration new remove_unused_pgtle_extensions` per design D2 (guarded, no `cascade`). Verify:
  applied locally (no-op); in a rolled-back transaction on a database that has both extensions the
  four statements succeed and `cem-uuidv7` is still listed.
- [ ] 3.2 UUIDv7 check: insert-and-rollback into one of the five tables, assert the new `id` is version 7,
  before and after the migration. Verify: both pass.
- [ ] 3.3 Regenerate `src/lib/supabase/types.generated.ts`; `npx tsc --noEmit`. Verify: `scatter_*` gone,
  typecheck green.
- [ ] 3.4 `verification-extensions.md`: inventories before/after (production read-only and local),
  Advisors before/after (`extension_in_public` gone). Verify: document names every finding.

## Workflow follow-up

- After the owner's push, compare the live extension inventory and OpenAPI paths with the expected state,
  read-only, and record it in `verification-extensions.md`.
