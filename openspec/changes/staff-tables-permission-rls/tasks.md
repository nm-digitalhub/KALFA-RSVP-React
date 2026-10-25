# Tasks

Ground rules for every group: migrations are created only with `npx supabase migration new <name>`
and applied to the **local** database only (`npx supabase migration up --db-url
"postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"`); the local stack starts
with `SUPABASE_DB_PORT=54322 npx supabase@2.120.0 start` (the `.env.local` value 5432 otherwise wins);
the local port is passed on the command line only and is **never written to `.env.local`** (that file
also feeds the production worker; see design, Risks);
no deploy, no `db push`, no change to the live database; tests are written first and must be red on
the current local database for the stated reason before the migration is written. Each migration
bundles grants and policies and carries a `ROLLBACK:` header with the exact prior grants and policy
text read from the live catalog.

## 0. Closed by default (done first)

- [x] 0.1 Record the baseline: on the live catalog (read-only) snapshot `pg_default_acl` and every
  table's `anon` privileges and every policy naming `anon` or `public`; start only the local database
  (`SUPABASE_DB_PORT=54322 npx supabase@2.120.0 start -x <all other services>`) and snapshot the same.
  Verify: both snapshots are in `verification-default-privileges.md`.
- [x] 0.2 `migration new revoke_default_client_privileges`: `alter default privileges for role
  postgres in schema public` revoke all on tables and sequences from `anon`, `authenticated`, revoke
  execute on functions from `anon`, `authenticated`, `public`; `service_role` untouched; header states
  the exact prior ACL and the rollback. Verify: applied locally; in a rolled-back transaction a new
  table and a new function show no client privilege and `service_role` keeps its usual ones.
- [x] 0.3 `migration new revoke_anon_privileges_existing_tables`: `revoke all` on all tables and
  sequences in `public` from `anon`, then `grant select` on `packages` and `faq_items`; header lists
  the prior `anon` privileges (from the live snapshot) as the rollback source. Verify: applied locally;
  the only tables where `anon` holds any privilege are those two, with `SELECT` only; the active
  packages and published FAQ rows still read as `anon`.
- [x] 0.4 Regression and record: vitest for the code that reads packages and FAQ (public pages, agent
  benefits), the local Advisors, and the verification document with before/after. Verify: green, and
  the document names every finding.

- [x] 0.5 `migration new mirror_live_policy_drift`: record the six live-only or differently scoped policies
  (`packages_public_read`, `Platform owners can manage staff`, and `authenticated` scope for
  `packages_admin_all`, `al_owner_insert`, `own_profile_read`, `own_profile_write`), copied from the live
  catalog, created only when absent. Verify: local and live policy sets identical (121 = 121), a second run
  is a no-op, `anon` reads active packages on a migration-built database.

## 1. Evidence and harness (no schema change)

- [x] 1.1 Resolve the unknowns in the access map: every caller of `readPolicyRow(client)`
  (`src/lib/callbacks/policy-config.ts`), every use of the 25 tables in `scripts/**` and `worker/**`,
  and the current `anon`/`authenticated` grants of `voice_purposes` and `voice_purpose_attempts`.
  Update the table in `design.md`. Verify: no "mixed" or "to confirm" cell remains, and each resolved
  row cites the file or catalog query that settled it.
