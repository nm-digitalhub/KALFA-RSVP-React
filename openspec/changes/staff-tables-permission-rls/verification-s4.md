# Verification, stage S4: packages

Date: 25.10.2026. Local stack only (`supabase_db_beta`, label `com.supabase.cli.project=beta`, DB 127.0.0.1:54322,
API 127.0.0.1:54321). Production was only read (catalog, Advisors). The sections up to Advisors were written before
the push; the owner's push and the live comparison are in the last section.

## What changed

Migration `supabase/migrations/20261025155204_packages_billing_permission.sql`, created by
`npx supabase migration new packages_billing_permission`, body written by `scripts/gen-staff-table-rls.ts migration`,
`ROLLBACK:` header by hand from the live catalog. Applied locally with `supabase migration up --db-url …127.0.0.1:54322…`
(390 migrations locally).

| | Before (live = local, read 25.10.2026) | After (local) |
|---|---|---|
| `authenticated` | all eight privileges | SELECT, INSERT, UPDATE, DELETE |
| `anon` | SELECT | SELECT |
| policies | `packages_admin_all` (ALL, `is_platform_staff()`); `packages_public_read` (SELECT, anon and authenticated, `active = true`) | `packages_select_permission`, `packages_insert_permission`, `packages_update_permission`, `packages_delete_permission` (each `to authenticated`, `manage_billing`); `packages_public_read` unchanged |

`manage_billing` is the key `PLATFORM_ACTIONS.Package` (src/lib/casl.ts) gives every action; the map takes it from
there (`staffTableOperationKeys`), and no key is typed for `packages`. `service_role` is untouched.

User-session paths, re-checked 25.10.2026: only `src/lib/data/admin/packages.ts` (`listPackages`, `getPackage`, the form
readers, `createPackage`, `updatePackage`, `deletePackage`, each after `requirePlatformAction(<action>, 'Package')`)
reads or writes `packages` with the cookie client. `package-offers.ts`, `agent-benefits.ts`, `admin/offers.ts`,
`admin/coupon-assignments.ts` and `campaigns.ts` (`getCampaignForPurchase`, embedded `packages(name)`) use the service
role. In the catalog (live and local) the functions that name `packages` are `create_staff_coupon_assignment` and
`replace_sales_coupon_assignment`, both `SECURITY DEFINER` and not executable by `authenticated` or `anon`; no view,
policy of another table or publication reads it. (Production also has `dbdev.install` and a `pg_tle` function whose
bodies say "packages"; they are database.dev's packages, not this table.)

Code and docs: the header of `packages.ts` named `packages_admin_all`; it now describes the per-operation policies and
the consistency test. `docs/project/03-database-schema.md` §9 RLS line updated the same way.

## Proof

| Check | Classification | Result |
|---|---|---|
| `supabase/tests/database/s4_packages_test.sql` (generated from the map and `scripts/staff-table-rls-fixtures/s4_packages.json`, 39 assertions; the reads of sessions without the key are left to the next file because the kept public read also applies) | SQL (pgTAP) | before the migration: FAIL 21 of 39, all from today's grants and policy: 9 policy names and shape, 2 privileges (extra grants, MAINTAIN), 3 cases of staff holding no key admitted by the floor, and 7 that follow from its admitted DELETE of the fixture (2 intact checks, 5 holder cases); after: PASS |
| `supabase/tests/database/s4_packages_paths_test.sql` (hand-written, 59 assertions: owner and billing_clerk read, insert, update and delete; ops_engineer, auditor (who holds view_billing), a support_agent stand-in and a customer see the active packages only, not the inactive one, and their createPackage is refused by the policy's check while updatePackage and deletePackage change no row, both rows intact; anon reads the active packages and is refused every write by the grant) | SQL (pgTAP) | before: FAIL 17 of 59, all from the floor: 6 inactive rows seen, 8 writes admitted, 3 that follow (ops_engineer's admitted deletes removed both rows); after: PASS |
| All pgTAP files (`000-harness`, `000-service-role`, S1, S2, S3 and S4 files) | SQL (pgTAP) | Files=8, Tests=816, PASS; fingerprint (extensions, staff and role tables, every `public` policy, packages and events counts) unchanged after the run |
| `src/lib/auth/staff-table-sql-consistency.test.ts` (design D10): reads the migrations as text and the generated pgTAP files' holder cases, and asserts per table and operation that the keys equal `staffTableOperationKeys`. It covers every per-permission table whose stage has landed: `packages` and the five S3 tables | unit (text) | 13 passed. Before the S4 migration existed it failed, `packages` not covered |
| Mutation 1: `Package.read` changed in `PLATFORM_ACTIONS` only (`manage_billing` → `view_billing`), then restored | unit (text) | fails: `packages SELECT: the policy names [manage_billing], the map says [view_billing]` and `packages SELECT: the pgTAP holders are [manage_billing], the map says [view_billing]` |
| Mutation 2: the key of `packages_update_permission` changed in the migration only (`manage_billing` → `manage_settings`), then restored | unit (text) | fails: `packages UPDATE: the policy names [manage_settings], the map says [manage_billing]` |
| `src/lib/auth/permissions.local-it.test.ts` through `scripts/integration/run-local.sh` | PostgREST, real Auth users, DAL, CASL and the Server Action | with S4 applied and before the flip: exactly 5 `packages` cases red (they recorded the old permissive behaviour); flipped in the same change: auditor and ops_engineer `rls-denied` on INSERT and `rls-filtered` on UPDATE, DELETE and the inactive SELECT, billing_clerk unchanged, the DELETE case also asserts the row count; "Server Action refuses, PostgREST allows" is now "both refuse" (the row stays); the public read of an active package is its own case for anon and every user; 17 of 17 |
| The other local-IT files (`console-*`, `permission-signal`, `outreach-schedule`) | integration through TS | 7 files, 99 tests, pass |
| vitest: `admin/packages` (pages, form, actions, copy, rewrite), `admin/offers`, `packages.ts`, `agent-benefits`, `coupon-benefits`, offers and coupon assignments, `src/lib/offers`, `casl.test.ts`, `casl-pilot-static.test.ts`, `src/lib/auth`; the readers of the public catalogue (`public-business-facts`, `campaigns`, the event setup page, the voice-agent pricing route) | unit (mocked) | 779 passed (91 skipped: the local-IT files above) and 143 passed |
| `npm run typecheck`, `npm run lint`, `npm run build` (into `.next-verify`, not the served `.next`) | static | exit 0, exit 0, exit 0 (compiled, 90/90 static pages, no warning) |

Wording of task 5.1: "anon and customer sessions … cannot write (`42501`)". Anon is refused with 42501 (no grant). A
customer's INSERT is refused with 42501 (the policy's `with check`); its UPDATE and DELETE match no row (the `using`
filter) and are asserted with zero rows and the row intact, because `authenticated` holds those grants for the holders
of `manage_billing` (design D3, D9).

