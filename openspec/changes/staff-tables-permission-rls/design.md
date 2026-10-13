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

**Why the model is no longer uniform.** `rdp_access_*` (6.10) and `app_settings` (13.10, by hand on
the live database, recorded in `20261013021137`) already call `has_platform_permission` inside RLS;
the other 23 tables sit on the floor. The `dal.ts` reason for avoiding permissions in RLS (cost per
row; JWT claims going stale) does not apply to the table-lookup approach with the `(select …)`
initplan wrapper, which the project already uses.

**Measured on the live catalog, 13.10.2026 (read-only):**
- 23 tables on the floor: 20 with a single policy, 3 (`channels`, `faq_items`, `packages`) with an
  extra public/authenticated read policy. `channels_admin_all` is scoped to `public`, not
  `authenticated`.
- Default ACL for tables created by `postgres` and `supabase_admin` in `public` grants `arwdDxtm` to
  `anon`, `authenticated`, `service_role`. Result: `anon` holds every privilege on 9 of the 23 tables;
  `authenticated` holds truncate/trigger/references on most. Systemic: 35 of 125 public tables give
  `anon` a write grant; all 125 have RLS enabled.
- `SECURITY DEFINER` functions touching these tables: 13. Seven are service-role only (EXECUTE
  revoked from `authenticated`). Six are callable by `authenticated` and gate on the retired
  `has_role(uid,'admin')`: `fleet_answer_request`, `fleet_goal_abandon`, `fleet_goal_create`,
  `fleet_goal_pause`, `fleet_goal_resume`, `fleet_owner_request`. Two policies still use `has_role`:
  `voice_purposes_admin_all`, `voice_purpose_attempts_admin_read`.
- `SECURITY INVOKER` functions touching them: `upsert_provider_number` (called with the user
  session from `provider-numbers.ts`); three fleet trigger functions (`fleet_goals_guard`,
  `fleet_requests_guard`, `fleet_requests_no_truncate`); `fleet_consume_request`,
  `integrations_delete_credential` and `wake_parked_workflow_run` (called with the service role).
  No views.
- No Realtime consumer reads these tables (the workflow files explicitly avoid `postgres_changes`);
  Edge Functions (`mcp`, `sms-hook`) do not touch them; the browser Supabase client is used only for
  passkeys, the Voximplant SDK and console channels.