- [x] 1.2 Add `src/lib/auth/staff-table-permissions.ts` (table → key list, group A/B) and a vitest that
  asserts it equals the module pins of `admin-data-layer-coverage.test.ts` for every Group B table
  and lists exactly the 25 tables. Its keys come from the existing shared list
  `PLATFORM_PERMISSION_KEYS` (`src/lib/auth/platform-permission-keys.generated.ts`, generated from
  `platform_permission_definitions`, checked by `npm run check:permissions:generated`; design D10);
  no key is typed again and no second list is created.

  Verify: `npx vitest run src/lib/auth` passes; changing one key in the map makes it fail naming the
  table; a key absent from `PLATFORM_PERMISSION_KEYS` fails the type check. This task stays open
  until the map is implemented and its tests pass.

  Tables whose module already decides through CASL (`packages` today; design D10): the map takes each
  operation's key from `PLATFORM_ACTIONS` (`src/lib/casl.ts`), never as a typed literal, and the test
  pairs the operations `read`/`SELECT`, `create`/`INSERT`, `update`/`UPDATE`, `delete`/`DELETE`.
  `PLATFORM_ACTIONS` stays the only source of the key for every `Package` action. Verify, in addition:
  changing one `Package` action's key in `PLATFORM_ACTIONS` only, or one `packages` operation in the
  map only, fails the test with a message naming the table and the operation (proved with a mutation,
  then restored); the public read of active packages is listed apart from the `Package` actions. No
  CASL subject, action or module is added by this task.

  **Done 25.10.2026.** `STAFF_TABLE_PERMISSIONS` lists the 25 tables (11 `closed`, 14 `permission`), typed by
  `keyof Database['public']['Tables']` and `PlatformPermissionKey`; `packages` names actions of `Package`, resolved
  through `PLATFORM_ACTIONS` by `staffTableOperationKeys`. The check is a `describe` in
  `admin-data-layer-coverage.test.ts`, so it reads `EXPECTED_PERMISSION` itself; three modules that reach a table with
  the staff session were pinned there (`src/lib/data/message-templates.ts`, `src/lib/callbacks/policy-config-admin.ts`,
  `src/app/(admin)/admin/callbacks/policy/actions.ts`, all `manage_settings`). Evidence: `npx vitest run src/lib/auth
  src/lib/casl.test.ts "src/app/(admin)/admin/packages"` 481 passed; `casl-pilot-static` 43 passed; `tsc --noEmit` 0;
  eslint 0. Mutations, each restored:
  - `ops_alerts` key changed in the map only: fails, `ops_alerts: RLS keys in staff-table-permissions.ts differ from
    the data-layer pins`.
  - a key absent from the catalogue (`manage_setting`): `tsc` TS2820.
  - `packages` `SELECT` paired with `update` in the map only: fails, `packages SELECT must pair with the 'read' action`.
  - `Package.read` changed in `PLATFORM_ACTIONS` only: fails in `casl.test.ts` and `platform-ability.test.ts`, **not**
    with the table and operation. It cannot here: the map takes the key from `PLATFORM_ACTIONS`, so both sides move
    together; only the SQL policy is an independent side. **Moved to 5.1** (owner decision 25.10.2026); not claimed as
    passing until proved there.
