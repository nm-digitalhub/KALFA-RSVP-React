# verification-default-privileges — tasks 0.1–0.4 (13.10.2026)

Everything below ran on the **local** database (container `supabase_db_beta`, port 54322, started alone with
every other service excluded) or read the **live** catalog read-only. Nothing was changed on the live database.

## What was applied (local only)

| Migration | Effect |
|---|---|
| `20261013030310_revoke_default_client_privileges` | default ACL of `postgres` in `public`: tables and sequences closed to `anon` and `authenticated`; functions closed to `anon`, `authenticated` and `PUBLIC` (global form); `service_role` untouched |
| `20261013030533_revoke_anon_privileges_existing_tables` | `anon` loses every privilege on existing tables and sequences in `public`; keeps `SELECT` on `packages` and `faq_items` |

Disclosure: the first migration was edited after it had been applied locally (the function statement had to
change, see "Finding 1"); the added statement was applied to the local database by hand with `psql`, the
migration file is the final content. It has not been pushed anywhere.

## Baseline (task 0.1)

Live default ACL for `postgres` in `public` (13.10.2026): tables `arwdDxtm`, sequences `rwU`, functions `X`,
each for `postgres`, `anon`, `authenticated`, `service_role`. Live: `anon` holds a privilege on 48 of 125 public tables
(35 with a write privilege) and 3 sequences; 9 views/materialized views, none readable by `anon`; no
`SECURITY DEFINER` function executable by `anon`. The only policies that name `anon` are
`faq_items_public_read` and `packages_public_read`; nine other policies are scoped to `public` but use
`is_platform_staff()`, false for `anon`. Public routes never create a user-session client (they use the
service role); every user-session reader outside the admin area calls `requireUser()` first.

### Snapshot of the live `anon` table privileges — the rollback source for the second migration

| table | anon privileges before |
|---|---|
| activity_log | SELECT |
| agreement_documents | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| billed_results | INSERT,REFERENCES,SELECT,TRIGGER |
| billing_credits | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| call_dnc_list | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| callback_requests | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| campaign_authorized_contacts | INSERT,REFERENCES,SELECT,TRIGGER |
| campaign_authorized_set_audit | INSERT,REFERENCES,SELECT,TRIGGER |
| campaigns | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| console_agent_shift | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| contact_interactions | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| contact_messages | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| contacts | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| event_cancellation_requests | REFERENCES,SELECT,TRIGGER |
| event_questions | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| events | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE |
| faq_items | SELECT |
| guest_groups | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| guest_import_staging | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| guests | DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE |
| message_templates | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| ops_alerts | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| org_roles | REFERENCES,SELECT,TRIGGER |
| organization_audit_log | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| organization_invitations | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| organization_members | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| organization_role_audit_log | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| organization_role_permissions | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| organizations | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| otp_challenges | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| outreach_state | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| outreach_template_failures | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| packages | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| permission_definitions | REFERENCES,SELECT,TRIGGER |
| platform_permission_definitions | REFERENCES,SELECT,TRIGGER |
| platform_role_audit_log | REFERENCES,SELECT,TRIGGER |
| platform_role_permissions | REFERENCES,SELECT,TRIGGER |
| platform_roles | REFERENCES,SELECT,TRIGGER |
| platform_staff | REFERENCES,SELECT,TRIGGER |
| profiles | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| push_subscriptions | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| role_permissions | REFERENCES,SELECT,TRIGGER |
| rsvp_responses | DELETE,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| support_access_log | REFERENCES,SELECT,TRIGGER |
| user_roles | REFERENCES,SELECT,TRIGGER |
| user_settings | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| vox_log_exports | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |
| webhook_inbox | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE |

## Proofs (task 0.2 and 0.3), local database

| # | Check | Result |
|---|---|---|
| A1 | new table created with no grant: privileges of anon / authenticated / service_role | none / none / all (select, insert, update, delete, truncate, references, trigger) |
| A2 | new sequence: usage | false / false / true |
| A3 | new function: execute | false / false / true (ACL `{postgres=X, service_role=X}`) |
| A5 | service_role inserts into and reads the new table | works |
| B1 | tables where `anon` holds any privilege afterwards | 2: `faq_items` SELECT, `packages` SELECT |
| B2 | sequences `anon` can use afterwards | 0 |
| B3 | tables where `service_role` still holds select/insert/update/delete | 125 of 125 |
| C1–C3 | `anon` with the live `packages` policies reproduced in a rolled-back transaction | reads active packages (1), sees inactive (0) |
| C2 | same for `faq_items` | reads published (1), sees unpublished (0) |
| C4 | `anon` selects `guests`, `otp_challenges`, `app_settings` | `permission denied for table` (loud) |
| C6 | `anon` inserts into `packages` | `permission denied for table packages` |
| — | existing functions: `is_platform_staff` and `has_platform_permission` executable by `authenticated` | still true |

