# Design

## Context

See proposal.md, Why. The evidence is held in Appendix A at claim level. Method codes: **BEH** ran as the
role in a rolled-back transaction; **SIM** applied a proposed DDL inside a rolled-back savepoint; **CAT**
queried the catalog on both the local and the production database; **REST** called local PostgREST;
**RUN** executed a test suite; **DOC**/**CODE** read the documents or the source.

### Live state (production = local, CAT, 21.10.2026)

| Object | Kind | `authenticated` privileges (`anon`: none) | Row rule |
|---|---|---|---|
| console_events | view, owner rights | SELECT | `is_console_agent()` AND (with_ai_calls OR has campaign) |
| console_campaigns, console_campaign_targets, console_event_guests, console_rsvp_results | view, owner rights | SELECT | `is_console_agent()` only |
| console_call_analysis | view, owner rights | SELECT | `call_attempt_id IS NOT NULL AND is_console_agent()` |
| console_me | view, owner rights | SELECT | `ca.user_id = auth.uid()` (no `is_console_agent()`) |
| console_agents_roster | view, `security_invoker=on` | SELECT | `WHERE is_console_agent()` + caller RLS on console_agents, agent_status, console_agent_secrets, console_agent_calendar_presence |
| console_agents | table | SELECT | select `is_console_agent()` |
| console_agent_secrets | table | column SELECT(user_id) | select `is_console_agent()` |
| console_agent_shift | table | `arwdDxtm` (incl. TRUNCATE, MAINTAIN) | select `is_console_agent()`; insert own AND `is_console_agent()`; update own only |
| console_call_feed | table | SELECT; column UPDATE(agent_id, handled_by, participation_state, takeover_claimed_at, takeover_request_id) | select `is_console_agent()`; update own/unclaimed |
| console_calls, console_queues, console_agent_queues, console_agent_calendar_presence | table | SELECT | `is_console_agent()` |
| console_chat_messages | table | SELECT; column INSERT(author_id, body, created_at, id) | select `is_console_agent()`; insert own author |
| agent_status | table | SELECT, INSERT, UPDATE | own + `is_console_agent()` (select: `is_console_agent()`) |
| call_dispatch_status | table | SELECT | `is_console_agent()` |
| human_agent_call_legs | table | SELECT; column UPDATE(device_id, vox_sdk_call_id) | select own AND `is_console_agent()`; update own only |
| console_call_pii, console_agent_commands | table | none | RLS on, no policy |
| `is_console_agent()` | SECURITY DEFINER, `search_path=public`, EXECUTE authenticated | – | `public.is_staff() and exists(console_agents where user_id = auth.uid() and vox_active)` |

Details:
- Only `console_campaign_targets` and `console_event_guests` have a `phone` column. It is masked by
  `CASE WHEN has_platform_permission('view_customer_data'::text) ...`, with no `(select ...)` wrapper.
- None of the console policies uses a permission key. The permission gates are in the routes
  (`requireConsoleAgent`, `manage_voice`, `campaigns.runstate`).
- The Realtime publication carries `console_calls`, `console_call_feed`, `console_chat_messages`,
  `agent_status`, `call_dispatch_status` and `human_agent_call_legs`.
- Both databases run PostgreSQL 17.6. `information_schema.role_table_grants` does not list `MAINTAIN`,
  but `has_table_privilege(..., 'MAINTAIN')` does.
- Data differs between the two, while the structure is the same:
  - production has 2 agents and the local database has none;
  - production has a `support_agent` role that holds `view_customer_data`;
  - locally, `auditor` lacks `view_customer_data` and `billing_clerk` holds it.

### Executed behaviour (BEH; `console-views.local-it.test.ts` 21/21, `console-findings.local-it.test.ts` 20/20)

| Caller | Result |
|---|---|
| anon | `42501` on every view and table; Data API `401/42501` |
| regular user, staff without agent row | 0 rows in views and readable tables; `42501` on secrets value, call_pii, agent_commands; insert `42501`, update/delete 0 rows; `TRUNCATE console_agent_shift` succeeds in SQL |
| inactive agent | `console_me` = 1 own row; other views 0; shift insert `42501`; shift `UPDATE … WHERE` 0 rows; shift `UPDATE` without `WHERE` 1 row (raw SQL only) |
| active agent, no `view_customer_data` | all console_events in scope; guests, RSVP (with note), targets and call analysis of **every** event, including events outside scope; phone `NULL`; rsvp_digit, chat body, console_calls ids readable; all 3 colleagues in console_agents and the roster; every agent's secret `user_id` |
| active agent with `view_customer_data` | the same plus phone |

Data API (REST, local PostgREST):
- A filterless `PATCH` is refused with `400/21000`.
- The `UPDATE` that PostgREST generates is `WITH pgrst_source AS (UPDATE … WHERE … RETURNING …)`.

### Work set (CAT on production, aggregates only)

Of 10 events, 8 are in console scope. Rows that reference an event outside it:

| Table | Rows outside scope / all rows |
|---|---|
| `console_calls` | 0 / 1267 (1244 have no event) |
| `console_call_feed` | 0 / 20 |
| call analyses | 0 / 18 |
| `call_attempts` | 0 / 20 |

## Goals / Non-Goals

**Goals:**
- Every console data view returns rows of console-scope events only, and the work data inside the scope
  is unchanged.
- Contact identifiers stay behind `view_customer_data`, and secrets reach no client.
- An inactive agent changes nothing, whatever the statement form.
- The client privilege map is exact and pinned by a test.
- Every console workflow keeps working, proven by integration tests.

**Non-Goals:**
- Hiding work data from active agents. Names, RSVP state, notes and call results are what agents call
  and record.
- Customer-table RLS; `security_invoker` on the owner-rights views.
- Moving Voximplant credentials; changing the calling flow.
- Production changes or deploys (the owner pushes).

## Decisions

**D1: Keep the owner-rights views, and enforce rules inside them.** `security_invoker = on` would apply
`events_org_select` and friends, which admit only owners and org members, so the console would be empty
(`20260720193844_harden_console_views_revoke_write.sql`). Rules live in view predicates and column
expressions, plus definer helpers where a rule must be shared.
Alternative: new base-table policies for agents. Rejected, because it widens customer tables' RLS for a
console concern.

**D2: Data classes follow the work, not membership.** The seven owner-rights views and the console
tables carry these classes:

| Class | Columns | Who sees |
|---|---|---|
| Work data | event identity, campaign state, guest name, RSVP state and answers (attending, adults, kids, rsvp_status, rsvp_digit), RSVP note, call analysis results, reach state, dial eligibility, chat body, console_calls ids and `caller_masked` | every active agent, in console scope |
| Contact identifier | `phone` (console_event_guests, console_campaign_targets) | active agent with `view_customer_data` (unchanged) |
| Colleague directory | console_agents, console_agents_roster | every active agent |
| Credential | `console_agent_secrets.vox_password` | no client (server path returns a hash only) |
| Server-only PII | console_call_pii (full E.164, session and recording URLs), console_agent_commands | no client |

Two classifications are open questions, not facts: `console_events.event_name` and other free text (OQ1),
and what the Android client does with a `NULL` phone (OQ2).
The earlier plan masked names, notes and analysis behind `view_customer_data`. It is withdrawn, because
it would stop agents from working. The reviewed defect is scope (D3a), not visibility to agents.

**D3: Console access stays `is_console_agent()`.**
- Provisioning an agent is already an owner-only act. A separate access key would duplicate it.
- `console_me` keeps returning the caller's own row to an inactive agent.
  `src/app/(admin)/admin/voice/console/page.tsx` and `layout.tsx` rely on it to tell "not registered"
  from "not active".
- The softphone mounts only when `is_console_agent()` is true (`admin/layout.tsx`, `44df8c9e`), the same
  check `/api/agents/sdk-auth` makes. Because `console_me` keeps returning the row to an inactive agent,
  that agent used to get a mounted softphone, which sdk-auth then refused with 403. `console_me` still
  supplies `vox_username` and `display_name`.
- `is_console_agent()` gets `search_path = ''`. Every reference in its body is already qualified, and the
  SIM run showed the answers unchanged.

**D3a: One scope rule, defined once.** A helper defines the rule:

```sql
public.console_event_in_scope(p_event_id uuid) returns boolean
  -- stable, security definer, set search_path = ''
  -- (select public.is_console_agent())
  --   and exists(event with_ai_calls or with a campaign)
```

- `EXECUTE` is granted to `authenticated` and revoked from `PUBLIC` and `anon`.
- `console_event_guests`, `console_rsvp_results`, `console_campaign_targets` and
  `console_call_analysis` add `AND public.console_event_in_scope(<event_id>)` to their `WHERE`.
- `console_events` and `console_campaigns` are already in scope by definition. `console_events` adopts
  the helper so the rule has one definition.
- It must be `SECURITY DEFINER`, because functions called from a view run as the caller, and the caller
  cannot read `events`.
- SIM: in-scope guests and RSVP are unchanged, out-of-scope rows are hidden, and the phone mask is
  unchanged.

**D4: `provisioned` is computed by a definer helper, and `console_agent_secrets` closes to every
client.** This replaces the old "secrets by ownership" decision.

```sql
public.console_agent_provisioned(p_user_id uuid) returns boolean
  -- stable, security definer, set search_path = ''
  -- (select public.is_console_agent())
  --   and exists(select 1 from public.console_agent_secrets where user_id = p_user_id)
```

- `EXECUTE` is granted to `authenticated`.
- `console_agents_roster` is re-created with `security_invoker = on`, the same columns and the same
  order, with `provisioned = (ca.vox_username IS NOT NULL) AND public.console_agent_provisioned(ca.user_id)`,
  and without the join to `console_agent_secrets`.
- `console_agent_secrets_select` is dropped, and all privileges are revoked from `anon` and
  `authenticated`.

SIM results:
- The roster is identical before and after, for both agent personas.
- An agent without a secret still shows `false`.
- The table answers `42501` for `user_id` and `vox_password`.
- A regular user calling the helper gets `false`, and `anon` gets `42501`.

The two old variants are rejected, because SIM broke both of them:
- an own-row policy, which made colleagues `false`;
- revoking without the helper, which made the roster `42501`.

**D5: Grants follow the access map, and policies change with the grants they protect.**

`console_agent_shift`:
- `revoke all` from `anon` and `authenticated`;
- `grant select`;
- `grant insert (agent_id, active, updated_at), update (agent_id, active, updated_at)`. `agent_id` is
  needed because the PostgREST upsert sets `agent_id = excluded.agent_id`;
- `console_agent_shift_update_own` gets `AND (select public.is_console_agent())` in `USING` and in
  `WITH CHECK`, in the same migration.

SIM results:
- The upsert in PostgREST's shape returns 1 row on both the insert path and the conflict path.
- The inactive agent's upsert is refused with `42501`, and its update without `WHERE` changes 0 rows.
- `TRUNCATE` is refused with `42501`, and `MAINTAIN` and `TRIGGER` are false.

`human_agent_call_legs` (found by the 4.1 inventory; S3, migration `20261021195752`):
- grants stay as they are: `SELECT`, and column `UPDATE (device_id, vox_sdk_call_id)` only. These are
  the two columns the app reports from the SDK on its own monitor leg (`app-integration-reference.md`
  §7). The server writes every other column, including the `requested` row;
- `human_agent_call_legs_update_own` gets `AND (select public.is_console_agent())` in `USING` and in
  `WITH CHECK`. No grant changes.

Result, executed on the local database after the migration:
- an active agent updates `device_id` and `vox_sdk_call_id` on its own leg, with or without `WHERE`;
  1 row, and another agent's leg does not change;
- an update of any other column (`status`, `agent_id`) is refused with `42501`;
- an inactive agent changes 0 rows, both with `WHERE` and without it, in raw SQL.

Every other console object keeps today's privileges, which equal the map below. They are pinned by the
inventory test, not rebuilt.

**Console access map, target state for `authenticated`.** `anon` and `PUBLIC` hold nothing on any of
these objects.

| Object | Privileges |
|---|---|
| 8 console views | SELECT |
| console_agents, console_calls, console_queues, console_agent_queues, console_agent_calendar_presence, call_dispatch_status | SELECT |
| human_agent_call_legs | SELECT; UPDATE (device_id, vox_sdk_call_id) only, which the app writes on its own monitor leg (`app-integration-reference.md` §7) |
| console_agent_shift | SELECT; INSERT, UPDATE (agent_id, active, updated_at) |
| console_call_feed | SELECT; UPDATE (agent_id, handled_by, participation_state, takeover_claimed_at, takeover_request_id) |
| console_chat_messages | SELECT, INSERT (table level; the insert policy requires an active agent writing as itself) |
| agent_status | SELECT, INSERT, UPDATE |
| console_agent_secrets, console_call_pii, console_agent_commands | none |
| `is_console_agent()`, `console_event_in_scope(uuid)`, `console_agent_provisioned(uuid)` | EXECUTE |

Task 1.1 confirms the SELECT grants on `console_queues` and `console_agent_queues`: there is no
user-session reader in this repository, and the Android contract decides.

**Correction found by the inventory (task 4.1, live on both databases, 21.10.2026).** Two rows of the
first version of this map were wrong; the map above shows the live state:
- `console_chat_messages` holds table-level INSERT, not column-level (`relacl authenticated=ar`).
  `information_schema.column_privileges` expands a table grant per column, which is how the earlier
  reading went wrong.
- `human_agent_call_legs` holds column UPDATE on `device_id` and `vox_sdk_call_id`. Its update policy,
  `human_agent_call_legs_update_own`, checked ownership only. That is the same flaw as the shift
  (G2): an inactive agent could change its own leg with an `UPDATE` without `WHERE` in raw SQL. Of all
  the client write policies on console objects, it is the only one without `is_console_agent()`
  (checked in `pg_policies`). The spec requirement "An inactive agent keeps only its own profile"
  covers it, so S3 adds the gate, with a red/green integration case.

**Console access map: readers and writers (task 1.1, live sources, 21.10.2026).** Client types:
- **U**: user session, either the browser `createClient` from `@/lib/supabase/client` or the server
  cookie client;
- **B**: the Bearer JWT client in `requireConsoleAgent`
  (`src/lib/auth/console-agent.ts:43`), which acts as the agent;
- **S**: service role (`createAdminClient`), which RLS and grants do not affect;
- **A**: the Android app with the agent's JWT, per `docs/voice-agent/app-integration-reference.md` §2–4
  and `docs/agent-console-api-contract.md:66,140-141`.

| Object | Client reads (who, where) | Client writes (who, where) | Server-only access |
|---|---|---|---|
| console_me | U `admin/layout.tsx:116`, `admin/voice/console/page.tsx:18`; A §2 | – | – |
| console_events, console_campaigns, console_rsvp_results, console_call_analysis | A §2 | – | – |
| console_event_guests | U `softphone-panel.tsx:515` (guest card: guest_name, rsvp_status, phone); A §2 (the dial list) | – | – |
| console_campaign_targets | A §2 | – | – |
| console_agents_roster | U `softphone-panel.tsx:312` (provisioned gates dial/transfer/consult targets, `roster-dial-button.tsx:60`, `call-bar.tsx:230`) | – | – |
| console_agents | through the roster (security invoker) | – | S provisioning, history |
| console_agent_secrets | through the roster only (`cas.user_id`) | – | S `console-sdk-auth.ts:77-90` (reads vox_password, returns a hash); S provisioning writes |
| console_agent_shift | U `admin/layout.tsx:129` (own row) | B `api/agents/shift/route.ts:76-81` upsert (agent_id, active, updated_at) | – |
| agent_status | U `softphone-panel.tsx:303`; through the roster; A §2 | B `api/agents/status/route.ts:48` upsert own row; A (`agent-console-api-contract.md:140`) | – |
| console_calls | U `softphone-panel.tsx:480`, `call-bar.tsx:144`; Realtime | – | S `console-calls.ts`, `admin/console-history.ts` |
| console_call_feed | U `ai-handoff-section.tsx:112`; Realtime; A §2 | U `ai-handoff-section.tsx:199` claim/update (5 columns); A takeover columns | S |
| console_chat_messages | U `softphone-panel.tsx:562`; Realtime | U `chat-section.tsx:77` insert (author_id, body) | – |
| call_dispatch_status | A §2 (status channel after a 202); Realtime | – | S |
| human_agent_call_legs | U `ai-handoff-section.tsx:138`; A §7; Realtime | – | S writes the `requested` row |
| console_queues, console_agent_queues | none found in this repository or the Android contract | – | S `console-queues.ts` (layout membership read, writes) |
| console_agent_calendar_presence | through the roster | – | S `console-agent-calendar-presence.ts`, worker cron `worker/main.ts:1608-1618` |
| console_call_pii, console_agent_commands | none | – | S `console-calls.ts`, `console-agent-commands.ts:44` |
| `is_console_agent()` | B `console-agent.ts:71` (route gate); every console policy | – | – |

Notes:
- `src/lib/voximplant/*` and `supabase/functions/*` reach no console object; their mentions are only
  comments.
- **Queues:** no user-session reader exists, so the SELECT on `console_queues` and
  `console_agent_queues` is kept unchanged, as D5 requires. It becomes a candidate for revoking once the
  Android source has been checked (OQ2).
- **`route-inbound` and manual calls:**
  - 1244 of the 1267 calls in production carry no event, and every call that has one is in console
    scope.
  - A manual `guest_service` call takes `(eventId, contactId)` from the client.
    `src/lib/data/console-calls.ts:964-983` checks that the pair exists, but not that it is in console
    scope.
  - After S2 an agent can no longer list out-of-scope guests, so the UI never offers them. A crafted
    request is a server-authorization question, recorded under Risks. RLS does not cover it.

**D6: The verification is layered, and only real execution counts as proof.**
- **Integration (primary).** Two `*.local-it.test.ts` files run through
  `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh <file>`. They use one connection and one
  transaction ending in ROLLBACK, impersonate as PostgREST does (`SET LOCAL ROLE` +
  `request.jwt.claims`), and cover the six caller kinds × all console objects × the operations in the
  spec, including the workflow statement shapes (upsert with `RETURNING`).
  - Fixture roles get an explicit permission set inside the transaction, not seeded role contents.
  - `console-views.local-it.test.ts` changes in place: its secrets cases move to `42501`, and scope
    cases are added. Its M1 cases stay as they are, because work data stays visible by design.
- **Privilege inventory (integration).** `has_table_privilege` and `has_column_privilege` are evaluated
  for every role × object × privilege, `MAINTAIN` included, against the access map. A mismatch is
  reported as `<object>[.<column>] <role> <privilege>`. This does not use `information_schema`, which
  omits `MAINTAIN`.
- **Data API (integration).**
  - Requests to local PostgREST as `anon` and as a regular user, which need no committed rows: anon
    `401/42501`, regular 0 rows, closed tables `403/42501`, filterless `PATCH` `400/21000`.
  - Agent personas over HTTP need committed agent rows. They are added only if task 1.4 proves that
    `FixtureScope` cleanup removes `console_agents`, `console_agent_secrets` and `platform_staff` rows.
    Otherwise the transaction-level tests stand in, and the gap is recorded.
  - **Decision (task 1.4, 21.10.2026): agent personas stay at transaction level.** The catalog shows the
    cascade, so deleting the fixture's `auth.users` row would remove `platform_staff` → `console_agents`
    → `console_agent_secrets` / `agent_status` / `console_agent_shift` (all `ON DELETE CASCADE`), and
    `FixtureScope.cleanup` deletes `auth.users` last (`local-integration.ts:573`). But no cleanup case
    proves it for console rows. Committing agent fixtures would also add risk to the shared local
    database without new coverage: the REST layer is shown to be the same mechanism (role + claims)
    through the anonymous and regular callers. The remaining gap: agent personas over HTTP and a live
    Realtime subscription.
- **Unit (static guards).**
  - `src/lib/supabase/console-view-grants.test.ts` is extended so the latest body of every console view
    contains `is_console_agent()`, and the four data views also contain `console_event_in_scope(`.
  - A new static test asserts that the roster body no longer joins `console_agent_secrets`.
- **Not evidence.** The mocked route and provisioning suites (`console-agent-provisioning.test.ts`,
  `voximplant/console/*/route.test.ts`) pass with no database. They run as smoke tests only.

## Risks / Trade-offs

- **[A future inbound call is linked to an event outside console scope, and the guest card goes
  empty.]** Today 0 of 1267 calls do this.
  → Task 1.1 measured that 1244 of 1267 calls carry no event, and those that do are all in scope (0).
  → Manual calls take `(eventId, contactId)` from the client and the server checks only that they exist.
  Adding a scope check there is a server-authorization follow-up, outside this RLS change.
- **[A third client relies on reading `console_agent_secrets.user_id` directly.]**
  → None is found in the repository or the Android contract. Task 1.1 re-checks the contract before S1.
  → Rollback re-grants the column and restores the policy.
- **[The roster re-definition drifts from the live columns.]**
  → The migration reads the live definition first, and SIM proved the same output.
  → The static guard pins the shape.
- **[The `.env.local` port overrides the CLI.]**
  → Pass the port on the command (`SUPABASE_DB_PORT=54322`), never in `.env.local`. Its value 5432
  belongs to production's pooler.
- **[The local data lacks `support_agent`.]**
  → Tests create their own permission sets.
  → Task 1.3 re-runs parity before each stage.

## Migration Plan

Each stage follows the same steps:
1. Tests are written first and are red for the stated reason only.
2. One migration (`npx supabase migration new <name>`), with a rollback header read from the live
   catalog.
3. Applied locally; the tests turn green.
4. The owner reviews and runs `db push`.
5. A read-only live comparison.

The stages:
- **S0: evidence, no schema change.** Access map, scope check of `route-inbound`, parity, and
  `FixtureScope` capability.
- **S1:** D4, which covers the roster helper and closing the secrets table, and D5 for
  `console_agent_shift`.
- **S2:** D3a, the scope helper and the four views plus `console_events`.
- **S3:** the `search_path` of `is_console_agent()`, the `is_console_agent()` gate on
  `human_agent_call_legs_update_own` (found by the 4.1 inventory), the privilege inventory, the static
  guards and the verification document.

Rollback per stage re-creates the previous view definitions, policies, grants and function settings from
the header. Nothing in this plan changes data.

## Open Questions

- **OQ1 (V-16). Is any view column personal data that needs its own class?** `console_events.event_name`
  may contain a customer's name. Free text (`rsvp_responses.note`, chat `body`) may contain anything.
  `console_campaign_targets.contact_id`, `stop_reason`, `reached_channel` and
  `console_event_guests.dialable` have not been classified. Not verified: answering needs production row
  content, which this review does not read.
  - Default until decided: treat them as work data.
  - Decision input: an aggregate-only measurement agreed with the owner (for example, how many event
    names equal the owner's profile name), or the owner's ruling.
  - **Status (task 1.2):** open. The default (work data) applies to this implementation, and no column
    changes class.
- **OQ2 (W-07, W-11). How does the Android app handle these columns?** The in-repo contract models
  `phone` as nullable (`docs/voice-agent/app-integration-reference.md:42,87`). Neither point below is
  verified, because the app's source is in another repository and the contract was written from commit
  `cc89325`:
  - the app's current DTO nullability;
  - whether it reads `console_agent_secrets`, `console_queues` or `console_agent_queues`.

  This plan adds no new `NULL` and removes no column. The risk is limited to tables the app might read
  directly. Decide before S1 by checking the app source.
  - **Status (task 1.2, owner instruction 21.10.2026):** Android work is deferred to a separate round and
    is out of scope here. The shared data-contract changes that may need app work later are recorded in
    `verification-console.md`, section "Android contract impact". Before the production push, they are
    re-checked against what was actually implemented.
- **OQ3 (P22).** Does `openspec archive` drop the delta's `## Purpose` section? It has not been run,
  because archiving writes files. Check when archiving.