Not classified as end-to-end: no browser flow and no live traffic ran against the new policies.

## Advisors

`supabase db advisors --db-url <local> --type all --level info`: 208 findings, as after S3. One finding changed its
text: `multiple_permissive_policies` (WARN) on `packages` for `authenticated` SELECT now lists
`{packages_public_read,packages_select_permission}` instead of `{packages_admin_all,packages_public_read}`. Two
permissive SELECT policies is the intended shape (design D5: the public read stays apart from the staff key). The other
finding naming `packages` is `unindexed_foreign_keys` (INFO), older than this stage.

## Production, after the push (25.10.2026, read-only)

The owner applied the migration with `supabase db push --linked`; its statements run in `postgres_logs` at 16:05:59 UTC.

| Check | Result |
|---|---|
| `supabase migration list --linked` | 390 local, 390 remote, none missing on either side; latest `20261025155204` |
| Privileges, ACL, RLS and policies of `packages` (`has_table_privilege` for authenticated, anon, service_role; `relacl`; `pg_policies` name, command, roles, `using` and `with check` text), live vs local | identical, line for line (the table in "What changed") |
| Data API, anon key, the public read: `HEAD /rest/v1/packages?select=id&active=eq.true` with `Prefer: count=exact` | 3 rows, the same count the service-role key gets |
| Data API, anon key, `active=eq.false` | 0 rows; the service-role key also counts 0, so production has no inactive package and the hiding of one is proved locally only |
| Data API, anon key, `PATCH /rest/v1/packages?id=eq.<an id that does not exist>` | 42501 (no grant); no row could match |
| `postgres_logs` from 15:55 to 16:07 UTC, "permission denied" or "row-level security" | one, 16:06:41: the anon PATCH above; none from the application |
| `edge_logs` in the same window, requests to `packages` | before the push: 5 `GET 200` by `node` at 15:58 (a service-role reader); after: only the probes (`curl`; `edge_logs` holds some of them, not all) |
| `supabase db advisors --linked --type all --level info` | 269 findings, as after S3. One changed its text: `multiple_permissive_policies` (WARN) on `packages` for `authenticated` SELECT now lists `{packages_public_read,packages_select_permission}` instead of `{packages_admin_all,packages_public_read}`; nothing else changed |

Not proved in production: an application request through the new policies. The next visit to `/admin/packages` by a
holder of `manage_billing` is the first live user-session use; every other reader is the service role.
