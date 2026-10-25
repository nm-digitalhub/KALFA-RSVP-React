# Verification, stage S3: the manage_voice tables and the provider numbers

Date: 25.10.2026. Local stack only (`supabase_db_beta`, label `com.supabase.cli.project=beta`, DB 127.0.0.1:54322,
API 127.0.0.1:54321). Production was only read (catalog, role list, row counts, Advisors). The sections up to Advisors
were written before the push; the owner's push and the live comparison are in the last section.

## What changed

Migration `supabase/migrations/20261025151809_staff_tables_voice_permission.sql`, created by
`npx supabase migration new staff_tables_voice_permission`, body written by `scripts/gen-staff-table-rls.ts migration`,
`ROLLBACK:` header by hand from the live catalog. Applied locally with `supabase migration up --db-url …127.0.0.1:54322…`
(389 migrations locally).

| Table | Before (live = local, read 25.10.2026) | After (local) |
|---|---|---|
| `call_dnc_list` | `authenticated`: all eight privileges; `call_dnc_list_admin_all` (ALL, `is_platform_staff()`) | `authenticated`: SELECT, INSERT, UPDATE; one policy each, `manage_voice` |
| `call_compliance_settings` | `authenticated`: SELECT, UPDATE; `call_compliance_settings_staff_all` (ALL, floor) | `authenticated`: SELECT, UPDATE; one policy each, `manage_voice` |
| `voice_purposes` | `authenticated`: SELECT, INSERT, UPDATE, DELETE; `voice_purposes_admin_all` (ALL, `manage_voice`) | `authenticated`: SELECT, INSERT, UPDATE; one policy each, `manage_voice` |
| `provider_numbers` | `authenticated`: SELECT, INSERT, UPDATE, DELETE; `provider_numbers_admin_all` (ALL, floor) | `authenticated`: SELECT, INSERT, UPDATE; one policy each, `manage_settings` OR `manage_voice` |
| `provider_number_roles` | `authenticated`: SELECT, INSERT, UPDATE, DELETE; `provider_number_roles_admin_all` (ALL, floor) | `authenticated`: SELECT, INSERT, UPDATE, DELETE; one policy each, `manage_settings` OR `manage_voice` |
| `voice_purpose_attempts` | `authenticated`: SELECT; `voice_purpose_attempts_admin_read` (SELECT, `manage_voice`) | closed: no privilege for `anon` or `authenticated`, no policy, RLS on |

`anon` held nothing on these tables before and holds nothing after. `service_role` is untouched. All policies are
`to authenticated`.

The user-session paths were re-checked on 25.10.2026 (every file under `src/`, `worker/`, `scripts/`,
`supabase/functions/` that names one of the six tables or `upsert_provider_number`): the cookie client reaches them only
in `admin/call-dnc.ts`, `admin/voximplant-channel.ts`, `admin/voice-purposes.ts`, `admin/integrations/provider-numbers.ts`
(the modules of the map) and `admin/owner-agent.ts` (`listOwnerAgentNumbers`, `requirePlatformOwner`; the owner holds
both keys). Every other reader and writer, and every reader of `voice_purpose_attempts`, uses `createAdminClient()`.
In the catalog (read-only query, live and local, 25.10.2026: policies of other tables, views, materialized views,
function bodies, publications) the only object that names one of the six tables is `upsert_provider_number`
(`SECURITY INVOKER`, executable by `authenticated`, not by `anon`), tested below; no view, no Realtime publication and
no other function reads them.

Code: the header comments of `call-dnc.ts`, `provider-numbers.ts`, `voice-purposes.ts` and `owner-agent.ts` named the
dropped policies and the staff floor; they now describe the per-operation policies. No behaviour change.

## Proof