## Appendix A — Review findings, verified at claim level (73 unique IDs)

Generated from one source (`findings.py`). A finding is CONFIRMED when all its claims are confirmed.
MIXED findings list each claim's verdict separately and are not counted twice.

73 unique findings, 97 claims: 89 confirmed, 2 refuted, 6 not verified. Per finding: 65 fully confirmed, 8 mixed (claim-level below), 0 refuted, 0 not verified. Requirement names refer to the spec requirements; D/OQ/S refer to this design.

| ID | Reviewer | Result | Claims (verdict, method) | Addressed in |
|---|---|---|---|---|
| V-01 | VIEWS | CONFIRMED | confirmed (BEH): console_me returns the inactive agent its own row<br>confirmed (DOC): spec R1 and R3 contradict for an inactive agent | spec: inactive agent, D3 |
| V-02 | VIEWS | CONFIRMED | confirmed (CAT): only console_events applies the AI-calls-or-campaign scope<br>confirmed (BEH): an agent reads guests and RSVP of an out-of-scope event | spec: work scope, D3a, S2 |
| V-03 | VIEWS | CONFIRMED | confirmed (CAT): the phone column exists only in console_campaign_targets and console_event_guests | Context |
| V-04 | VIEWS | CONFIRMED | confirmed (CAT): roster filters on is_console_agent() and joins 4 base tables<br>confirmed (CAT+BEH): provisioned is computed from console_agent_secrets.user_id | D4, S1 |
| V-05 | VIEWS | CONFIRMED | confirmed (CAT): there are 8 console views, not 7 | Context, spec: non-agents |
| V-06 | VIEWS | CONFIRMED | confirmed (CAT+DOC): RSVP answer columns exist and the old scenario/task omitted them | D2 column classes |
| V-07 | VIEWS | CONFIRMED | confirmed (DOC): "needed to work" and "absent or masked" were undefined | spec: work scope, spec: contact identifiers |
| V-08 | VIEWS | CONFIRMED | confirmed (BEH): an agent without view_customer_data reads rsvp_digit, chat body and console_calls ids | D2 column classes |
| V-09 | VIEWS | CONFIRMED | confirmed (CODE+REST): the in-repo web softphone reads console views with the user session | Impact, spec: workflows |
| V-10 | VIEWS | CONFIRMED | confirmed (BEH): every active agent reads every console_agents row | spec: profile and directory |
| V-11 | VIEWS | CONFIRMED | confirmed (DOC): the single positive scenario could not prove "never another agent" | spec: profile and directory |
| V-12 | VIEWS | CONFIRMED | confirmed (CAT): the live phone mask has no (select ...) wrapper<br>confirmed (CAT): console_me filters on ca.user_id = auth.uid(), not is_console_agent() | D1, D3 |
| V-13 | VIEWS | CONFIRMED | confirmed (DOC): the "permitted agent sees today's data" rule was phrased with different personas | spec: contact identifiers |
| V-14 | VIEWS | CONFIRMED | confirmed (DOC): the spec named no permission key | spec: contact identifiers |
| V-15 | VIEWS | CONFIRMED | confirmed (CAT): views carry no SECURITY DEFINER attribute; they run with owner rights (reloptions empty) | Proposal wording |
| V-16 | VIEWS | MIXED | confirmed (DOC+CAT): several view columns were not classified<br>not verified (needs production row data): event names may contain customer personal data | Open question OQ1 |
| S-01 | SECRETS | CONFIRMED | confirmed (CAT+CODE): the roster is the client reader of secrets.user_id<br>confirmed (SIM): old D4 own-row policy makes colleagues provisioned=false<br>confirmed (SIM): old D4 alternative makes the roster fail with 42501<br>confirmed (CODE): provisioned gates dial/transfer/consult targets in the softphone | D4 (replaced), S1 |
| S-02 | SECRETS | CONFIRMED | confirmed (CAT+RUN+CODE): vox_password reaches no client; the only reader returns a hash | Context |
| S-03 | SECRETS | CONFIRMED | confirmed (CAT): service_role holds SELECT on vox_password and bypasses RLS<br>confirmed (CAT): no function or view exposes vox_password | spec: secrets wording |
| S-04 | SECRETS | CONFIRMED | confirmed (DOC): "only where a console path needs it" was untestable<br>confirmed (BEH): every active agent lists every secret row today | spec: secrets |
| S-05 | SECRETS | CONFIRMED | confirmed (CAT+BEH): console_agent_commands is closed exactly like console_call_pii | spec: closed tables |
| S-06 | SECRETS | CONFIRMED | confirmed (SIM): 42501 alone does not prove RLS (still 42501 with RLS disabled) | spec: closed tables shape scenario |
| S-07 | SECRETS | CONFIRMED | confirmed (BEH): non-agents get 42501, not zero rows, on closed tables | spec: non-agents outcomes |
| S-08 | SECRETS | CONFIRMED | confirmed (CODE(migration)): 20260827123914 added the secrets grant/policy on purpose for the roster | Context |
| S-09 | SECRETS | CONFIRMED | confirmed (RUN): the vox_password case is already green<br>confirmed (RUN): the 2.3 suites are mock-only and pass without a database | D6 |
| S-10 | SECRETS | CONFIRMED | confirmed (CAT): 1267 is a pg_stat estimate; the local table is empty | Context (removed) |
| S-11 | SECRETS | CONFIRMED | confirmed (DOC): old D4 text was unwrapped and unqualified | D4 (replaced) |
| G1 | GRANTS | CONFIRMED | confirmed (CAT+BEH): authenticated holds MAINTAIN on console_agent_shift | D5, S1 |
| G2 | GRANTS | MIXED | confirmed (CAT): console_agent_shift_update_own has no is_console_agent()<br>confirmed (BEH): an inactive agent can update its own shift row in raw SQL without WHERE<br>REFUTED (REST+BEH): an inactive agent can update its own shift row through a client (PostgREST) | spec: inactive agent, D5, S1 |
| G3 | GRANTS | MIXED | confirmed (BEH): a non-agent gets 42501 on insert and 0 rows on update/delete<br>confirmed (BEH): authenticated can TRUNCATE console_agent_shift in SQL<br>not verified (inferred; PostgREST has no TRUNCATE operation, not exhaustively tested): no client channel can issue TRUNCATE | spec: non-agents, D5 |
| G4 | GRANTS | CONFIRMED | confirmed (CAT): the shift policies differ from the old design wording | Context |
| G5 | GRANTS | CONFIRMED | confirmed (CAT+BEH): agent_status, call_dispatch_status, human_agent_call_legs are gated by is_console_agent() | spec Purpose |
| G6 | GRANTS | CONFIRMED | confirmed (CAT): information_schema omits MAINTAIN | spec: privilege map method |
| G7 | GRANTS | CONFIRMED | confirmed (DOC): R6 excluded views and PUBLIC | spec: privilege map |
| G8 | GRANTS | CONFIRMED | confirmed (CAT+BEH+CODE): queues, agent queues and presence are SELECT-only for clients; writes use the service role | spec: workflows |
| G9 | GRANTS | CONFIRMED | confirmed (DOC): the shift grant rebuild was duplicated across S1 and S3 | D5 |
| G10 | GRANTS | CONFIRMED | confirmed (CAT): the table rows and is_console_agent() facts are accurate | Context |
| G11 | GRANTS | CONFIRMED | confirmed (SIM): search_path='' on is_console_agent() keeps correct answers | D3 |
| W-01 | WORKFLOWS | CONFIRMED | confirmed (CODE+REST): the web admin softphone is a user-session console client<br>confirmed (CODE): queues and presence are read only through the service role | Impact |
| W-02 | WORKFLOWS | CONFIRMED | confirmed (CODE): provisioning runs from /admin/roles, not /admin/voice | Impact |
| W-03 | WORKFLOWS | CONFIRMED | confirmed (CODE+CAT): the old R7 list missed real workflows and listed queues | spec: workflows |
| W-04 | WORKFLOWS | CONFIRMED | confirmed (SIM): old D4 breaks the roster provisioned flag | D4 (replaced) |
| W-05 | WORKFLOWS | CONFIRMED | confirmed (RUN): task 2.3 could not turn red | D6 |
| W-06 | WORKFLOWS | CONFIRMED | confirmed (CAT+CODE): task 1.1 omitted the roster and several sources; voximplant/functions have no console access | Task 1.1 |
| W-07 | WORKFLOWS | MIXED | confirmed (DOC): the Android contract is in the repo and models phone as nullable<br>confirmed (DOC): nothing in the repo evidences strict parsing / a crash on NULL<br>not verified (separate repository): the Android app's current DTO nullability | Open question OQ2 |
| W-08 | WORKFLOWS | CONFIRMED | confirmed (DOC): the workflow list was repeated with different subsets | spec: workflows |
| W-09 | WORKFLOWS | CONFIRMED | confirmed (CAT+CODE): no console policy uses a permission key; gates are route-level | spec: workflows |
| W-10 | WORKFLOWS | CONFIRMED | confirmed (CAT+CODE): console_agent_shift originates in 20260812200243 and holds MAINTAIN | Context |
| W-11 | WORKFLOWS | MIXED | confirmed (DOC): the repo documents that Android reads the console views<br>not verified (documents come from app commit cc89325): the documents describe the app as it is today | OQ2 |
| P01 | PROOF | CONFIRMED | confirmed (BEH): design said inactive agent gets 0 rows; console_me returns 1 | spec: inactive agent |
| P02 | PROOF | MIXED | confirmed (BEH): console_me returns the inactive agent its row<br>REFUTED (REST+BEH): an inactive agent can write its shift through a client<br>confirmed (BEH): an inactive agent can write its shift in raw SQL | spec: inactive agent |
| P03 | PROOF | CONFIRMED | confirmed (CODE+CAT): the test relies on seeded roles | D6 |
| P04 | PROOF | CONFIRMED | confirmed (CODE): key-holder notes/analysis were not asserted | spec: contact identifiers |
| P05 | PROOF | MIXED | confirmed (CODE+CAT): the only grant inventory covers console_agent_secrets via information_schema<br>not verified (needs a committed grant; shown by code only): a wider grant elsewhere would leave the current test green | spec: integration proof, task 2.1 |
| P06 | PROOF | CONFIRMED | confirmed (DOC): proposal and design described the flipping cases differently | D6 |
| P07 | PROOF | CONFIRMED | confirmed (CODE): the test covered 8 of 19 objects and not the roster<br>confirmed (SIM): S1 changes the roster output | spec: integration proof |
| P08 | PROOF | CONFIRMED | confirmed (CAT): "seven views" where eight exist | Context |
| P09 | PROOF | CONFIRMED | confirmed (CAT+DOC): MAINTAIN missing from proposal and task 2.1 | S1 |
| P10 | PROOF | CONFIRMED | confirmed (CODE(config glob)): run-local.sh without a file runs every local-it file | Ground rules |
| P11 | PROOF | CONFIRMED | confirmed (SIM): old D4 alternative contradicted R4 and the roster | D4 (replaced) |
| P12 | PROOF | CONFIRMED | confirmed (RUN+CODE): the shift upsert user-session path had no test | S1 tasks |
| P13 | PROOF | CONFIRMED | confirmed (DOC): section 1 was not labelled S0 | Tasks |
| P14 | PROOF | CONFIRMED | confirmed (DOC): the parity re-run was promised but not in the tasks | Tasks |
| P15 | PROOF | CONFIRMED | confirmed (DOC): the per-agent key decision had no task | D2 (no masking change, so no per-agent decision) |
| P16 | PROOF | CONFIRMED | confirmed (CAT+BEH): R5 named only console_call_pii | spec: closed tables |
| P17 | PROOF | CONFIRMED | confirmed (DOC): search_path on is_console_agent() had no requirement | spec: privilege map |
| P18 | PROOF | CONFIRMED | confirmed (DOC): proposal said "possibly a new key" while D2 reused one | Proposal |
| P19 | PROOF | CONFIRMED | confirmed (RUN): console-view-grants.test.ts pins the 8 views | D6 |
| P20 | PROOF | CONFIRMED | confirmed (BEH): "every console view and table" while S2 covered views only | D2 |
| P21 | PROOF | CONFIRMED | confirmed (RUN(git)): the test file and change were untracked | Proposal wording |
| P22 | PROOF | MIXED | confirmed (RUN): openspec validate --strict is valid with 8 ADDED deltas<br>not verified (archive writes files; not run): archiving drops the delta Purpose section | OQ3 |
| P23 | PROOF | CONFIRMED | confirmed (CAT+RUN): the counts 11 tables, 2 agents, 21 cases, 6 personas are correct | Context |
| P24 | PROOF | CONFIRMED | confirmed (CAT+BEH): "console table" was undefined and the 3 gated tables were excluded | spec Purpose |
