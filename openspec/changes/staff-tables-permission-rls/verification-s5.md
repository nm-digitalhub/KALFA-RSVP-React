# Verification, stage S5: the manage_settings tables and the fleet RPCs

Date: 25.10.2026. Local stack only (`supabase_db_beta`, label `com.supabase.cli.project=beta`, DB 127.0.0.1:54322,
API 127.0.0.1:54321). Production was only read (catalog, role list). The sections up to Advisors were written before
the push; the owner's push and the live comparison are in the last section.

## What changed

Migration `supabase/migrations/20261025161814_staff_tables_settings_permission.sql`, created by
`npx supabase migration new staff_tables_settings_permission`, body written by `scripts/gen-staff-table-rls.ts
migration`, `ROLLBACK:` header by hand from the live catalog. Applied locally with `supabase migration up --db-url
…127.0.0.1:54322…` (391 migrations locally).

| Table | Before (live = local, read 25.10.2026) | After (local) |
|---|---|---|
| `message_templates` | `authenticated`: all eight privileges; `message_templates_admin_all` (ALL, floor) | SELECT, UPDATE; one policy each, `manage_settings` |
| `channels` | `authenticated`: SELECT, INSERT, UPDATE, DELETE; `channels_admin_all` (ALL, **to public**, floor); `channels_auth_read` (SELECT, authenticated, `true`) | SELECT, UPDATE; one policy each, `manage_settings`; `channels_auth_read` unchanged |
| `faq_items` | `authenticated`: SELECT, INSERT, UPDATE, DELETE, `anon`: SELECT; `faq_items_admin_all` (ALL, floor); `faq_items_public_read` (SELECT, anon and authenticated, `published = true`) | SELECT, INSERT, UPDATE, DELETE, `anon` SELECT; one policy each, `manage_settings`; `faq_items_public_read` unchanged |
| `callback_schedule_policies` | `authenticated`: SELECT, UPDATE; `callback_schedule_policies_admin_all` (ALL, floor) | SELECT, UPDATE; one policy each, `manage_settings` |
| `ops_alerts` | `authenticated`: all eight privileges; `ops_alerts_admin_select` (SELECT, floor) | SELECT; one policy, `manage_settings` |
| `fleet_requests`, `fleet_goals`, `fleet_request_slack_threads` | `authenticated`: SELECT; one select policy each (**to public**, floor) | SELECT; one policy each, `manage_settings` |

`anon` holds nothing on these tables except SELECT on `faq_items`. `service_role` is untouched. No policy is scoped
`to public` any more on these tables.

The six `fleet_*` RPCs (`fleet_owner_request`, `fleet_answer_request`, `fleet_goal_create`, `fleet_goal_pause`,
`fleet_goal_resume`, `fleet_goal_abandon`) are unchanged: `SECURITY DEFINER`, `search_path = ''`, gated inside on
`has_platform_permission('manage_settings')` since `20261015114659` (task 6.2), `EXECUTE` to `authenticated`, not to
`anon`. They are the only writers of the fleet tables from a user session.

User-session paths, re-checked 25.10.2026 (every file under `src/`, `worker/`, `scripts/`, `supabase/functions/` that
names one of the tables or RPCs): `message-templates.ts`, `admin/channel-catalog.ts`, `admin/faq.ts`,
`callbacks/policy/actions.ts`, `policy-config-admin.ts` (`readPolicyRow` with the session), `admin/alerts.ts` and
`admin/fleet.ts`, each after `requirePlatformPermission('manage_settings')`; `channel-catalog.ts` (any signed-in user)
and `faq.ts` (anon and customers) read under the kept policies; `ops/app-health.ts` reads `ops_alerts` for `/admin/debug`,
which is owner-only. `admin/packages.ts` names `message_templates` and reads it with the service role after its own
gate. Every other reader and writer (template sync and health, the WhatsApp send path, `policy-config.ts`,
`alerts/slack.ts`, `nav-counts.ts`, `fleet/expire.ts` from the worker and the fleet CLI) uses the service role. So no
reader gated by another key loses rows (design, Risks, "Group B denials are silent"), and no reader had to move to the
service role (task 6.4).

In the catalog (live and local) the functions that name the tables are the `fleet_*` functions (the six above; the
service-only `fleet_consume_request`, `fleet_goal_close`, `fleet_goal_progress`; the trigger functions
`fleet_requests_guard`, `fleet_requests_no_truncate`, `fleet_goals_guard`, which run only as triggers) and
`try_record_billed_result` (service-only). No view, policy of another table or publication reads them.

Code and docs: the header comments of `callbacks/policy/actions.ts`, `ops/app-health.ts`, `admin/alerts.ts`,
`admin/faq.ts` and `admin/fleet.ts` (two places) named the dropped policies; they now name the per-operation ones.
`docs/project/03-database-schema.md` (`message_templates` RLS line) updated. Dated plans under `docs/` that mention the
old names describe the state at their date and are not edited.

## Proof

