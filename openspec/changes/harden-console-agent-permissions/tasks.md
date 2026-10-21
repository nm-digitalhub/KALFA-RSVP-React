# Tasks

**Ground rules:**
- Planning only until the owner approves implementation.
- Local database only. Pass the port on the command (`SUPABASE_DB_PORT=54322 …`) and never write it to
  `.env.local`, whose 5432 belongs to production's pooler.
- Run integration files one by one, with an explicit path:
  `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh <file>`. Without a path it runs every
  `*.local-it` file, including suites that commit fixtures.
- Integration tests run in one transaction that ends in ROLLBACK. They commit nothing, and the harness
  fingerprint must stay unchanged.
- Create migrations only with `npx supabase migration new <name>` and apply them locally only. Every
  migration carries a rollback header read from the live catalog. The owner runs `db push`.
- Before each stage (sections 2–4), re-run task 1.3.

## 1. Stage S0 — evidence (no schema change)

- [x] 1.1 Write the console access map into `design.md` (D5) from live sources. Cover:
  - the 8 views, the 11 `console_*` tables and `agent_status`, `call_dispatch_status`,
    `human_agent_call_legs`, Realtime, and the reads made through the security-invoker roster;
  - every reader and writer in `src/components/console`, `src/lib/realtime`, `src/app/(admin)/**`,
    `src/app/api/**`, `src/lib/data/**` (including `admin/`), `src/lib/auth/console-agent.ts`, `worker/`
    and `supabase/functions/`, with client type and columns;
  - the Android contract (`docs/agent-console-api-contract.md`,
    `docs/voice-agent/app-integration-reference.md` §2–4);
  - how `route-inbound` sets `console_calls.event_id` (design Risks).

  Verify: no cell says "unknown", each row cites a file:line or a catalog query, and the SELECT on
  `console_queues`/`console_agent_queues` is confirmed or marked as Android-only.
- [x] 1.2 Record OQ1 and OQ2 as the owner's decisions, or keep them open with the default stated in
  design. Do not present them as facts. Verify: design Open Questions show the decision or the default,
  with its source.
- [x] 1.3 Parity fingerprint between production (read-only, `--linked`) and local: view definitions,
  functions, ACLs (`relacl`, `attacl`), policies, and role permissions. Verify: identical apart from
  recorded data drift (agents, `support_agent`).
- [x] 1.4 Decide whether the Data API tests can use committed agent fixtures. Run
  `src/lib/testing/cleanup.local-it.test.ts` and check that `FixtureScope` removes `console_agents`,
  `console_agent_secrets` and `platform_staff` rows created for a GoTrue user. Verify: either a passing
  cleanup case for those tables, or design D6 records that agent personas stay transaction-level.

## 2. Stage S1 — roster helper, secrets closed, shift hardened (D4, D5)

