# Proposal

## Why

The database admits **any** `platform_staff` row to 23 staff-managed tables (`is_platform_staff()`),
while the platform permission matrix is enforced only in the application's data layer. A staff
member who talks to PostgREST directly (the anon key is public; their own session token is enough)
skips that layer. Measured on the live catalog, 13.10.2026 (read-only):

- **14 of the 23 tables are writable** by every staff member (`packages`, `call_dnc_list`,
  `agreement_documents`, `message_templates`, `channels`, `workflows`, `provider_numbers`,
  `provider_number_roles`, `webhook_inbox`, `otp_challenges`, `faq_items`,
  `outreach_template_failures`, `call_compliance_settings`, `callback_schedule_policies`); the rest
  are readable.
- The sensitive ones: `otp_challenges` (OTP code hashes), `agreement_documents` (contract text and
  approval), `call_dnc_list` and `call_compliance_settings` (do-not-call list and the consent/DNC
  gates), `packages` (prices), `webhook_inbox` (WhatsApp payloads), `provider_numbers`.
- `auditor` is defined read-only (`view_*`, `integrations.read`) yet can write these tables.
  Today the only staff are the owner and one `billing_clerk`, so the exposure is small; it grows with
  every role that gets staffed.
- **Reproduced end to end on a local database, 21.10.2026.** `src/lib/auth/permissions.local-it.test.ts`
  signs in real local GoTrue users and talks to PostgREST with their own tokens:
  - an `auditor` (no `view_webhooks`) reads `webhook_inbox` payloads, marks an event processed,
    inserts a forged inbound event and deletes rows;
  - `auditor` and `ops_engineer` (no `manage_billing`) insert, re-price and delete `packages`, and read
    inactive ones;
  - `deletePackageAction` refuses the `auditor`, and the same `auditor` deletes the package straight
    through PostgREST.
  The live policies were re-read on 21.10.2026 and are unchanged (`packages_admin_all`,
  `webhook_inbox_admin_all`: `for all to authenticated using is_platform_staff()`).