**Access map (static scan of `src/`, `worker/`, `scripts/` plus the live catalog).** "User session"
means the cookie client (the staff member's own JWT); "service" means `createAdminClient`.

| Table | Sensitivity | User-session access in code (gate) | Today: authenticated / anon | Extra policy | Target |
|---|---|---|---|---|---|
| otp_challenges | critical (OTP hashes) | none (service ×5) | all / all | – | **close** |
| agreement_documents | critical (contract, approval) | none (service ×5) | all / all | – | **close** |
| webhook_inbox | high (raw payloads) | none (service; reader gated `view_webhooks`) | all / all | – | **close** |
| workflows | med-high (definitions) | none (service ×16) | DIUS / – | – | **close** |
| workflow_runs, _events, _steps | medium | none (service) | S / – | – | **close** |
| webhook_deliveries | medium | none (service) | S / – | – | **close** |
| outreach_template_failures | low | none (service-typed param) | all / all | – | **close** |
| vox_log_exports | medium | none (service-typed param) | all / all | – | **close** |
| packages | high (prices) | `admin/packages.ts` select/insert/update/delete (`manage_billing`) | all / all | `packages_public_read` (active) | `manage_billing` ×4 ops; anon `SELECT` only |
| call_dnc_list | high (legal) | `call-dnc.ts` select/upsert (`manage_voice`) | all / all | – | `manage_voice` select, insert, update |
| call_compliance_settings | high (consent/DNC gates) | `call-dnc.ts`, `voximplant-channel.ts` select/update (`manage_voice`) | S,U / – | – | `manage_voice` select, update |
| provider_numbers | med-high | `provider-numbers.ts` select/update + RPC; `owner-agent.ts` (owner) | DIUS / – | – | `manage_settings` OR `manage_voice`, select/insert/update |
| provider_number_roles | medium | `provider-numbers.ts` upsert/delete | DIUS / – | – | same key pair, select/insert/update/delete |
| message_templates | medium | `message-templates.ts` select/update (`manage_settings`) | all / all | – | `manage_settings` select, update |
| channels | low-med | `admin/channel-catalog.ts` select/update (`manage_settings`); public `channel-catalog.ts` select | DIUS / – | `channels_auth_read` | `manage_settings` select, update; keep read policy |
| faq_items | low (public content, integrity) | `admin/faq.ts` ×4 ops (`manage_settings`); public `faq.ts` select | DIUS / S | `faq_items_public_read` | `manage_settings` ×4 ops; anon `SELECT` only |
| callback_schedule_policies | medium (call windows) | `callbacks/policy/actions.ts` update (`manage_settings`); `readPolicyRow(client)` mixed | S,U / – | – | `manage_settings` select, update |
| fleet_requests, fleet_goals, fleet_request_slack_threads | medium | `admin/fleet.ts` select (`manage_settings`); RPCs | S / – | – | `manage_settings` select |
| ops_alerts | low-med | `admin/alerts.ts` select (`manage_settings`); `app-health.ts` select (Debug page, owner only) | all / all | – | `manage_settings` select |
| voice_purposes, voice_purpose_attempts | medium (decides which agent dials) | `admin/voice-purposes.ts` (`manage_voice`) | (to confirm in 1.1) | – | `manage_voice`; replace retired `has_role` |

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
10 service-only tables a policy would only keep a path open that nothing uses (deny by default).

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

**D7 — Entry-point functions.** Re-create the six `fleet_*` RPCs with the gate changed from
`has_role(auth.uid(),'admin')` to `has_platform_permission('manage_settings')` (`fleet.ts` is pinned to
`manage_settings`), generated mechanically from `pg_get_functiondef` and diffed so only the gate line
changes; check each has `set search_path = ''` (add if missing). Set `search_path = ''` on
`is_platform_staff()` and `has_platform_permission()` (their bodies already schema-qualify
`public.…` and `auth.uid()`; verify with `pg_get_functiondef`). `EXECUTE` grants are not widened; the
seven service-only definers stay revoked. `upsert_provider_number` runs under the caller's RLS, so the
policy keys for `provider_numbers` must admit exactly its callers (tested).

**D8 — The retired axis.** `voice_purposes_admin_all` and `voice_purpose_attempts_admin_read` move to
`manage_voice`. Included because the defect is identical and `voice-purposes.ts` is already pinned to
that key.

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
the pgTAP file (text check). Vitest remains hermetic and cannot prove DB behaviour; that is the pgTAP
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
  fleet RPCs are re-gated first (S5) before the `fleet_*` policies.
- **Hidden readers.** Parameter-typed clients (`readPolicyRow`), `scripts/*.ts`, the worker, pg-boss
  and direct SQL use `postgres`/`service_role` and bypass RLS (unaffected), but a user-session caller
  of `readPolicyRow` would not. → Task 1.1 resolves every caller before the stage that touches it.
- **After D0 every migration must grant explicitly.** A new table forgotten without a grant is
  unreachable (loud `42501`) rather than open. → Stated in the migration header and proposed as a
  CLAUDE.md line for the owner; `service_role` is untouched so the server keeps working.
- **Two descriptions of the same fact (DAL pins, SQL keys).** → D10.
- **Test runner dependencies.** `supabase test db` needs the local stack and the `pgtap` extension;
  the pinned CLI had start/status problems earlier and `SUPABASE_DB_PORT=54322` must be set (memory
  note). → Task 1.3 is a spike that fixes the invocation before any test depends on it.
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
4. **S3** — `manage_voice`: `call_dnc_list`, `call_compliance_settings`, `voice_purposes`,
   `voice_purpose_attempts`, and the `manage_settings`/`manage_voice` pair `provider_numbers`,
   `provider_number_roles` (with the `upsert_provider_number` case).
5. **S4** — `manage_billing`: `packages` (public read kept).
6. **S5** — `manage_settings`: `message_templates`, `channels`, `faq_items`,
   `callback_schedule_policies`, `ops_alerts`, then the fleet RPC re-gate and
   `fleet_requests`, `fleet_goals`, `fleet_request_slack_threads`.
7. **S6** — `search_path` on the helper functions, the `dal.ts` rewrite, final full matrix run, a
   verification document.

**Rollback** is per stage and written in each migration header: re-grant the recorded privileges,
re-create the staff-floor policy (`using ((select public.is_platform_staff()))`), restore the previous
function bodies. No data is changed, so nothing needs restoring.

## Open Questions

- Split the existing `app_settings_admin_all` (`for all`) into per-operation policies for consistency
  with D3? Deferrable: it changes SQL shape, not behaviour.
- Which key should the future read-only access for `auditor` use (`view_billing` for `packages`,
  `view_webhooks` for the webhook tables)? Deferrable: a later product decision; D3 makes it a
  one-line change.
- Clean the existing `authenticated` grants of the other ~100 tables: a follow-up change after S6.