- [x] 2.1 Integration, written first. In `src/lib/auth/console-views.local-it.test.ts`, switch the
  fixture roles to an explicit permission set created inside the transaction, then add:
  - every persona `SELECT user_id` / `vox_password` on `console_agent_secrets` → `42501`;
  - roster `provisioned` for every agent equals its value captured before the migration, and an agent
    without a secret → `false`;
  - `console_agent_shift`, sent in PostgREST's upsert shape (`INSERT … ON CONFLICT (agent_id) DO UPDATE
    SET agent_id = excluded.agent_id, … RETURNING`): the active agent gets 1 row on both the insert and
    the conflict path, and the inactive agent gets `42501`;
  - the inactive agent's `UPDATE` with and without `WHERE` → 0 rows;
  - `has_table_privilege('authenticated', …, 'TRUNCATE' | 'TRIGGER' | 'REFERENCES' | 'MAINTAIN')` →
    false.

  Verify: run the file. Exactly the S1 cases are red, for those reasons; the existing cases are green.
- [x] 2.2 `npx supabase migration new console_roster_provisioned_helper_and_shift_grants`:
  - `public.console_agent_provisioned(uuid)` per D4, with its grants;
  - re-create `console_agents_roster` per D4: same columns and order, `security_invoker = on`;
  - drop `console_agent_secrets_select` and revoke all from `anon` and `authenticated`;
  - rebuild the shift grants and change `console_agent_shift_update_own` per D5.

  Verify: applied locally; 2.1 green; `console-findings.local-it.test.ts` green after its secrets and
  shift cases are flipped to the new expectations; fingerprint unchanged.
- [x] 2.3 Unit: add a static guard to `src/lib/supabase/console-view-grants.test.ts`. It asserts that
  the latest roster body does not join `console_agent_secrets` and does call
  `console_agent_provisioned(`. Run the mocked suites (`console-agent-provisioning.test.ts`,
  `src/app/api/voximplant/console/*/route.test.ts`, `src/app/api/agents/sdk-auth/route.test.ts`) as
  smoke tests only. Verify: all green. The mocked suites are recorded as non-evidence for RLS.

## 3. Stage S2 — one scope rule for the data views (D3a)

- [x] 3.1 Integration, written first. Create an out-of-scope event fixture (no campaign,
  `with_ai_calls = false`) with a guest and an RSVP. Assert:
  - every active persona gets 0 rows from `console_event_guests`, `console_rsvp_results`,
    `console_campaign_targets` and `console_call_analysis` for that event;
  - the in-scope rows and work columns are unchanged, including names, note and analysis;
  - `phone` is unchanged: `NULL` without `view_customer_data`, the value with it.

  Verify: only the out-of-scope cases are red.
- [x] 3.2 `npx supabase migration new console_views_event_scope`:
  - `public.console_event_in_scope(uuid)` per D3a, with its grants;
  - add it to the `WHERE` of the four views, and have `console_events` use it;
  - each view body is read from the live definition, so no column changes.

  Verify: applied locally; 3.1 green; `console-view-grants.test.ts` extended so the four data views
  contain `console_event_in_scope(` and all eight contain `is_console_agent()`; green.
- [x] 3.3 Workflow regression, integration. Run every workflow in the spec ("Console workflows keep
  working"), as the active agents, with the client statement shapes: `console_me`, the in-scope lists,
  the roster, own `console_calls`, `call_dispatch_status`, own `human_agent_call_legs`, chat read and
  insert, shift upsert, `agent_status` upsert, and `console_call_feed` claim and update. Verify: each
  returns the rows and columns captured before S1, with out-of-scope rows excluded.

  Realtime: S1–S3 change neither the policies nor the grants of `console_calls`, `console_call_feed` and
  `console_chat_messages`. The evidence is therefore the 4.1 inventory plus an unchanged `SELECT` policy
  text (catalog). A live Realtime subscription test needs committed changes, so it is added only if 1.4
  allows committed fixtures. Otherwise the gap is recorded in `verification-console.md`.

## 4. Stage S3 — helper path, privilege inventory, Data API layer

- [x] 4.1 Integration, privilege inventory. Evaluate `has_table_privilege` and `has_column_privilege`
  for `anon` and `authenticated` × every console object × `SELECT`, `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`, plus column privileges, against the D5 map. Check
  EXECUTE on the three helpers, and `search_path = ''` on all of them. Verify: red only for
  `is_console_agent()`'s `search_path`; each mismatch is printed as `<object>[.<column>] <role>
  <privilege>`.
- [x] 4.2 `npx supabase migration new console_agent_helper_search_path`: `alter function
  public.is_console_agent() set search_path = ''`, and add `(select public.is_console_agent())` to
  `human_agent_call_legs_update_own` (`USING` and `WITH CHECK`), which 4.1 found ungated (design D5,
  correction). Verify: applied locally; 4.1 green; the whole matrix of both integration files green.
  For `human_agent_call_legs`, a dedicated block in `console-views.local-it.test.ts` checks:
  - column privileges: UPDATE on `device_id` and `vox_sdk_call_id` only, no INSERT/DELETE, anon
    nothing;
  - an active agent, with `WHERE` (the Data API shape) and without it: only its own leg changes;
  - any other column: `42501`;
  - an inactive agent: 0 rows in all three statement forms;
  - a red check: with the pre-migration policy, the inactive agent's update does change its leg.

  Grants on the table are unchanged (`relacl`/`attacl` equal production).
- [x] 4.3 Integration, Data API. In a new `src/lib/auth/console-rest.local-it.test.ts`, make requests to
  local PostgREST `127.0.0.1:54321`:
  - anon on the 8 views: `401/42501`;
  - a regular user: 0 rows on views and readable tables, `403/42501` on `console_call_pii`,
    `console_agent_commands` and `console_agent_secrets`;
  - a filterless `PATCH` on `console_agent_shift`: `400/21000`.

  Add agent personas only if 1.4 allows. Verify: green; no row is committed; fingerprint unchanged.
- [x] 4.4 Local Advisors, and `verification-console.md` in this change. It holds the before/after
  catalog, the test runs with counts, and Appendix A's 73 findings with where each is closed. Verify:
  the document lists 73 unique IDs, and every claim the design marks "not verified" is still open or
  decided by the owner.
- [x] 4.5 Softphone mount gate: `admin/layout.tsx` requires `rpc('is_console_agent')`, failing closed
  on error (`44df8c9e`). Verify: `src/app/(admin)/admin/layout.test.tsx` 4/4 (red before the fix);
  lint, unit 13,173 and build green.

## Workflow follow-up

- After each stage, the owner reviews and runs `db push`. Then compare the live catalog read-only with
  the local result: the roster definition, view definitions, ACLs, policies and function settings.
  Record the comparison in `verification-console.md`.