| Check | Classification | Result |
|---|---|---|
| `supabase/tests/database/s5_settings_test.sql` (generated from the map and `scripts/staff-table-rls-fixtures/s5_settings.json`, 230 assertions; the reads of sessions without the key on `channels` and `faq_items` are left to the next file because a kept read also applies) | SQL (pgTAP) | before the migration: FAIL 88 of 230, all from today's grants and policies: 36 policy names and shape, 5 privileges (MAINTAIN included), 28 operations the map does not grant still granted, 12 staff holding no key admitted by the floor, and 7 that follow from its admitted DELETE of the `faq_items` fixture; after: PASS |
| `supabase/tests/database/s5_settings_paths_test.sql` (written by hand into the file `supabase test new` created, 191 assertions: the seeded owner, ops_engineer, billing_clerk, auditor, a support_agent stand-in and a holder of only `manage_settings`, a customer and anon, against each data-layer shape; the kept reads `channels_auth_read` and `faq_items_public_read`; the six `fleet_*` RPCs, each holder succeeding and every session without the key refused with `<fn>: not permitted`, anon with `permission denied for function`) | SQL (pgTAP) | before: FAIL 60 of 191, all from the floor: 45 cases of staff without the key admitted, 5 intact-row or nothing-created checks broken by those writes, 10 holder reads that saw the rows those writes changed; every RPC case passed already (the gate is live since `20261015114659`), as the task expects; after: PASS |
| All pgTAP files (`000-harness`, `000-service-role`, S1 to S5) | SQL (pgTAP) | Files=10, Tests=1237, PASS; fingerprint (extensions, staff and role tables, every `public` policy, the stage tables' counts, the callback policy's `daily_cap`) unchanged after the run |
| `src/lib/auth/staff-table-sql-consistency.test.ts` (design D10) | unit (text) | 29 passed: packages, the five S3 tables and the eight S5 tables, each policy and each generated holder case naming the map's key |
| Local-IT (`permissions`, `console-*`, `permission-signal`, `outreach-schedule`) through `scripts/integration/run-local.sh` | PostgREST / integration through TS | 7 files, 99 tests, pass; none of them touches the eight tables |
| vitest: `message-templates`, `channel-catalog` (admin and public), `faq` (admin and public), `admin/alerts`, `admin/fleet`, `src/lib/ops` (app-health), `src/lib/callbacks`, `src/lib/fleet`, `nav-counts`, the admin routes for callbacks, fleet, faq, alerts, channels, templates, debug and settings, and `src/lib/auth` | unit (mocked) | 1,084 passed (91 skipped: the local-IT files above) |
| `npm run typecheck`, `npm run lint`, `npm run build` (into `.next-verify`, not the served `.next`) | static | exit 0, exit 0, exit 0 (compiled, 90/90 static pages, no warning) |

`support_agent`: as in S3 and S4, a stand-in role with its live keys (`view_activity_log`, `view_customer_data`,
`view_events`, read 25.10.2026), because the role exists in production only.

Not classified as end-to-end: no browser flow and no live traffic ran against the new policies.

## Advisors

`supabase db advisors --db-url <local> --type all --level info`: 207 findings, after S4 208.
- `multiple_permissive_policies` (WARN) on `channels` and on `faq_items`, `authenticated` SELECT, present before and
  renamed: `{channels_auth_read,channels_select_permission}` (was `{channels_admin_all,channels_auth_read}`) and
  `{faq_items_public_read,faq_items_select_permission}` (was `{faq_items_admin_all,faq_items_public_read}`). Two
  permissive SELECT policies is the shape design D5 keeps (the public read stays apart from the staff key). On
  `channels` the kept read admits every signed-in user, so `channels_select_permission` adds no row for anyone; it is
  kept so each operation the module performs has its policy (design D3) and the D10 check covers it.
- One finding disappeared: `unused_index` (INFO) on `ops_alerts_created_idx`, because the test runs used the index; not
  a schema change.
- No ERROR or WARN finding names any of the eight tables otherwise.

## Production, after the push (25.10.2026, read-only)

The owner applied the migration with `supabase db push --linked`; its statements run in `postgres_logs` at 16:26:35 UTC.

| Check | Result |
|---|---|
| `supabase migration list --linked` | 391 local, 391 remote, none missing on either side; latest `20261025161814` |
| Privileges, ACL, RLS and policies of the eight tables (`has_table_privilege` for authenticated, anon, service_role; `relacl`; `pg_policies` name, command, roles, `using` and `with check` text), live vs local | identical, line for line (24 lines: 8 tables, 16 policies) |
| Data API, anon key, `GET /rest/v1/<table>?select=<column>&limit=1` on the seven tables without an anon grant | 42501 on all seven |
| Data API, service-role key, `HEAD` of the same request | 200 on all seven |
| Data API, anon key, the public read of `faq_items`: `published=eq.true` / `published=eq.false` with `Prefer: count=exact` | 12 rows / 0 rows; the service-role key counts 12 / 0, so production has no unpublished item and its hiding is proved locally only |
| Data API, anon key, `PATCH /rest/v1/faq_items?id=eq.<an id that does not exist>` | 42501 (no grant); no row could match |
| `postgres_logs` from 16:26:35 to 16:28 UTC, "permission denied", "row-level security" or "not permitted" | eight, 16:27:09 to 16:27:14: exactly the seven anon reads and the anon PATCH above; none from the application |
| `edge_logs` in the same window, requests to the eight tables or a `fleet_*` RPC, other than the probes | `GET 200 fleet_requests` by `node` at 16:27:21: the fleet scheduler, a service-role reader, after the push |
| `supabase db advisors --linked --type all --level info` | 269 findings, as after S4. Two changed their text, the `multiple_permissive_policies` WARN on `channels` and on `faq_items`, which now name `channels_select_permission` and `faq_items_select_permission` instead of the dropped `*_admin_all`; nothing else changed |

Not proved in production: a user-session request through the new policies (the admin screens for templates,
channels, FAQ, callback policy, alerts and the fleet, or a `fleet_*` RPC by a holder). None ran in the window; the local
proof above covers each statement shape.
