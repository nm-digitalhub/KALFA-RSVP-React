# Verification, stage S2: the remaining service-only tables

Date: 25.10.2026. Local stack only (`supabase_db_beta`, label `com.supabase.cli.project=beta`, DB 127.0.0.1:54322,
API 127.0.0.1:54321). Production was only read. The migration is not pushed: pushing to `main` applies it to production.

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

## Still to do for this stage

- The owner reviews the migration and decides the push (it deploys to production).
- After the push: read-only comparison of the live catalog with the table above, recorded here.