- [x] 1.5 Shared template, not one hand-written solution per table (owner decision 25.10.2026; design D13). Add a
  generator that reads `STAFF_TABLE_PERMISSIONS` and, for a list of tables, renders (a) the migration body: for a
  `closed` table `revoke all … from anon, authenticated` and `drop policy` for each existing staff policy; for a
  `permission` table `revoke all`, `grant <exact ops> … to authenticated` and one policy per operation keyed as in the
  map; and (b) the pgTAP cases of design D9 families (a) to (c) for the same tables. The output is written into the file
  that `npx supabase migration new <name>` created, never into a hand-created migration file. Exceptions stay
  hand-written and are listed in the generator: the public reads (`packages_public_read`, `faq_items_public_read`,
  `channels_auth_read`), the `upsert_provider_number` and `fleet_*` RPC cases, the service-role paths of
  `voice_purpose_attempts`, and each `ROLLBACK:` header (prior grants and policy text from the live catalog). Verify: a
  vitest renders the 11 closed and the 14 per-permission tables and asserts each output names exactly the keys and
  operations of the map; changing one operation in the map changes exactly that policy and its test case.

  **Done 25.10.2026 (tool and its tests only; nothing applied, no migration or test file created).**
  - `src/lib/auth/staff-table-rls.ts`: `renderMigrationBody` (closed: `revoke all` and `drop policy` for each existing
    policy; per permission: `revoke all`, `grant <ops>`, one policy per operation `to authenticated` with
    `(select public.has_platform_permission(...))`, UPDATE with both `using` and `with check`), `renderPgTapTests`
    (inventory: `policies_are`, `policy_cmd_is`, `policy_roles_are`, `table_privs_are` for both client roles, no
    `MAINTAIN`; behaviour: no-grant operations refused with `42501` for every actor, the owner included; holders allowed
    with `results_eq … returning`; non-holders `42501` on INSERT, `is_empty` plus an intact-row read on UPDATE/DELETE,
    `is_empty` on SELECT; each actor's keys checked with `has_platform_permission`), the exception lists
    (`KEEP_POLICIES`, `ANON_SELECT`, `HAND_WRITTEN`), and the file writers (marked block in a migration; a test file only
    over itself or the untouched `supabase test new` template).
  - Behaviour cases are computed from the map, never from the migration text, so a fault in the SQL template is caught
    by statements run as real roles (owner decision: independent behaviour tests).
  - Guards from the Supabase RLS guide: an UPDATE or DELETE key that cannot SELECT is refused; policy names over 63
    bytes are refused; `drop policy` without `if exists`, so catalog drift fails loudly.
  - `scripts/gen-staff-table-rls.ts`: reads policy names and one column per table from the LOCAL container only
    (`supabase_db_beta`, label checked), writes into a file the CLI created, `--dry-run` prints. Dry run on
    `webhook_inbox,packages,channels` read the local catalog and printed the expected body; no file was written.
  - Evidence: `src/lib/auth/staff-table-rls.test.ts` 62 passed; `tsc --noEmit` 0; eslint 0. Mutations, each restored:
    INSERT rendered with `using` (4 tables fail); every signed-in actor treated as a holder (2 fail); the read-covers-write
    guard removed (1 fails).
  - **Not yet proved:** the rendered SQL and pgTAP have not run on Postgres. First run: task 1.3 (harness) and 2.1,
    on the local stack. The generated actors create a temporary `platform_roles` row with `rank = 0`; whether a
    constraint refuses it is known only then.
- [x] 1.3 Spike the runner: start the local stack, make sure `pgtap` is available, add
  `supabase/tests/database/000-harness.test.sql` (always-green plan plus a fixture that creates a staff
  user in a chosen role and in a temporary role holding exactly one permission, all inside the
  rolled-back transaction). Verify: `npx supabase@2.120.0 test db` reports PASS; the exact command,
  prerequisites and any gotcha are written into `design.md` and, if new, into a memory note.

  **Done 25.10.2026.** `supabase/tests/database/000-harness_test.sql` (created by `npx supabase test new
  database/000-harness`): `pass`, a staff member on the seeded `billing_clerk` role, one on a temporary role holding only
  `manage_voice` (the generated actors' statements, `rank = 0` accepted), a signed-in non-staff user, anon; 9 assertions.
  `SUPABASE_DB_PORT=54322 npx supabase test db --local supabase/tests/database/000-harness_test.sql`: `Result: PASS`,
  Tests=9, with CLI 2.122.0 and with `supabase@2.120.0`; the local fingerprint unchanged after each run. Command,
  prerequisites and gotchas: design, "Running the pgTAP suite". No memory note: the facts are specific to this change.
  Found while validating 1.5 on Postgres: a refusal must assert its message, not only `42501`; the template now does.
- [x] 1.4 Add the service-role guard test (`000-service-role.test.sql`): as `service_role`, select from
  every one of the 25 tables. Verify: PASS now (baseline) and it stays PASS after every stage.

  **Baseline done 25.10.2026.** `supabase/tests/database/000-service-role_test.sql`, created by `npx supabase test new
  database/000-service-role` and written by `scripts/gen-staff-table-rls.ts service-role` (`renderServiceRoleGuard`):
  per table, `lives_ok` on a read as `service_role` and `ok` on SELECT, INSERT, UPDATE and DELETE, one
  `has_table_privilege` call each; 50 assertions. `SUPABASE_DB_PORT=54322 npx supabase test db --local
  supabase/tests/database`: `Result: PASS`, Files=2, Tests=59; local fingerprint unchanged. Mutations inside the
  rolled-back transaction: `revoke select … otp_challenges from service_role` fails 2 cases; `revoke delete … packages`
  fails 1. The first version passed `'SELECT,INSERT,UPDATE,DELETE'` to one `has_table_privilege` call, which answers
  whether ANY is held, and the delete mutation stayed green; fixed and tested. "Stays PASS after every stage" is checked
  in each stage's verify step.

Stages S1 to S5 split the verification into groups and each produces one migration (design D11). They do not mean
rewriting a solution per table: the SQL and the pgTAP cases of every stage come from the 1.5 template, applied to that
stage's tables; only the exceptions listed in 1.5 are written by hand, and the database tests of a stage run together.

## 2. Stage S1 — close the critical service-only tables

- [x] 2.1 Write `supabase/tests/database/s1_closed_critical.test.sql` for `otp_challenges`,
  `agreement_documents`, `webhook_inbox`: inventory (`policies_are` = none; no privilege for `anon` or
  `authenticated`) and behaviour (owner, ops_engineer, billing_clerk, auditor, support_agent, non-staff
  authenticated and anon each refused every operation with `throws_ok('42501')`). Verify: red on the
  current local database because the grants are open.
- [x] 2.2 `migration new close_critical_service_only_tables`: `revoke all … from anon, authenticated`
  and drop the three staff policies, RLS stays on. Verify: applied locally; `supabase test db` green
  (S1 file plus the guard); `psql` shows no policy and no client privilege on the three tables.
- [x] 2.3 Application regression: run the vitest suites that touch the three tables (`src/lib/data`,
  the OTP, agreement-archive and webhook-inbox code, worker stores), and run
  `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh src/lib/auth/permissions.local-it.test.ts`.
  Its `webhook_inbox` cases record today's permissive behaviour and turn red with this stage; flip them
  in the same commit to the new expectation (every staff session, `anon` and a customer get `42501`
  on read, update, insert and delete). Verify: green, and the access map still shows no
  user-session path for them.
- [x] 2.4 Run the local Advisors (`npx supabase@2.120.0 db advisors --db-url "<local>"`) and write
  `verification-s1.md` with the grants/policies before and after and each finding judged (an
  `rls_enabled_no_policy` info on a closed table is the intended shape, like `cardcom_config`). Verify:
  the document exists and names every finding.

  **Stage S1 done locally 25.10.2026; not pushed.** Test generated by `scripts/gen-staff-table-rls.ts` (60 assertions):
  red before the migration for the stated reason only (45 of 60, all from the open grants and the staff policy), green
  after. Migration `20261025141452_close_critical_service_only_tables.sql` (CLI-created, generated body, ROLLBACK header
  from the live catalog), applied locally only. `permissions.local-it.test.ts` `webhook_inbox` cases flipped in the same
  change; 17/17. Evidence, Advisors and what remains (push decision, live comparison): `verification-s1.md`.

## 3. Stage S2 — close the remaining service-only tables

- [x] 3.1 Write `s2_closed_rest.test.sql` for `workflows`, `workflow_runs`, `workflow_run_events`,
  `workflow_run_steps`, `webhook_deliveries`, `outreach_template_failures`, `vox_log_exports`, same
  families as 2.1. Verify: red on the current local database.
- [x] 3.2 `migration new close_remaining_service_only_tables` (revoke all, drop the staff policies).
  Verify: applied locally; the S2 file, S1 file and guard are green.
- [x] 3.3 Regression: vitest for workflows, the latest-runs route, outreach template failures and
  vox-log export, plus a service-role smoke select per table; local Advisors; `verification-s2.md`.
  Verify: all green and the document lists the findings.

  **Stage S2 done locally 25.10.2026; not pushed.** Generated test (140 assertions) red before for the stated reason
  only (64 of 140), green after; migration `20261025143711_close_remaining_service_only_tables.sql` applied locally only;
  all pgTAP files pass (Files=4, Tests=259). Evidence and Advisors: `verification-s2.md`.

## 4. Stage S3 — `manage_voice` tables and the provider numbers

- [ ] 4.1 Write `s3_voice.test.sql` for `call_dnc_list`, `call_compliance_settings`, `voice_purposes`,
  `provider_numbers`, `provider_number_roles`: policy inventory per
  operation, privilege inventory, and the behaviour matrix over owner, a role holding only
  `manage_voice`, a role holding only `manage_settings`, `billing_clerk`, `auditor`, `support_agent`,
  non-staff authenticated and anon; denials by filter assert zero rows plus an intact target row,
  allowed writes assert the `returning` value; include the exact query shapes of `call-dnc.ts`,
  `voximplant-channel.ts`, `voice-purposes.ts` and `provider-numbers.ts` and the
  `upsert_provider_number` RPC called by each key holder alone and by a non-holder.
  `voice_purpose_attempts` is a closed table here (Group A, design D1): `policies_are` = none, no
  privilege for `anon` or `authenticated`, and every role above, the `manage_voice` holder and the owner
  included, refused every operation with `throws_ok('42501')`; as `service_role`, the statement shapes
  of `voice-purpose-dispatch.ts` (insert, select by step, update), `voice-purpose-attempts.ts` (select by
  `access_token`, terminal update) and the ctx route's select succeed and return their row. Verify: red on
  the current local database (the `manage_voice` read policy still admits its holder).
- [ ] 4.2 `migration new staff_tables_voice_permission`: rebuild grants (revoke all from `anon` and
  `authenticated`, grant back the exact operations), create per-operation policies keyed as in
  `design.md`, and split the existing `voice_purposes_admin_all` (`for all`, `manage_voice` since
  `20261015114659`) into per-operation policies. Close `voice_purpose_attempts`: `revoke all … from
  anon, authenticated` and drop `voice_purpose_attempts_admin_read`; RLS stays on, `service_role`
  untouched; the rollback header restores `grant select … to authenticated` and the policy text read
  from the live catalog. Verify: applied locally; S3, S2, S1 and guard files green.
- [ ] 4.3 Regression: vitest for `call-dnc`, `voximplant-channel`, `voice-purposes` and
  `provider-numbers` modules and their routes; for the server paths of `voice_purpose_attempts`:
  `src/lib/data/voice-purpose-dispatch.test.ts`, `src/app/api/voximplant/purpose/purpose-cb.test.ts`,
  `src/lib/data/elevenlabs-analysis.test.ts` and `src/lib/data/elevenlabs-analysis-processing.test.ts`,
  plus a local service-role smoke (insert, select by `access_token`, update, delete of a tagged fixture
  row, cleaned up) that proves the server still reaches the closed table; the map consistency test from
  1.2; local Advisors; `verification-s3.md`. Verify: all green; the document records that the generic
  voice feature has 0 production attempts, so the regression is proved locally and not by live traffic.

## 5. Stage S4 — `packages`

- [ ] 5.1 Write `s4_packages.test.sql`: `billing_clerk` and owner read/insert/update/delete; `ops_engineer`,
  `auditor`, `support_agent` refused writes (auditor holds `view_billing` and still cannot write);
  `anon` and customer sessions read active rows only and cannot write (`42501`); inactive rows are
  invisible to them. Verify: red on the current local database (anon and every staff member can write).

  **Consistency of the server key and the database rule (moved here from 1.2, 25.10.2026).** Add the D10 text check
  for `packages`: a vitest reads the `packages` policies of the S4 migration and of `s4_packages.test.sql` and asserts,
  per operation, that the key each policy names equals `staffTableOperationKeys('packages', op)` (the key
  `PLATFORM_ACTIONS.Package` binds to the paired action). A difference fails with a message naming the table and the
  operation (`packages SELECT: …`). Verify, by mutation then restore: (1) `Package.read` changed in `PLATFORM_ACTIONS`
  only fails naming `packages SELECT`; (2) the key of one `packages` policy changed in the SQL only fails naming that
  operation. **Not marked passing before both mutations are proved and recorded in `verification-s4.md`.**
- [ ] 5.2 `migration new packages_billing_permission`: per-operation `manage_billing` policies, keep
  `packages_public_read`, `anon` keeps `SELECT` only. Verify: applied locally; S4 and earlier files green.
- [ ] 5.3 Regression: vitest for `admin/packages`, `agent-benefits` and the public pages that list
  packages; the CASL tests `src/lib/casl.test.ts` and `src/lib/casl-pilot-static.test.ts` (the action map
  and the guard that keeps package keys in it), in addition to the RLS proof; run
  `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh
  src/lib/auth/permissions.local-it.test.ts` and flip its `packages` cases in the same commit
  (`auditor` and `ops_engineer` refused insert, update and delete and no longer see inactive packages;
  `billing_clerk` unchanged; the "Server Action refuses, PostgREST allows" case becomes "both refuse");
  the public read of active packages (`anon`, customer) is asserted as its own case, apart from the
  `Package` actions; Advisors; `verification-s4.md`. Verify: all green.

## 6. Stage S5 — `manage_settings` tables and the fleet RPCs

- [ ] 6.1 Write `s5_settings.test.sql` for `message_templates`, `channels`, `faq_items`,
  `callback_schedule_policies`, `ops_alerts`, `fleet_requests`, `fleet_goals`,
  `fleet_request_slack_threads`: inventories and the behaviour matrix (holder of `manage_settings`
  allowed; `billing_clerk`, `auditor`, `support_agent`, non-staff, anon refused; public read policies
  on `channels` and `faq_items` unchanged), plus the six `fleet_*` RPCs: holder succeeds, non-holder is
  refused. The retired admin flag no longer exists (`user_roles` dropped in `20261015134735`), so there
  is no case for it. Verify: red on the current local database for the tables; the RPC cases are
  green already, because the gate is live since `20261015114659`.
- [x] 6.2 Re-gate the six `fleet_*` functions to `has_platform_permission('manage_settings')` with
  `search_path = ''`.
  - **Completed by migration `20261015114659_retire_user_roles_admin_consumers.sql` (15.10.2026)**,
    not by a migration of this change.
  - Verified on the live catalog on 19.10.2026: every `fleet_*` body calls that key, `proconfig` is
    `search_path=""`, and 0 functions reference `has_role`.
  - No migration is written here.
- [ ] 6.3 `migration new staff_tables_settings_permission`: per-operation policies and rebuilt grants for
  the eight tables, scope `channels_admin_all` away from `public`. Verify: applied locally; S5 and all
  earlier files green.
- [ ] 6.4 Regression: vitest for `message-templates`, `channel-catalog`, `faq`, `alerts`, `fleet`,
  callbacks policy and `app-health`; fix any reader found in 1.1 to read with the service role after its
  gate (test first), like the integrations card; Advisors; `verification-s5.md`. Verify: all green.

## 7. Stage S6 — hardening, documentation and integration

- [ ] 7.1 `migration new permission_helpers_empty_search_path`: `set search_path = ''` on
  `is_platform_staff()` and `has_platform_permission()`. Verify: `pg_get_functiondef` shows every name
  schema-qualified; pgTAP `is_definer` and `function_returns` pass; the whole matrix and the existing
  `check:permissions` script's logic (run locally against the same statements) still pass.
- [ ] 7.2 Rewrite the permission-model notes in `src/lib/auth/dal.ts` (floor, closed tables,
  per-permission policies, why not JWT claims, where the proof lives). Verify: the text no longer says
  fine-grained permissions appear in zero policies, `npx tsc --noEmit` and eslint on the file pass.
- [ ] 7.3 Integration: full `supabase test db` run, full vitest, `npx tsc --noEmit`, lint and
  `npm run build`; write `verification-final.md` mapping every requirement of
  `specs/staff-table-access-control/spec.md` to the test that proves it and listing the follow-ups
  (revoke default privileges and clean remaining `anon` grants; split the `app_settings` policy;
  provider secrets into a closed table). Verify: all green and every requirement maps to a named test.

## Workflow follow-up

- After each stage the owner reviews and runs `db push`; then compare the live catalog (read-only
  queries: policy text, privileges, function bodies) with the local result and record it in that
  stage's verification document. No impersonation on the live database.
- Archive the change after the project's review requirements are satisfied.
