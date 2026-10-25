# Verification, stage S1: the three critical service-only tables

Date: 25.10.2026. Everything here ran on the **local** stack only (`supabase_db_beta`, label
`com.supabase.cli.project=beta`, DB 127.0.0.1:54322, API 127.0.0.1:54321). Production was only read (catalog queries and
`supabase db advisors --linked`). The migration is not pushed; pushing to `main` applies it to production through the
Supabase GitHub integration, so that is a separate decision.

## What changed

Migration `supabase/migrations/20261025141452_close_critical_service_only_tables.sql`, created by
`npx supabase migration new close_critical_service_only_tables`; its body was written by
`scripts/gen-staff-table-rls.ts migration` (design D13) and its `ROLLBACK:` header by hand from the live catalog.
Applied with `supabase migration up --db-url postgresql://…@127.0.0.1:54322/…` (387 migrations locally after it).

| Table | Before (live = local, read 25.10.2026) | After (local) |
|---|---|---|
| `otp_challenges` | `authenticated`: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN; `anon`: none; policy `otp_challenges_admin_all` (ALL, `is_platform_staff()`) | no privilege for `anon` or `authenticated`; no policy; RLS on; `service_role` SELECT kept |
| `agreement_documents` | the same, policy `agreement_documents_admin_all` | the same as above |
| `webhook_inbox` | the same, policy `webhook_inbox_admin_all` | the same as above |

No code path changed: every reader and writer of the three tables uses `createAdminClient()` (re-checked 25.10.2026:
no `createClient()` in any file under `src/`, `worker/`, `scripts/`, `supabase/functions/` that names one of them).

## Proof

| Check | Classification | Result |
|---|---|---|
| `supabase/tests/database/s1_closed_critical_test.sql` (generated, 60 assertions: inventory, privileges, no MAINTAIN, owner / staff without a key / signed-in non-staff / anon refused SELECT, INSERT, UPDATE, DELETE with `permission denied for table …`) | SQL (pgTAP) | before the migration: FAIL, 45 of 60, every one because of the open grants and the staff policy (anon cases already passed since stage 0); after: PASS |
| `000-service-role_test.sql` (service_role reads all 25 tables and holds its four privileges) and `000-harness_test.sql` | SQL (pgTAP) | PASS; `supabase test db --local supabase/tests/database`: Files=3, Tests=119 |
| `src/lib/auth/permissions.local-it.test.ts` | PostgREST, real Auth users, through `scripts/integration/run-local.sh` | before the flip: 4 `webhook_inbox` cases red (they recorded the old permissive behaviour); flipped in the same change: anon, a customer, auditor, billing_clerk and ops_engineer get `grant-denied` on SELECT, UPDATE, INSERT and DELETE; the row is unchanged, no forged row exists, the service role still reads the payload; 17 of 17 pass; fixture fingerprint unchanged |
| `cleanup`, `headcount`, `webhook-claim`, `webhook-message` local-IT files (they write and claim `webhook_inbox` rows through the service role and the worker's RPC) | integration through TS | all pass (their `expected fail` cases are pre-existing `it.fails`); fingerprint unchanged after each |
| vitest for OTP, agreements, webhooks, WhatsApp import, the admin webhook inbox and agreements, the owner agent, `/admin/webhooks`, `src/lib/auth` | unit (mocked) | 1,541 passed |

Not classified as end-to-end: no browser flow and no live traffic ran against the new grants.

## Advisors

`supabase db advisors --db-url <local> --type all --level info` after the migration, compared with
`supabase db advisors --linked` (production, which still has the old shape):

- New locally, and only these three for the stage tables: `rls_enabled_no_policy` (INFO) on `otp_challenges`,
  `agreement_documents`, `webhook_inbox`. This is the intended shape of a closed table (design D2), the same as
  `cardcom_config`: RLS on, no policy, no client grant.
- No ERROR or WARN finding names any of the three tables, locally or in production.
- Other differences between the two lists are not from this stage: unused-index counts depend on each database's
  traffic; production also lists pg-boss tables and functions, two extensions and the 24
  `authenticated_security_definer_function_executable` warnings, which the local run did not report. The local JSON held
  exactly 200 findings; the run after stage S2 returned 207, so the output is not capped at 200.

## Production, after the push (25.10.2026, read-only)

The owner pushed `ea6876a0..b019bb4e`; GitHub checks on `b019bb4e`: `Supabase Preview` success, `verify` success.

| Check | Result |
|---|---|
| `supabase_migrations.schema_migrations` | 387 rows, latest `20261025141452` (the S1 migration) |
| Privileges and policies of the three tables (`has_table_privilege` for authenticated, anon, service_role; `pg_policies`; `relrowsecurity`), live vs local | identical: RLS on, no privilege for `authenticated` or `anon`, `service_role` SELECT/INSERT/UPDATE/DELETE, no policy |
| Data API, anon key, `GET /rest/v1/<table>?select=id&limit=1` | 42501 on all three |
| Data API, service-role key, `HEAD` of the same request (no row printed) | 200 on all three: the server path still reaches them |
| Logs 12:00–14:30 UTC (`postgres_logs` "permission denied for table" on the three; `edge_logs` requests to them) | none |

Not proved in production: an application request through these tables after the push. The logs show no request to
them in the window, and the last `webhook_inbox` row arrived at 06:30 UTC, before the push. The next inbound webhook,
OTP or agreement action is the first live use; the service-role read above shows the grant it needs is in place.