| Check | Classification | Result |
|---|---|---|
| `supabase/tests/database/s3_voice_test.sql` (generated from the map and `scripts/staff-table-rls-fixtures/s3_voice.json`, 233 assertions: inventories, privileges, no MAINTAIN, the behaviour matrix over the owner, a holder of only `manage_settings`, a holder of only `manage_voice`, staff holding no key, a signed-in non-staff user, anon) | SQL (pgTAP) | before the migration: FAIL 87 of 233, all from today's grants and policies: 36 policy names and shape, 5 extra privileges (MAINTAIN included), 20 operations the map does not grant still granted, 17 staff without the key admitted by the floor, and 9 that follow from the floor admitting a DELETE of the `provider_number_roles` fixture by staff holding no key; after: PASS |
| `supabase/tests/database/s3_voice_paths_test.sql` (hand-written, 226 assertions: the seeded owner, `ops_engineer`, `billing_clerk`, `auditor` and a `support_agent` stand-in; each data-layer query shape, including the PostgREST upserts of `addToCallDnc` and `assignRole` on a new and on an existing row; `upsert_provider_number` on its existing-ref, new-ref, adoption and E.164-only paths for each key holder alone and for staff without either key; `listOwnerAgentNumbers`; the service-role statements of `voice_purpose_attempts`) | SQL (pgTAP) | before: FAIL 81 of 226, all from today's grants and policies: 58 staff without the key admitted by the floor (billing_clerk 18, auditor 16, support_agent stand-in 16, the `manage_settings`-only holder 8 on the voice tables), 4 intact-row checks broken by those writes, 14 holder reads that saw the rows those writes changed, 5 refusals on `voice_purpose_attempts` not raised because `authenticated` still held SELECT; after: PASS |
| All pgTAP files (`000-harness`, `000-service-role`, `s1_closed_critical`, `s2_closed_rest`, `s3_voice`, `s3_voice_paths`) | SQL (pgTAP) | `supabase test db --local supabase/tests/database`: Files=6, Tests=718, PASS; fingerprint (extensions, staff and role tables, every `public` policy, the stage tables' row counts) unchanged after the run |
| Local service-role smoke through PostgREST (`127.0.0.1:54321`, service key from `supabase status`): insert of a tagged `voice_purpose_attempts` row, select by `access_token`, terminal update guarded by `dispatch_status in (…)`, delete; the anon key on the same select | integration (Data API) | 201, 200, 200, 200; anon 42501. Its event and contact fixture was inserted and deleted as postgres; events 113, contacts 0, attempts 0 before and after |
| `permissions.local-it`, `console-views`, `console-findings`, `console-rest`, `permission-signal`, `console-realtime` local-IT, `outreach-schedule.local-it` | PostgREST / integration through TS, `scripts/integration/run-local.sh` | 7 files, 99 tests, pass. None of them touches the six tables; run as a regression for the grants |
| vitest: `call-dnc`, `voximplant-channel` (+ wiring), `voice-purposes` (admin and runtime), `provider-numbers` (+ resolve), `owner-agent`, `voice-purpose-dispatch`, `purpose-cb`, `elevenlabs-analysis` (+ processing), `src/lib/dnc`, `src/lib/auth` (including the map test of task 1.2 in `admin-data-layer-coverage.test.ts`), and the routes under `admin/dnc`, `admin/voice`, `admin/integrations`, `api/voximplant` | unit (mocked) | 863 passed (91 skipped: the local-IT files above, which need `run-local.sh`) and 501 passed |
| `src/lib/auth/staff-table-rls.test.ts` | unit | 65 passed. New case: a refused INSERT is followed by a cleanup of its row; proved by mutation (removing the cleanup fails it), then restored |
| `npm run typecheck`, `npm run lint`, `npm run build` (into `.next-verify`, not the served `.next`) | static | exit 0, exit 0, exit 0 (compiled, 90/90 static pages, no warning) |

**Generator change.** The first red run of `s3_voice_test.sql` aborted at statement 153: on today's database a
non-holder's "refused" INSERT succeeded and left its row, and the next allowed INSERT hit the primary key. The template
now removes, as postgres, any row a refused INSERT left (`renderPgTapTests`, one `delete … where <probe> = <insertValue>`
after each `refused INSERT (with check)` case; it asserts nothing). The refusal assertion is unchanged. Re-rendering the
S1 and S2 files gives byte-identical output (closed tables have no such case); the S3 file re-renders identically.

**Refusal messages, measured** on the local stack with this migration applied, in a rolled-back transaction: a member
without the key gets 42501 `new row violates row-level security policy for table "<t>"` on both the new-row and the
existing-row path of the PostgREST upserts, and inside `upsert_provider_number` on its existing-ref, new-ref and
E.164-only paths; anon gets `permission denied for function upsert_provider_number`.

**`support_agent`.** The role exists in production (created through the staff UI on 13.07.2026; no migration creates
it), so the local database has four roles. `s3_voice_paths_test.sql` uses a stand-in role with its live keys, read on
25.10.2026: `view_activity_log`, `view_customer_data`, `view_events`. The live keys of `ops_engineer`, `billing_clerk`
and `auditor` equal the local seed.

**The generic voice feature in production** (read-only, 25.10.2026): 0 `voice_purpose_attempts` rows, 1 non-built-in
purpose, 0 enabled. The regression of the closed table is proved locally, not by live traffic.

Not classified as end-to-end: no browser flow and no live traffic ran against the new policies.

**Known limitation (by the spec, not changed here).** The `manage_settings` OR `manage_voice` policies of
`provider_numbers` and `provider_number_roles` hold for the whole table, not per provider or per role, as the scenario
"Either of two permissions" specifies. The application is narrower: `requireRolePermission` and
`requireProviderPermission` take `manage_voice` for the voice roles and Voximplant lines and `manage_settings` for the
rest. So through PostgREST a holder of only `manage_settings` can assign `voice_caller_id_rsvp`, and a holder of only
`manage_voice` can write a `meta_whatsapp` row, which the screens refuse. Before S3 any staff member could do both.
Making the policy follow the row is an owner decision for a later change.

## Advisors

`supabase db advisors --db-url <local> --type all --level info`: 208 findings, after S2 207. The only new one is
`rls_enabled_no_policy` (INFO) on `voice_purpose_attempts`, the intended closed shape (design D2). The other findings
naming the six tables are `unindexed_foreign_keys` (INFO) on `call_dnc_list.added_by` and on
`voice_purpose_attempts.event_id` and `.purpose_key`; production lists the same three, so they are older than this stage.
No ERROR or WARN finding names any of the six tables.

## Production, after the push (25.10.2026, read-only)

The owner applied the migration with `supabase db push --linked`; its statements run in `postgres_logs` at 15:38:19 UTC.

| Check | Result |
|---|---|
| `supabase migration list --linked` | 389 local, 389 remote, none missing on either side; latest `20261025151809` |
| Privileges, ACL, RLS and policies of the six tables (`has_table_privilege` for authenticated, anon, service_role; `relacl`; `pg_policies` name, command, roles, `using` and `with check` text), live vs local | identical, line for line (the table in "What changed") |
| Data API, anon key, `GET /rest/v1/<table>?select=<column>&limit=1` | 42501 on all six |
| Data API, service-role key, `HEAD` of the same request (no row printed) | 200 on all six |
| `postgres_logs` from 15:38:19 to 15:40 UTC, "permission denied" or "row-level security" | six, 15:38:55 to 15:38:58: exactly the six anon probes; none from the application |
| `edge_logs` in the same window, requests to the six tables or `rpc/upsert_provider_number` | only the probes (`curl`); `edge_logs` holds 5 of the 6 GETs and 4 of the 6 HEADs, so it is not a complete record |
| Newest row per table (read at 15:39 UTC) | `call_compliance_settings` 11.10.2026; `voice_purposes` 15.09.2026; `provider_numbers` 28.09.2026; `provider_number_roles` 13.09.2026; `call_dnc_list` and `voice_purpose_attempts` empty. No row written after the push |
| `supabase db advisors --linked --type all --level info` | 269 findings, after S2 268. The only new one is `rls_enabled_no_policy` (INFO) on `voice_purpose_attempts`; nothing disappeared. No ERROR or WARN finding names any of the six tables |

Not proved in production: an application request through the new policies. None reached the six tables in the window.
The first live uses are the next visit by a `manage_voice` or `manage_settings` holder to `/admin/dnc`, the
Voximplant channel screen, the voice purposes or the numbers panel (user session), and the next outreach dial gate or
number resolution (service role). The local proof above covers each of those statement shapes.