## Findings

1. **The Supabase guide's function statement is not enough.** `alter default privileges ... in schema public
   revoke execute on functions from public` did not close new functions: a function created afterwards
   kept `=X/postgres` and stayed callable by `anon` and `authenticated` (A3 was true/true). Only the form
   without `in schema` removes PUBLIC's built-in EXECUTE. Side effect checked: functions of a newly created
   extension (`ltree`, in a rolled-back transaction) are owned by `supabase_admin` and keep their ACL.
   Primary source: the PostgreSQL page for ALTER DEFAULT PRIVILEGES states that
   `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` "has no effect ...
   per-schema default privileges can only add privileges to the global setting, not remove privileges granted
   by it"; the Supabase "Database functions" guide (read in full) shows that per-schema form. Current exposure
   for context (live, read-only): 20 functions in `public` are executable by `anon`, all `SECURITY INVOKER`
   (trigger and immutable-check functions, two aggregate helpers, `upsert_provider_number`), so they run with
   `anon`'s own rights and reach nothing; no `SECURITY DEFINER` function is executable by `anon`. The default
   closure is a safety net for future functions, not the fix of a present hole.
2. **Local and live differ in six policies** (live-only or hand-applied, in no migration):
   live-only `packages_public_read` and `platform_staff: "Platform owners can manage staff"`; scoped to
   `authenticated` on live but `public` locally: `packages_admin_all`, `activity_log.al_owner_insert`,
   `profiles.own_profile_read`, `profiles.own_profile_write`. Consequence: a database built from the
   migrations (a reset, a preview, this local copy) has no public read on `packages`, and the public
   pricing read would fail for `anon` there. **Resolved by `20261013033311_mirror_live_policy_drift`** (all six
   are PERMISSIVE; the live-only two are created only when absent, the other four are altered in place, because
   PERMISSIVE policies combine with OR): after it the local and live policy sets are identical in all 121 policies
   (name, permissive, cmd, roles, USING, WITH CHECK); a second run of the migration is a no-op; `anon` now reads
   active packages (1) and not inactive ones (0) on a migration-built database with no emulation.
3. **Local Advisors** (security): the same pre-existing findings as before — seven `security_definer_view`
   on `console_*` views (intentional, in-view `is_console_agent()`) and three `function_search_path_mutable`
   on old functions. Nothing new from these migrations.
4. Regression: the data-module tests that exist for packages/FAQ readers (2 files, 107 tests) are green (they are hermetic;
   the code-level check is the scan above: no anonymous path reads another table with a user-session client).

## After this is pushed (owner)

`db push`, then read-only live check: default ACL for `postgres` in `public` has no `anon` or `authenticated` entry
and no global PUBLIC function entry; `anon` holds a privilege on exactly `faq_items` and `packages` (SELECT).
From then on every migration that creates a table, sequence or function must state its grants.

## Live check after the owner's `db push` (13.10.2026 06:34, read-only)

The owner pushed all four migrations (`20261013021137`, `…030310`, `…030533`, `…033311`), then `gen:types` (no change
to `types.generated.ts`), `types:check` and `tsc` (clean). Catalog comparison with the local result:

| Check | Live result |
|---|---|
| default ACL, global, functions | `{postgres=X/postgres}` (PUBLIC's built-in EXECUTE is gone) |
| default ACL, `public`: tables / sequences / functions | `postgres` and `service_role` only (no `anon`, no `authenticated`) |
| tables where `anon` holds any privilege | exactly `faq_items` and `packages`, `SELECT` only |
| sequences `anon` can use | 0 |
| `service_role` select/insert/update/delete | 125 of 125 tables |
| policies | 121 (identical count to the local, migration-built database) |
| `app_settings_admin_all` | `has_platform_permission('manage_settings')`, `authenticated` |
| `packages_public_read`, `faq_items_public_read` | present, `anon` and `authenticated` |

Application signals (anonymous GETs to the production server, read-only): `/` 200, `/faq` 200 and it renders the
live published questions (3 of 3 sampled); pm2 logs of `kalfa-beta`, `kalfa-worker`, `kalfa-owner-agent`, `kalfa-fleet`,
`kalfa-ops-agent` show no permission or `42501` errors in the last 300 lines. No anonymous page that lists packages was
found (the home page does not). Code check: every reader of `packages` in `src/` (`campaigns.ts`, `agent-benefits.ts`, `admin/packages.ts`, `admin/coupon-assignments.ts`, `admin/offers.ts`) uses `createAdminClient()` (service role) or a staff session, none uses `anon`; so the `anon` SELECT on `packages` is kept for safety and is verified by the catalog (grant + policy), not by a page.
