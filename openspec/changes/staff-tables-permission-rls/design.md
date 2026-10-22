# Design

## Context

See proposal.md for the motivation. Constraints that shape the approach:

**The documented model today.** Migration `20260910090301` made `is_platform_staff()` the database
floor and `src/lib/auth/dal.ts` records the reasoning: fine-grained permissions are checked in the data
layer (`admin-data-layer-coverage.test.ts` pins every module to a permission and fails closed on a new
one), not in RLS. `scripts/check-permission-deny-matrix.sql` already proves, on impersonated sessions,
that `has_platform_permission()` withholds permissions from non-owner roles. What no test proves is
what the *tables* admit. The permission catalog has 17 permissions and 5 roles (owner;
`ops_engineer`: settings, voice, integrations, webhooks, runstate; `billing_clerk`: billing,
customer data; `auditor`: `view_*`, `integrations.read`; `support_agent`: view-only).

**Why the model is no longer uniform.** These already call `has_platform_permission` inside RLS:
- `rdp_access_*` (6.10);
- `app_settings` (13.10, by hand on the live database, recorded in `20261013021137`);
- `company_profile`;
- `voice_purposes` and `voice_purpose_attempts` (15.10, `20261015114659`).

The other 23 tables sit on the floor. This was re-read on the live catalog on 19.10.2026: 6 policies
call `has_platform_permission`. On 21.10.2026 the 23 tables were re-read again: 23 policies on the
floor, 2 on a permission (the two `voice_*` tables). The `dal.ts` reason for avoiding permissions in RLS (cost per
row; JWT claims going stale) does not apply to the table-lookup approach with the `(select …)`
initplan wrapper, which the project already uses.

**A local end-to-end reproduction exists and records today's behaviour.**
`src/lib/auth/permissions.local-it.test.ts` (21.10.2026, run with `scripts/integration/run-local.sh`)
drives real local GoTrue users through PostgREST, the DAL, CASL and the package Server Action. Its
`packages` and `webhook_inbox` cases assert the CURRENT, permissive results (every staff member reads,
writes and deletes). They pass today and are expected to fail once S1 (`webhook_inbox` closed) and S4
(`packages` on `manage_billing`) apply locally, so each of those stages flips the matching cases in the
same commit as its migration (tasks 2.3 and 5.3).

**Measured on the live catalog, 13.10.2026 (read-only):**
- 23 tables on the floor: 20 with a single policy, 3 (`channels`, `faq_items`, `packages`) with an
  extra public/authenticated read policy. `channels_admin_all` is scoped to `public`, not
  `authenticated`.
- Default ACL for tables created by `postgres` and `supabase_admin` in `public` grants `arwdDxtm` to
  `anon`, `authenticated`, `service_role`. Result: `anon` holds every privilege on 9 of the 23 tables;
  `authenticated` holds truncate/trigger/references on most. Systemic: 35 of 125 public tables give
  `anon` a write grant; all 125 have RLS enabled.
- `SECURITY DEFINER` functions touching these tables: 13. Seven are service-role only (EXECUTE
  revoked from `authenticated`). Six are callable by `authenticated`: `fleet_answer_request`,
  `fleet_goal_abandon`, `fleet_goal_create`, `fleet_goal_pause`, `fleet_goal_resume`,
  `fleet_owner_request`.
  - On 13.10 these six gated on the retired `has_role(uid,'admin')`, and so did the policies
    `voice_purposes_admin_all` and `voice_purpose_attempts_admin_read`.
  - **Update 19.10.2026 (live catalog):** `20261015114659` moved the six RPCs to
    `has_platform_permission('manage_settings')` and the two policies to `manage_voice`. All six RPCs run
    with `search_path = ''`. Stage 2 (`20261015134735`) dropped `has_role`, `user_roles` and `app_role`.
    0 functions and 0 policies reference `has_role`.
- `SECURITY INVOKER` functions touching them: `upsert_provider_number` (called with the user
  session from `provider-numbers.ts`); three fleet trigger functions (`fleet_goals_guard`,
  `fleet_requests_guard`, `fleet_requests_no_truncate`); `fleet_consume_request`,
  `integrations_delete_credential` and `wake_parked_workflow_run` (called with the service role).
  No views.
