# Verification, stage S2: the remaining service-only tables

Date: 25.10.2026. Local stack only (`supabase_db_beta`, label `com.supabase.cli.project=beta`, DB 127.0.0.1:54322,
API 127.0.0.1:54321). Production was only read. The sections up to Advisors were written before the push; the
owner's push and the live comparison are in the last section.

## What changed

Migration `supabase/migrations/20261025143711_close_remaining_service_only_tables.sql`, created by
`npx supabase migration new close_remaining_service_only_tables`, body written by `scripts/gen-staff-table-rls.ts
migration`, `ROLLBACK:` header by hand from the live catalog. Applied locally with `supabase migration up --db-url
…127.0.0.1:54322…` (388 migrations locally).

| Table | Before (live = local, read 25.10.2026) | After (local) |
|---|---|---|
| `workflows` | `authenticated`: SELECT, INSERT, UPDATE, DELETE; policy `workflows_admin_all` (ALL, **to public**, `is_platform_staff()`) | no privilege for `anon` or `authenticated`, no policy, RLS on |
| `workflow_runs`, `workflow_run_events`, `workflow_run_steps` | `authenticated`: SELECT; one select policy each (**to public**, `is_platform_staff()`) | the same as above |
| `webhook_deliveries` | `authenticated`: SELECT; `webhook_deliveries_admin_select` (**to public**) | the same as above |
| `outreach_template_failures` | `authenticated`: all eight privileges; `outreach_template_failures_admin_all` (ALL) | the same as above |
| `vox_log_exports` | `authenticated`: all eight privileges; `vox_log_exports_admin_read` (SELECT) | the same as above |

`anon` held nothing on these tables before. `service_role` is untouched.

No code path changed. Re-checked 25.10.2026: every file under `src/`, `worker/`, `scripts/`, `supabase/functions/`
that names one of the tables uses `createAdminClient()` and none uses `createClient()` or the browser client; no view
and no Realtime publication reads them; the two functions that name them (`integrations_delete_credential`,
`wake_parked_workflow_run`) are `SECURITY INVOKER` and not executable by `authenticated`.

## Proof

| Check | Classification | Result |
|---|---|---|
| `supabase/tests/database/s2_closed_rest_test.sql` (generated, 140 assertions) | SQL (pgTAP) | before the migration: FAIL 64 of 140, every one from the open grants and the staff policies (anon cases already passed); after: PASS |
| All pgTAP files (`000-harness`, `000-service-role`, `s1_closed_critical`, `s2_closed_rest`) | SQL (pgTAP) | `supabase test db --local supabase/tests/database`: Files=4, Tests=259, PASS |
| `permissions.local-it.test.ts`, `outreach-schedule.local-it.test.ts` | PostgREST / integration through TS, `scripts/integration/run-local.sh` | 17/17 and 8/8; fingerprint unchanged after each |
| vitest for `src/lib/workflow`, admin workflows (data layer, routes including `runs/latest`, pages), outreach, vox-log export, voice-ops, webhooks, the webhook inbox, SUMIT trigger subscriptions, `src/lib/auth` | unit (mocked) | 2,321 passed |

`outreach-serial-flow.integration.test.ts` is outside `run-local.sh` (it needs the `OUTREACH_TEST_*` trio) and does
not touch these tables; not run. Not classified as end-to-end: no browser flow and no live traffic.

## Advisors

`supabase db advisors --db-url <local> --type all --level info`, after S2 compared with after S1 (207 and 200
findings): the only new findings are `rls_enabled_no_policy` (INFO) on the seven tables, the intended closed shape
(design D2). Nothing disappeared. No ERROR or WARN finding names any of the seven tables.

## Production, after the push (25.10.2026, read-only)

The owner applied the migration with `supabase db push --linked` (not through a push to `main`): the migration's
statements run in `postgres_logs` at 14:43:49 UTC. `faede5df` was still not on `origin/main` at the time of this check.

| Check | Result |
|---|---|
| `supabase migration list --linked` | 388 local, 388 remote, none missing on either side; latest `20261025143711` (the S2 migration) |
| Privileges and policies of the seven tables (`has_table_privilege` for authenticated, anon, service_role; `pg_policies`; `relrowsecurity`), live vs local | identical: RLS on, no privilege for `authenticated` or `anon`, `service_role` SELECT/INSERT/UPDATE/DELETE, no policy |
| Data API, anon key, `GET /rest/v1/<table>?select=<column>&limit=1` | 42501 on all seven (`workflow_run_events` has no `id` column; probed with `seq`) |
| Data API, service-role key, `HEAD` of the same request (no row printed) | 200 on all seven |
| `edge_logs` 14:43:49–14:49:00 UTC, requests to the seven tables | the worker's workflow sweep (`node`): 17 requests (`GET workflows`, `GET workflow_runs`, `GET workflow_run_steps`), all 200, 14:44:05 to 14:48:05. Everything else is the probes above (`curl`). `edge_logs` holds 5 of the 7 anon probe GETs (`postgres_logs` has all 7), so it is not a complete record of requests |
| `postgres_logs` "permission denied", 14:35–14:49:00 UTC | seven, 14:45:20 to 14:45:41: exactly the seven anon probes; none from the application |
| Newest row per table (read at 14:48 UTC) | `workflow_run_events` 06.10.2026 05:15 UTC; `webhook_deliveries` 25.10.2026 06:30 UTC; `vox_log_exports` 11.09.2026 00:20 UTC (`greatest(created_at, updated_at)`); `outreach_template_failures` empty. No row written after the push |
| `supabase db advisors --linked --type all --level info` (268 findings) | for the seven tables: `rls_enabled_no_policy` (INFO) on each, the intended closed shape; plus earlier performance INFOs (`unused_index` on `vox_log_exports`, `webhook_deliveries`, `workflow_runs`; `unindexed_foreign_keys` on `workflow_runs`), not from this stage. No ERROR or WARN finding names any of them |

Proved in production: the server path reaches `workflows`, `workflow_runs` and `workflow_run_steps` after the push
(the worker's live requests, 200, with no client role holding a privilege). Not proved by live traffic:
`workflow_run_events`, `webhook_deliveries`, `outreach_template_failures` and `vox_log_exports`: no application request
in `edge_logs` and no row written since the push. The next workflow event, inbound provider webhook, template failure
or vox-log export is their first live use; the service-role read above shows the grant it needs is in place.