- **Grants are wider than RLS needs.** New tables in `public` received `arwdDxtm` (insert, select,
  update, delete, truncate, references, trigger, maintain) for `anon`, `authenticated` and
  `service_role` through the default ACL, and `anon` held all of it on 9 of the 23 tables (13.10).
  Stage 0 of this change is live (`20261013030310`, `20261013030533`, `20261013033311`; checked
  21.10.2026): `anon` now holds only `SELECT` on `packages` and `faq_items`. Still open:
  `authenticated` holds `TRUNCATE`, `TRIGGER` and `REFERENCES` on 9 of the 23 tables. RLS is the only
  barrier ([Supabase: "adding policies doesn't remove them"](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- **The retired `has_role('admin')` axis is gone (done outside this change).** Measured on 13.10, the
  six `fleet_*` `SECURITY DEFINER` RPCs and two policies (`voice_purposes`, `voice_purpose_attempts`)
  still used it. Migration `20261015114659` (15.10) moved the RPCs to
  `has_platform_permission('manage_settings')` and the policies to `manage_voice`. Stage 2
  (`20261015134735`) dropped `has_role`, `user_roles` and `app_role`. Verified on the live catalog on
  19.10.2026: no function or policy references `has_role`, and all six RPCs run with
  `search_path = ''`.
- `app_settings` was moved to `has_platform_permission('manage_settings')` on the live database by
  hand (recorded in `20261013021137`), so the system is now inconsistent and `src/lib/auth/dal.ts`
  documents the old model ("permissions appear in ZERO policies" is already false: `rdp_access_*`,
  `app_settings`).

## What Changes

- **Evidence first.** The per-table access map (client type, operation, gating permission,
  sensitivity, grants) is built from the code and the live catalog and kept in `design.md`.
- **Closed by default, done first.** Revoke the default privileges of future objects in `public` for
  `anon` and `authenticated` (tables, sequences) and for `anon`, `authenticated` and `PUBLIC`
  (functions), as the Supabase guide documents; `service_role` keeps its defaults (it bypasses RLS but
  not grants). Revoke every `anon` privilege on existing tables except `SELECT` on `packages` and
  `faq_items` — behaviour-neutral, because no policy admits `anon` anywhere else. From then on every
  new table or function needs an explicit `grant` in its migration.
- **Group A — close 10 tables the app reaches only with the service role** (`otp_challenges`,
  `agreement_documents`, `webhook_inbox`, `workflows`, `workflow_runs`, `workflow_run_events`,
  `workflow_run_steps`, `webhook_deliveries`, `outreach_template_failures`, `vox_log_exports`):
  revoke every `anon`/`authenticated` privilege and drop the staff-floor policy. RLS stays on with no
  policy. No application code changes; user sessions get a loud `42501`.
- **Group B — per-permission RLS on 15 tables staff reach with their own session** (`packages`,
  `call_dnc_list`, `call_compliance_settings`, `provider_numbers`, `provider_number_roles`,
  `message_templates`, `channels`, `faq_items`, `callback_schedule_policies`, `fleet_requests`,
  `fleet_goals`, `fleet_request_slack_threads`, `ops_alerts`, plus `voice_purposes` and
  `voice_purpose_attempts`): one policy **per operation the app uses**, `to authenticated`, calling
  `has_platform_permission(<key>)` with the key the data-layer module already pins. Existing public
  read policies on `packages`, `faq_items` and `channels` stay.
- **Grants rebuilt table by table** in the same migration as the policies: revoke all from `anon`
  and `authenticated`, grant back only what a user-session path uses (`anon` keeps `SELECT` only on
  `packages` and `faq_items`).
- **Helper functions:** pin `search_path = ''` on `is_platform_staff()` and
  `has_platform_permission()`. The `fleet_*` RPC re-gate is already live (`20261015114659`) and is
  not part of this change.
- **Proof:** automated pgTAP tests (`supabase/tests/database/`, run with `supabase test db`) on a local
  database: policy and privilege inventories plus a role × table × operation behaviour matrix, and a
  consistency check between the policy keys and the data-layer pins.
- **Docs:** rewrite the permission-model notes in `src/lib/auth/dal.ts`.
- **BREAKING (behaviour, by design):** a staff member without the permission loses direct table
  access. Group B denials are **silent zero rows** (RLS), so a user-session reader gated by a
  different permission fails silently; every such path is listed in the map and tested.

Scope note:
- `voice_purposes` and `voice_purpose_attempts` stay in Group B. Since 15.10 they have one `for all`
  policy on `manage_voice`, which this change splits per operation like the other tables.
- The six `fleet_*` RPCs need no change: `20261015114659` re-gated them, and their tests here only
  prove holder and non-holder behaviour.

Out of scope, explicitly: moving provider secrets out of `app_settings` into a closed table (separate
change, separate approval); cleaning the existing `authenticated` grants of the tables outside this
capability (follow-up); any change to the live database or any deploy (the owner runs `db push`).
Migrations only through the Supabase CLI, local first.

## Capabilities

### New Capabilities
- `staff-table-access-control`: the database enforces the platform permission matrix on staff-managed
  tables (closed tables for service-only data, per-permission policies for user-session data,
  gated RPC entry points), with a repeatable local proof and an accurate documented model.

### Modified Capabilities
<!-- none: openspec/specs holds no capability yet -->

## Impact

- **Database (future migrations, local first):** policies and grants across 25 tables, and
  `search_path` on two helper functions; no data changes.
- **Code:** `src/lib/auth/dal.ts` (comments); a single table-to-permission map and its consistency
  test. Its keys come from one shared TypeScript list of the catalogue's permission keys, which the
  action map of `pilot-casl-package-permissions` also uses (see design D10); no change expected in data-layer modules except where the access map finds a reader that
  depends on the old floor (none found so far; callers of `readPolicyRow(client)` still to resolve).
- **Tests:** new `supabase/tests/database/` suite (the project has none today).
- **Risk:** silent zero-row failures; mitigated by the map, per-path tests and a staged rollout
  ordered by sensitivity.