- No Realtime consumer reads these tables (the workflow files explicitly avoid `postgres_changes`);
  Edge Functions (`mcp`, `sms-hook`) do not touch them; the browser Supabase client is used only for
  passkeys, the Voximplant SDK and console channels.

**Access map, resolved 22.10.2026 (task 1.1).** "User session" means the cookie client
(`createClient()`, the staff member's own JWT); "service" means `createAdminClient()`. Sources:
- **Code:** every `.from('<table>')` of the 25 tables in `src/`, `worker/`, `scripts/` and
  `supabase/functions/` (198 non-test sites), with the client created in the enclosing function and the
  gate it calls. A function that takes the client as a parameter is resolved by its callers: every
  such caller passes `createAdminClient()` (`nav-counts.ts:86`, `policy-config.ts:91`,
  `outreach-engine.ts`, `vox-log-export.ts`, `store.ts`, `owner-agent/tools/system-health.ts:47`,
  `worker/main.ts:1630`, `scripts/fleet-agent-cli.ts`), except `readPolicyRow`, below. `worker/` names
  none of the tables directly; `scripts/` reach them only through `createAdminClient()`.
- **Catalog (live, read-only, 22.10.2026; local identical):** grants via `has_table_privilege` for
  `anon` and `authenticated`, policies from `pg_policies`. No view and no Realtime publication reads any
  of the 25 tables. The client-executable functions that touch them are the six `fleet_*` RPCs
  (definer, gated on `manage_settings`), the three fleet trigger functions and
  `upsert_provider_number` (invoker); every other function that names one is service-only.
- **Grant letters:** D delete, I insert, R references, S select, T truncate/trigger, U update; `–` none.
  Stage 0 removed every `anon` privilege except `SELECT` on `packages` and `faq_items`.

| Table | Sensitivity | User-session access in code (gate) | Today, live 22.10: authenticated / anon | Policies today | Target |
|---|---|---|---|---|---|
| otp_challenges | critical (OTP hashes) | none (service: `otp.ts` ×5) | DIRSTTU / – | `otp_challenges_admin_all` (all, floor) | **close** |
| agreement_documents | critical (contract, approval) | none (service: `agreements-doc.ts`, `admin/agreements.ts`) | DIRSTTU / – | `agreement_documents_admin_all` (all, floor) | **close** |
| webhook_inbox | high (raw payloads) | none (service: `webhooks.ts`, `admin/webhook-inbox.ts`, `whatsapp-import.ts`, `owner-agent/cores/system-health.ts`, `admin/webhooks/actions.ts`) | DIRSTTU / – | `webhook_inbox_admin_all` (all, floor) | **close** |
| workflows | med-high (definitions) | none (service ×16: `admin/workflows.ts`, `workflow/store.ts`, `guest-actions.ts`, `sumit-trigger-subscriptions.ts`) | DISU / – | `workflows_admin_all` (all, `public`, floor) | **close** |
| workflow_runs, _events, _steps | medium | none (service: `workflow/store.ts`, `stream.ts`, `admin/workflows.ts`, `runs/[runId]/stream/route.ts`) | S / – | one `select` policy each (`public`, floor) | **close** |
| webhook_deliveries | medium | none (service: `webhooks.ts`, `admin/webhook-inbox.ts`) | S / – | `webhook_deliveries_admin_select` (`public`, floor) | **close** |
| outreach_template_failures | low | none (service: `outreach.ts:172`, callers in `outreach-engine.ts`) | DIRSTTU / – | `outreach_template_failures_admin_all` (all, floor) | **close** |
| vox_log_exports | medium | none (service: `vox-log-export.ts`, `admin/voice-ops.ts`) | DIRSTTU / – | `vox_log_exports_admin_read` (select, floor) | **close** |
| voice_purpose_attempts | high (holds the bearer `access_token` of the public ctx route) | none (service: `voice-purpose-dispatch.ts:112`, `voice-purpose-attempts.ts:53,98,125,168`, `purpose/[purpose]/ctx/[token]/route.ts:49`, `elevenlabs-analysis.ts:71,185,286`) | S / – | `voice_purpose_attempts_admin_read` (select, `manage_voice`) | **close** (D1) |
| packages | high (prices) | `admin/packages.ts` select/insert/update/delete through `requirePlatformAction(<op>, 'Package')` = `PLATFORM_ACTIONS.Package` (`manage_billing`); service readers: `package-offers.ts`, `agent-benefits.ts`, `admin/offers.ts`, `admin/coupon-assignments.ts` | DIRSTTU / S | `packages_admin_all` (all, floor); `packages_public_read` (select, anon+authenticated, `active = true`) | per operation from `PLATFORM_ACTIONS.Package` (D10); public read kept |
| call_dnc_list | high (legal) | `admin/call-dnc.ts` `addToCallDnc` upsert, `listCallDnc` select (`manage_voice`); service writers: call-result, sales and callback voice processing | DIRSTTU / – | `call_dnc_list_admin_all` (all, floor) | `manage_voice` select, insert, update |
| call_compliance_settings | high (consent/DNC gates) | `admin/call-dnc.ts` select/update, `admin/voximplant-channel.ts` select/update (`manage_voice`); service reader `call-compliance-settings.ts` | SU / – | `call_compliance_settings_staff_all` (all, floor) | `manage_voice` select, update |
| provider_numbers | med-high | `admin/integrations/provider-numbers.ts`: `listProviderNumbers` select (`manage_settings`), `deactivateMissingMetaNumbers` update (from `syncMetaNumbers`, `manage_settings`), RPC `upsert_provider_number` (invoker; `manage_settings` or `manage_voice` by provider); `admin/owner-agent.ts` select (owner) | DISU / – | `provider_numbers_admin_all` (all, floor) | `manage_settings` OR `manage_voice`, select/insert/update |
| provider_number_roles | medium | `provider-numbers.ts` `assignRole` upsert, `clearRole` delete (`manage_settings` or `manage_voice` by role); `admin/workflows.ts:393` calls `assignRole` | DISU / – | `provider_number_roles_admin_all` (all, floor) | same key pair, select/insert/update/delete |
| message_templates | medium | `message-templates.ts` select/update (`manage_settings`); every other reader is service | DIRSTTU / – | `message_templates_admin_all` (all, floor) | `manage_settings` select, update |
| channels | low-med | `admin/channel-catalog.ts` select/update (`manage_settings`); public `channel-catalog.ts:29` select (no gate, any signed-in user) | DISU / – | `channels_admin_all` (all, **`public`**, floor); `channels_auth_read` (select, authenticated, `true`) | `manage_settings` select, update; keep read policy |
| faq_items | low (public content, integrity) | `admin/faq.ts` ×4 ops (`manage_settings`); public `faq.ts:21` select | DISU / S | `faq_items_admin_all` (all, floor); `faq_items_public_read` (select, anon+authenticated, `published = true`) | `manage_settings` ×4 ops; anon `SELECT` only |
| callback_schedule_policies | medium (call windows) | `callbacks/policy/actions.ts:180` update (`manage_settings`); `readPolicyRow(client)` (`policy-config.ts:77`) has two callers: `policy-config.ts:91` with service, `policy-config-admin.ts:31` with the session after `requirePlatformPermission('manage_settings')` | SU / – | `callback_schedule_policies_admin_all` (all, floor) | `manage_settings` select, update |
| fleet_requests, fleet_goals, fleet_request_slack_threads | medium | `admin/fleet.ts` select (`manage_settings`); writes only through the `fleet_*` RPCs; `nav-counts.ts` counts with service after `canSettings` | S / – | one `select` policy each (`public`, floor) | `manage_settings` select |
| ops_alerts | low-med | `admin/alerts.ts:194` select (`manage_settings`); `ops/app-health.ts:55` select for `/admin/debug` (`requirePlatformOwner`, `debug/page.tsx:42`; the owner holds every key); writer `alerts/slack.ts` is service | DIRSTTU / – | `ops_alerts_admin_select` (select, floor) | `manage_settings` select |
| voice_purposes | medium (decides which agent dials) | `admin/voice-purposes.ts` select/insert/update (`manage_voice`); runtime readers `voice-purposes.ts:75,125` are service | DISU / – | `voice_purposes_admin_all` (all, `manage_voice`) | `manage_voice` per operation |

**Sources read in full on 13.10.2026 and what each changed in this plan.**
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api): grants and RLS are two
  layers, use both; default privileges make new objects reachable; a missing grant is a loud `42501`;
  bundle grants with RLS in one migration; RLS does not cover functions, so review every
  `SECURITY DEFINER` function and its `EXECUTE`. → D2, D5, D7.
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): write a policy per
  operation (`for all` hides which rule covers which operation); always name the role with `to`;
  `(select fn())` initplan; `set search_path = ''` on every definer function; "adding policies doesn't
  remove grants"; denial semantics (`42501` for a missing grant or a `with check` violation, silent
  zero rows for a `using` filter); tests per table and how to assert each denial. → D3, D6, D9.
