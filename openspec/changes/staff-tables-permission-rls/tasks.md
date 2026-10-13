# Tasks

Ground rules for every group: migrations are created only with `npx supabase migration new <name>`
and applied to the **local** database only (`npx supabase migration up --db-url
"postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable"`); the local stack starts
with `SUPABASE_DB_PORT=54322 npx supabase@2.120.0 start` (the `.env.local` value 5432 otherwise wins);
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

- [ ] 1.1 Resolve the unknowns in the access map: every caller of `readPolicyRow(client)`
  (`src/lib/callbacks/policy-config.ts`), every use of the 25 tables in `scripts/**` and `worker/**`,
  and the current `anon`/`authenticated` grants of `voice_purposes` and `voice_purpose_attempts`.
  Update the table in `design.md`. Verify: no "mixed" or "to confirm" cell remains, and each resolved
  row cites the file or catalog query that settled it.
- [ ] 1.2 Add `src/lib/auth/staff-table-permissions.ts` (table → key list, group A/B) and a vitest that
  asserts it equals the module pins of `admin-data-layer-coverage.test.ts` for every Group B table
  and lists exactly the 25 tables. Verify: `npx vitest run src/lib/auth` passes, and changing one key
  in the map makes it fail naming the table.
- [ ] 1.3 Spike the runner: start the local stack, make sure `pgtap` is available, add
  `supabase/tests/database/000-harness.test.sql` (always-green plan plus a fixture that creates a staff
  user in a chosen role and in a temporary role holding exactly one permission, all inside the
  rolled-back transaction). Verify: `npx supabase@2.120.0 test db` reports PASS; the exact command,
  prerequisites and any gotcha are written into `design.md` and, if new, into a memory note.
- [ ] 1.4 Add the service-role guard test (`000-service-role.test.sql`): as `service_role`, select from
  every one of the 25 tables. Verify: PASS now (baseline) and it stays PASS after every stage.

## 2. Stage S1 — close the critical service-only tables

- [ ] 2.1 Write `supabase/tests/database/s1_closed_critical.test.sql` for `otp_challenges`,
  `agreement_documents`, `webhook_inbox`: inventory (`policies_are` = none; no privilege for `anon` or
  `authenticated`) and behaviour (owner, ops_engineer, billing_clerk, auditor, support_agent, non-staff
  authenticated and anon each refused every operation with `throws_ok('42501')`). Verify: red on the
  current local database because the grants are open.
- [ ] 2.2 `migration new close_critical_service_only_tables`: `revoke all … from anon, authenticated`
  and drop the three staff policies, RLS stays on. Verify: applied locally; `supabase test db` green
  (S1 file plus the guard); `psql` shows no policy and no client privilege on the three tables.
- [ ] 2.3 Application regression: run the vitest suites that touch the three tables (`src/lib/data`,
  the OTP, agreement-archive and webhook-inbox code, worker stores). Verify: green, and the access
  map still shows no user-session path for them.
- [ ] 2.4 Run the local Advisors (`npx supabase@2.120.0 db advisors --db-url "<local>"`) and write
  `verification-s1.md` with the grants/policies before and after and each finding judged (an
  `rls_enabled_no_policy` info on a closed table is the intended shape, like `cardcom_config`). Verify:
  the document exists and names every finding.

## 3. Stage S2 — close the remaining service-only tables

- [ ] 3.1 Write `s2_closed_rest.test.sql` for `workflows`, `workflow_runs`, `workflow_run_events`,
  `workflow_run_steps`, `webhook_deliveries`, `outreach_template_failures`, `vox_log_exports`, same
  families as 2.1. Verify: red on the current local database.
- [ ] 3.2 `migration new close_remaining_service_only_tables` (revoke all, drop the staff policies).
  Verify: applied locally; the S2 file, S1 file and guard are green.
- [ ] 3.3 Regression: vitest for workflows, the latest-runs route, outreach template failures and
  vox-log export, plus a service-role smoke select per table; local Advisors; `verification-s2.md`.
  Verify: all green and the document lists the findings.

## 4. Stage S3 — `manage_voice` tables and the provider numbers

- [ ] 4.1 Write `s3_voice.test.sql` for `call_dnc_list`, `call_compliance_settings`, `voice_purposes`,
  `voice_purpose_attempts`, `provider_numbers`, `provider_number_roles`: policy inventory per
  operation, privilege inventory, and the behaviour matrix over owner, a role holding only
  `manage_voice`, a role holding only `manage_settings`, `billing_clerk`, `auditor`, `support_agent`,
  non-staff authenticated and anon; denials by filter assert zero rows plus an intact target row,
  allowed writes assert the `returning` value; include the exact query shapes of `call-dnc.ts`,
  `voximplant-channel.ts`, `voice-purposes.ts` and `provider-numbers.ts` and the
  `upsert_provider_number` RPC called by each key holder alone and by a non-holder. Verify: red on the
  current local database.
- [ ] 4.2 `migration new staff_tables_voice_permission`: rebuild grants (revoke all from `anon` and
  `authenticated`, grant back the exact operations), create per-operation policies keyed as in
  `design.md`, replace the retired `has_role` policies on the two voice tables. Verify: applied
  locally; S3, S2, S1 and guard files green.
- [ ] 4.3 Regression: vitest for `call-dnc`, `voximplant-channel`, `voice-purposes` and
  `provider-numbers` modules and their routes; the map consistency test from 1.2; local Advisors;
  `verification-s3.md`. Verify: all green.

## 5. Stage S4 — `packages`

- [ ] 5.1 Write `s4_packages.test.sql`: `billing_clerk` and owner read/insert/update/delete; `ops_engineer`,
  `auditor`, `support_agent` refused writes (auditor holds `view_billing` and still cannot write);
  `anon` and customer sessions read active rows only and cannot write (`42501`); inactive rows are
  invisible to them. Verify: red on the current local database (anon and every staff member can write).
- [ ] 5.2 `migration new packages_billing_permission`: per-operation `manage_billing` policies, keep
  `packages_public_read`, `anon` keeps `SELECT` only. Verify: applied locally; S4 and earlier files green.
- [ ] 5.3 Regression: vitest for `admin/packages`, `agent-benefits` and the public pages that list
  packages; Advisors; `verification-s4.md`. Verify: all green.

## 6. Stage S5 — `manage_settings` tables and the fleet RPCs

- [ ] 6.1 Write `s5_settings.test.sql` for `message_templates`, `channels`, `faq_items`,
  `callback_schedule_policies`, `ops_alerts`, `fleet_requests`, `fleet_goals`,
  `fleet_request_slack_threads`: inventories and the behaviour matrix (holder of `manage_settings`
  allowed; `billing_clerk`, `auditor`, `support_agent`, non-staff, anon refused; public read policies
  on `channels` and `faq_items` unchanged), plus the six `fleet_*` RPCs: holder succeeds, non-holder is
  refused, and a user holding only the retired admin flag is refused. Verify: red on the current local
  database.
- [ ] 6.2 `migration new fleet_rpcs_manage_settings_gate`: re-create the six functions from
  `pg_get_functiondef` with only the gate line changed to `has_platform_permission('manage_settings')`
  and `set search_path = ''` if missing. Verify: a diff of old and new bodies shows only the gate and
  `search_path` lines; the RPC part of the S5 file is green.
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