- [RBAC with custom claims](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac):
  roles table, role-permissions table, an `authorize()` definer function used as
  `(select authorize('x'))` in per-operation policies. KALFA's `has_platform_permission` is the same
  shape; it keeps reading the tables on every call instead of stamping the role into the JWT (the
  documented trade-off in `dal.ts`, unchanged). → D3.
- [Testing your database](https://supabase.com/docs/guides/database/testing) and the
  [pgTAP](https://supabase.com/docs/guides/database/extensions/pgtap) and
  [advanced pgTAP](https://supabase.com/docs/guides/local-development/testing/pgtap-extended) pages it
  points to: `supabase/tests/database/*.sql`, `supabase test db`, `policies_are`/`policy_cmd_is`/
  `policy_roles_are`, rolled-back transactions. The advanced page installs a helper package fetched
  from the network at test time. → D9.
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html):
  least privilege (with tests that the mapped permissions are enforced and periodic review for
  privilege creep), deny by default and prefer explicit configuration over defaults, validate on
  every request, defense in depth, log authorization failures; also that ABAC/ReBAC is generally
  preferred over RBAC for fine-grained cases. → D1, D4, D9; the RBAC remark is a non-goal (KALFA has
  five roles; customer data already uses ownership/org relationships).

## Goals / Non-Goals

**Goals:**
- The database never admits more than the application does: for every table and operation, the DB
  decision is the application's decision or stricter.
- Least privilege on grants for `anon` and `authenticated`, table by table.
- A repeatable, hermetic, local proof, and a one-line way to see drift.
- An accurate, single description of the model.

**Non-Goals:**
- Changing the roles, permissions or their matrix. Auditor read access to these tables is a product
  decision for a later change; this change keeps the DB equal to the application.
- Moving provider secrets out of `app_settings` (separate change).
- Cleaning the existing `authenticated` grants of the tables outside this capability (follow-up).
- Reworking application error handling for zero-row writes.
- Customer/org tables, the 12 owner-only tables, `app_settings` (already done), Vault, JWT claims.

## Decisions

**D0 — Close the default first (Supabase: "Revoke default privileges").** Migration role is
`postgres` (it owns all 125 tables), so `alter default privileges for role postgres in schema public`
covers every migration-created object. Revoke `all` on tables and sequences from `anon` and
`authenticated`, and `execute` on functions from `anon`, `authenticated` and, with the GLOBAL form (no
`in schema`; the guide's schema-level form was measured NOT to close new functions), `public`. Deliberately
NOT from `service_role`: it bypasses RLS but not grants, so revoking it (as the guide's snippet does)
would lock the server out of every new table and each past migration relies on the default. Existing
tables: `revoke all … from anon` on tables and sequences, then `grant select` on `packages` and
`faq_items`; verified behaviour-neutral on the live catalog (the only policies naming `anon` are
`faq_items_public_read` and `packages_public_read`; the 9 other policies scoped to `public` are
staff predicates that are false for `anon`). Existing functions are left alone (20 invoker functions
are anon-callable, none `SECURITY DEFINER`; not audited here). The Dashboard's `supabase_admin` default
ACL cannot be changed by `postgres`; tables are created by migrations. Optional and skipped: the
documented `ensure_rls` event trigger (all 125 tables already have RLS, and with no grant a table is
unreachable anyway). Convention for the owner to adopt: every new table or function migration states
its grants.

**D1 — Two groups, decided by the access map, not by guess.** A table the application reaches only
with the service role is *closed*; a table staff reach with their own session gets *per-permission
policies*. Alternative: one model for all (every table per-permission) — rejected, because for the
11 service-only tables a policy would only keep a path open that nothing uses (deny by default).

`voice_purpose_attempts` is classified by this rule, not by its feature's maturity (22.10.2026):
- Every read and write in the code uses `createAdminClient()` (access-map row above); no file under
  `src/app/(admin)` or `src/lib/data/admin` reads it, `admin-data-layer-coverage.test.ts` pins no module
  for it, and no view, Realtime publication or client-executable function exposes it (live catalog).
- It holds `access_token`, the bearer string that the public route `purpose/[purpose]/ctx/[token]`
  accepts on its own (`route.ts:18-21`), which returns a guest's first name and the event details. Its
  `manage_voice` read policy therefore lets `ops_engineer`, who holds no `view_customer_data`, read guest
  context through a live token.
- The generic voice feature it serves has never run in production: 0 rows ever, 0 workflows using the
  voice node, the only generic purpose (`purchase_callback`) disabled
  (`docs/voice-agent/plans/2026-09-15-generic-voice-primitive-plan.md:830`).
- A future attempt-history screen, if one is needed, reads through the server after its own permission
  check (`manage_voice`) and returns named columns only, never `access_token`. It does not reopen a
  user-session path to the table.

`voice_purposes` stays in Group B on `manage_voice`: `admin/voice-purposes.ts` reads and writes it
with the staff session.

**D2 — Closed tables: revoke grants and drop the staff policy; RLS stays on.** `revoke all … from
anon, authenticated`, `drop policy …_admin_all`, no new policy: default-deny plus no grant, the same
shape as `cardcom_config`. A user session now gets a loud `42501` rather than silent zero rows, so an
unexpected user-session path breaks visibly. Alternatives: a private schema (the docs' dedicated
schemas) — rejected: the service-role client reaches only exposed schemas, so ~80 call sites would
need RPC wrappers or renames; keep the grants and rely on RLS alone — rejected: that is today's
state.

**D3 — Per-operation policies, only for operations a user-session path uses, `to authenticated`.**
Pattern per operation: `create policy "<table>: <op> needs <key>" on public.<t> for <op> to
authenticated using ((select public.has_platform_permission('<key>')))` (`with check` for insert and
update, both for update). Two keys: `… (select public.has_platform_permission('manage_settings')) or
(select public.has_platform_permission('manage_voice'))`. Alternatives: one `for all` policy per
table (the project's current convention, and what `app_settings` has) — rejected because the RLS guide
says it hides which operation each rule covers and it would allow operations no path uses; the
`app_settings` policy can be split later (open question). Putting the role in the JWT — rejected,
unchanged from `dal.ts`.

**D4 — The key is the data-layer pin; reads need the same key as writes.** Taken from
`admin-data-layer-coverage.test.ts`. The DB must not admit more than the application, so `auditor`
gets no read access to these tables in the DB because it has none in the UI. A later change can give
read operations their own key (the per-operation policies make that a one-line edit).

**D5 — Public read policies stay; `anon` keeps `SELECT` only where a public page needs it.**
`packages_public_read` (active), `faq_items_public_read` (published), `channels_auth_read`.
`anon` loses every other privilege on every table of the capability.

**D6 — Grants are rebuilt with the policies, in one migration per stage.** `revoke all on table …
from anon, authenticated;` then `grant <exact ops> … to authenticated;` — the order the RLS guide
gives, so truncate/trigger/references/maintain disappear with everything else. `service_role` is
untouched.

**D7 — Entry-point functions.**
- **The `fleet_*` re-gate is done; it is no longer part of this change.** `20261015114659` moved the six
  RPCs from `has_role(auth.uid(),'admin')` to `has_platform_permission('manage_settings')`, which is the
  key `fleet.ts` is pinned to. They already run with `search_path = ''` (verified live 19.10.2026).
  This change only tests them, for a holder and for a non-holder.
- **What remains:** set `search_path = ''` on `is_platform_staff()` and `has_platform_permission()`.
  Today both have `search_path = public`. Their bodies already schema-qualify `public.…` and
  `auth.uid()`; verify with `pg_get_functiondef`.
- `EXECUTE` grants are not widened; the seven service-only definers stay revoked.
- `upsert_provider_number` runs under the caller's RLS, so the policy keys for `provider_numbers` must
  admit exactly its callers (tested).

**D8 — The retired axis (done outside this change).** `voice_purposes_admin_all` and
`voice_purpose_attempts_admin_read` moved to `manage_voice` in `20261015114659`. What remains: the D3
split into per-operation policies with rebuilt grants for `voice_purposes`, and closing
`voice_purpose_attempts` (D1, Group A: revoke all from `anon` and `authenticated`, drop
`voice_purpose_attempts_admin_read`), both in stage S3.

**D9 — Proof with pgTAP, raw, no external helpers.** Files under `supabase/tests/database/`
(`supabase test new <name>`), run by `supabase test db` against the local stack. Impersonation by
`set local role authenticated` plus `set local request.jwt.claim.sub = '<uuid>'`, with staff users and
role assignments inserted inside the rolled-back transaction (the existing deny-matrix script moves one
real staff row through every role). Four test families: (a) policy inventory per table
(`policies_are`, `policy_cmd_is`, `policy_roles_are`); (b) privilege inventory
(`has_table_privilege`); (c) behaviour matrix, role × table × operation, asserting
a missing grant with `throws_ok('42501')`, a `using` filter with `is_empty(… returning …)` plus a read
proving the row is intact, and an allowed write with `results_eq(… returning …)` — never `lives_ok`;
(d) service-role paths still work. Rejected: the database.dev/test-helpers package from the advanced
guide (installs code fetched from the network with an embedded key into the database that holds
guest data); extending `scripts/check-permission-deny-matrix.sql` (it runs `--linked`; this proof
must be local-only). The existing `check:permissions` stays as it is. Heavy FK fixtures: where a table
needs a long fixture chain, assert inventories and privileges for it and record the exception in the
test file.

**D10 — One source of truth for the key map.** `src/lib/auth/staff-table-permissions.ts` (table →
key list) is read by a vitest that asserts it equals the data-layer pins and equals the keys named in
the pgTAP file (text check). The file does not exist yet (task 1.2).

**Tables whose module already decides through CASL compare per operation (22.10.2026).**
- `packages` is the only one today. `src/lib/data/admin/packages.ts` gates through
  `requirePlatformAction`, and `admin-data-layer-coverage.test.ts:126` already takes that module's pin
  from `PLATFORM_ACTIONS.Package`.
- That pin is a set per module, so it cannot see one operation drift. If `read` moved to another key
  (the open `auditor` question below), the set would grow while the `SELECT` policy kept its old key.
- So for such a table the map takes each operation's key from `PLATFORM_ACTIONS` (no key typed again)
  and the check pairs the operations: `read` ↔ `SELECT`, `create` ↔ `INSERT`, `update` ↔ `UPDATE`,
  `delete` ↔ `DELETE`.
- `PLATFORM_ACTIONS` stays the source of the key for every `Package` action. The public read of active
  packages (`packages_public_read`, `anon` and customers) has no CASL subject and is recorded and
  tested separately.
- This change does not extend CASL. Other modules adopt it through their own changes (the pilot and
  `casl-console-ability-foundation`); when one does, its table joins this per-operation check.

**Shared permission keys, recorded 19.10.2026 (owner).**
- **Who decides.** The permission catalogue in Supabase (`platform_permission_definitions`) is the
  authority on which keys exist and who holds them.
- **One key list in TypeScript.** The TypeScript side keeps one shared, maintained list of those keys,
  as far as code needs them. A test checks it against the catalogue seeded in `supabase/migrations`.
- **Two maps, both reading from that list.** This change's table map (table → keys, read by the RLS
  consistency test) and the action map planned in `pilot-casl-package-permissions` (subject → action →
  key, for CASL) both take their keys from it.
- **The maps themselves differ.** UI actions and database tables are different shapes, so the two maps
  need not be the same; what must not repeat is a key typed by hand.
- **The shared key list exists (since 19.10.2026, `e52ed393`).**
  `src/lib/auth/platform-permission-keys.generated.ts` exports `PLATFORM_PERMISSION_KEYS`, generated from
  `public.platform_permission_definitions` by `npm run gen:permissions` and checked by
  `npm run check:permissions:generated`. `src/lib/casl.ts` and `admin-data-layer-coverage.test.ts`
  already import it. What does not exist yet is this change's table map
  (`src/lib/auth/staff-table-permissions.ts`); task 1.2 builds it on `PLATFORM_PERMISSION_KEYS` and
  creates no second list. Vitest remains hermetic and cannot prove DB behaviour; that is the pgTAP
suite's job. Per-path regression: each user-session path in the map gets a pgTAP case that issues the
same query shape as the data layer for a holder and a non-holder.

**D11 — Staged, local first, owner pushes.** Each stage is one migration created with
`npx supabase migration new`, applied to the local database only, with a rollback header, grants and
policies together. The owner runs `db push`; afterwards verification on the live database is read-only
catalog comparison (policy text and grants equal the local result). No impersonation on the live
database.

**D12 — Docs.** Rewrite the `dal.ts` comment block (the floor, the closed tables, the per-permission
policies, why the JWT-claims pattern is still not used, where the proof lives).

## Risks / Trade-offs

- **Group B denials are silent (zero rows, no error).** A reader gated in the app by a different key
  than the policy fails quietly (the integrations owner-agent card already hit this on `app_settings`).
  → The access map lists each path; D10 ties app pins to policy keys; each path has a pgTAP case.
  Group A, by contrast, fails loudly.
- **`upsert_provider_number` and the fleet triggers run under the caller.** → Tested per key; the
  fleet RPCs already gate on `manage_settings` (`20261015114659`), the same key as the `fleet_*`
  policies of S5.
- **Hidden readers.** Parameter-typed clients (`readPolicyRow`), `scripts/*.ts`, the worker, pg-boss
  and direct SQL use `postgres`/`service_role` and bypass RLS (unaffected), but a user-session caller
  of `readPolicyRow` would not. → Task 1.1 resolves every caller before the stage that touches it.
- **After D0 every migration must grant explicitly.** A new table forgotten without a grant is
  unreachable (loud `42501`) rather than open. → Stated in the migration header and proposed as a
  CLAUDE.md line for the owner; `service_role` is untouched so the server keeps working.
- **Two descriptions of the same fact (DAL pins, SQL keys).** → D10.
- **Test runner dependencies.** `supabase test db` needs the local stack and the `pgtap` extension;
  the pinned CLI had start/status problems earlier. → Task 1.3 is a spike that fixes the invocation
  before any test depends on it.
- **The local DB port must never be written to `.env.local`.** Verified 21.10.2026 with a controlled
  experiment: the Supabase CLI loads `.env.local` (and `.env`) from its working directory, and a
  `SUPABASE_DB_PORT` there overrides `[db] port` from `config.toml`. The project's `.env.local` holds
  `SUPABASE_DB_PORT=5432` for the production pooler, so in this checkout `supabase status` reports
  `127.0.0.1:5432` while the local container listens on `54322`, and `127.0.0.1:5432` is a different
  server (the host's PostgreSQL 16 cluster). On 20.10.2026 the value in `.env.local` was changed to
  `54322`, which made local tooling work and sent the production worker into a crash loop against the
  pooler (fixed; `dc862599` now refuses that pairing in production). → Pass the port on the command
  only (`SUPABASE_DB_PORT=54322 <command>`); `scripts/integration/run-local.sh` refuses to run without
  it, which is the correct outcome.
- **Policy cost.** `has_platform_permission` reads three small tables once per statement
  (initplan); the tables are tiny. → Not measured as a risk; check with `explain` on the largest
  (`webhook_inbox` is closed; `message_templates`, `packages` are small).

## Migration Plan

Order by sensitivity, then by risk. Each stage = tests first (red on the local database), migration,
tests green, Advisors run, owner push, live read-only check.

0. **S-1** — D0: close the default (tasks group 0), done first.
1. **S0** — resolve unknown readers, create the map file and its test, spike `supabase test db`,
   write the behaviour matrix (red).
2. **S1** — close `otp_challenges`, `agreement_documents`, `webhook_inbox`.
3. **S2** — close `workflows`, `workflow_runs`, `workflow_run_events`, `workflow_run_steps`,
   `webhook_deliveries`, `outreach_template_failures`, `vox_log_exports`.
4. **S3** — `manage_voice`: `call_dnc_list`, `call_compliance_settings`, `voice_purposes`, and the
   `manage_settings`/`manage_voice` pair `provider_numbers`, `provider_number_roles` (with the
   `upsert_provider_number` case); close `voice_purpose_attempts` (Group A, D1).
5. **S4** — `manage_billing`: `packages` (public read kept).
6. **S5** — `manage_settings`: `message_templates`, `channels`, `faq_items`,
   `callback_schedule_policies`, `ops_alerts`, `fleet_requests`, `fleet_goals`,
   `fleet_request_slack_threads`. The fleet RPC re-gate is already live (`20261015114659`) and is only
   tested here.
7. **S6** — `search_path` on the helper functions, the `dal.ts` rewrite, final full matrix run, a
   verification document.

**Rollback** is per stage and written in each migration header: re-grant the recorded privileges,
re-create the staff-floor policy (`using ((select public.is_platform_staff()))`), and restore the
previous `search_path` of the two helper functions. No data is changed, so nothing needs restoring.

## Open Questions

- Split the existing `app_settings_admin_all` (`for all`) into per-operation policies for consistency
  with D3? Deferrable: it changes SQL shape, not behaviour.
- Which key should the future read-only access for `auditor` use (`view_billing` for `packages`,
  `view_webhooks` for the webhook tables)? Deferrable: a later product decision; D3 makes it a
  one-line change.
- Clean the existing `authenticated` grants of the other ~100 tables: a follow-up change after S6.
- **`integrations_configured_flags()` gates on the staff floor; should it gate on a key?
  (security audit, 21.10.2026, finding M2, corrected the same day).** Live definition: `SECURITY
  DEFINER`, `search_path=public`, `EXECUTE` to `authenticated` (not `anon`), exposed as
  `/rpc/integrations_configured_flags`; its only gate is `if not public.is_platform_staff() then
  return;`. It returns 13 booleans (configured / enabled for WhatsApp, Voximplant, SMS, email, SUMIT,
  Slack, ElevenLabs), no secret and no side effect. Its reader is `getIntegrationsConfiguredFlags()`
  (cookie client, `src/lib/ops/integrations.ts`), used by:
  - `/admin/integrations` through `getIntegrationsIndex()` → `getIntegrationsStatus()`, gated by
    `requirePlatformStaff()` on purpose (`src/app/(admin)/admin/integrations/page.tsx:18`); every card
    shows `configured` / `enabled` to every staff member;
  - `/admin/integrations/numbers`, gated by `requirePlatformPermission('manage_settings')`;
  - `/admin/debug`, gated by `requirePlatformOwner()`.
  The audit first read this as the database admitting more than the application. It does not: the
  widest application reader is the staff floor too, so the function equals the application today.
  The open question is whether the flags themselves should need a key:
  - `manage_settings`: the key of the settings screens. It would hide the status column of
    `/admin/integrations` from staff without it; today `getIntegrationsStatus()` throws when the RPC
    answers nothing, so that page would have to handle "no flags" before the gate changes.
  - `integrations.read`: the catalogue's read key for integration status, held by the read-only roles
    (`auditor`). Same page consequence for staff who lack it.
  Deferred: `app_settings` and its functions are outside this change (Non-Goals), so no task here
  implements it; whichever key wins, the same edit should pin `search_path = ''` (today `public`).
