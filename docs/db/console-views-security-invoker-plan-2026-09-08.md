# Console views → `security_invoker` — plan (2026-09-08)

**Status: PLAN ONLY. Nothing below has been applied.** Every live fact is tagged
VERIFIED-LIVE (read-only query against the linked `kalfa-event-magic` project on
2026-09-08, PostgreSQL 17.6), DOCS-ONLY (Supabase documentation), or inferred.

## תקציר מנהלים (5 שורות)

1. שבעת ה-views של המוקד מסומנים `security_definer_view` (ERROR 0010) כי הם רצים בהרשאות `postgres` ומדלגים על RLS של טבלאות הבסיס — זה מכוון (נציג מוקד אינו בעל אירוע), אבל הלינטר לא יכול לדעת זאת.
2. בדקתי חי: הפעלת `security_invoker` בלי policies חדשות שוברת את המוקד (נציג #1 רואה 3 אירועים דרך ה-view ו-0 ישירות מהטבלה). זה מאשר את הנימוק מ-20.7.
3. ההצעה המקורית (policies של `is_console_agent()` על כל טבלאות הבסיס, גם עם גידור `contacts` ב-`view_customer_data`) **דולפת**: `guests.phone`, `guests.rsvp_token`, `campaigns.card_citizen_id`/מחירים, `billed_results.locked_price`, `call_attempts.access_token` ייחשפו ל-REST ישיר. RLS הוא ברמת שורה; הרשאות עמודה הן לכל תפקיד `authenticated` ולכן לא יכולות להבחין בין נציג לבעל אירוע.
4. ההמלצה (אופציה H, היברידית): policies אמיתיים רק על טבלאות שאין בהן עמודה מוגנת (events, call_analysis, rsvp_responses, platform_*), ופונקציות SECURITY DEFINER צרות בסכמה `private` שאינה חשופה ל-PostgREST עבור שלושת ה-views שנוגעים ב-PII/חיוב. התוצאה: 7 ERROR → 0, ללא הרחבת מה שנציג יכול לקרוא, חוזה ה-Android נשמר.
5. נדרש אישור מפורש לפני apply; מומלץ rollback-probe בטרנזקציה לפני `db push`. עלות: +7 אזהרות WARN 0006 (ניתנות לאיחוד במיגרציה המשך) ואובדן predicate-pushdown בשלושת ה-views מבוססי-הפונקציה (זניח בסדרי הגודל הנוכחיים, מתועד עם סף).

---

## 1. Official guidance this plan is grounded in (DOCS-ONLY)

| Topic | Source | What it says (quoted/paraphrased) |
|---|---|---|
| Lint 0010 `security_definer_view` | https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view | "Postgres' default setting for views is SECURITY DEFINER which means they use the permissions of the view's creator, rather than the permissions of the querying user." Resolve: `create view ... with (security_invoker=on)`; "introduced in Postgres 15". |
| Invoker views | https://supabase.com/docs/guides/database/postgres/row-level-security and `/guides/database/tables` | `alter view <name> set (security_invoker = true);` — "Enforces RLS policies based on the querying user's permissions rather than the view creator's." For pre-15: "restrict access by revoking grants from anon and authenticated roles or placing views in unexposed schemas." |
| RLS performance | same RLS page | "Add an index on every column your policies filter on"; wrap calls as `(select auth.uid())` so Postgres caches per statement, not per row; "Always name the role in policies using the `to` clause". |
| SECURITY DEFINER helpers | same RLS page | Use security definer functions to break recursion / avoid per-row policy cost; "Always set `search_path = ''` and schema-qualify all names"; the example lives in a **`private`** schema — "avoid creating security definer functions in exposed API schemas". |
| Lint 0006 `multiple_permissive_policies` | https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies | WARN. Permissive policies compose with OR; each one is evaluated. Resolve by consolidating into one policy with OR, or pair one permissive with restrictive policies. |
| Custom claims / RBAC | https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac | `authorize()` reads `auth.jwt() ->> 'user_role'` injected by a custom access token hook; claims change only when a JWT is re-issued; "The auth hook will only modify the access token JWT but not the auth response." |
| Column-level privileges | https://supabase.com/docs/guides/database/postgres/column-level-security | "RLS ... doesn't give you control over which columns they can access within rows." `revoke update (title) on table public.posts from authenticated;` Privileges are per **role**; "Restricted roles cannot use the wildcard operator (`*`)". "We do not recommend using column-level privileges for most users. Instead, we recommend using RLS policies in combination with a dedicated table for handling user roles." |

Consequences for this plan:

- Column privileges are granted to `authenticated` as a whole. Event owners and console agents share that role (the server cookie client is `authenticated` too), so a column revoke on `guests.phone` would blind owners. Column privileges **cannot** be conditional per user; only a view projection or a function can be.
- JWT claims (RBAC guide) would make `is_console_agent()`/`has_platform_permission()` cheaper but introduce claim staleness (a revoked agent keeps access until token refresh, up to the JWT lifetime) and require an access-token hook plus client decoding. KALFA already has a DB-lookup RBAC with SECDEF helpers; the RLS page endorses exactly that shape. **Recommendation: keep DB-lookup functions.** Revisit claims only if policy evaluation shows up in `pg_stat_statements`.
- The linter only inspects schemas exposed to PostgREST (`supabase/config.toml` `[api] schemas = ["public", "graphql_public"]`; inferred from the linter's `pgrst.db_schemas` filter). A `private` schema is neither linted nor reachable via `/rest/v1/rpc`.

## 2. Live inventory (VERIFIED-LIVE 2026-09-08)

Migration sync: `npx supabase migration list --linked` shows local == remote through `20260907175803`, no drift.

### 2.1 Views

All nine views: owner `postgres` (rolbypassrls), `relacl = {postgres=arwdDxtm, service_role=arwdDxtm, authenticated=r}` (`exchange_connections_status` has no `authenticated` grant at all).

| View | reloptions | Base tables (pg_rewrite → pg_depend) | Gate inside the view |
|---|---|---|---|
| `console_agents_roster` | `security_invoker=on` (20260827123914) | console_agents, agent_status, console_agent_secrets, console_agent_calendar_presence | `is_console_agent()` |
| `exchange_connections_status` | `security_invoker=true` | (not exposed to `authenticated`) | n/a |
| `console_events` | none → **ERROR 0010** | events, campaigns (two `EXISTS` subqueries) | `is_console_agent()` |
| `console_campaigns` | none → ERROR | campaigns | `is_console_agent()` |
| `console_call_analysis` | none → ERROR | call_analysis | `is_console_agent()` |
| `console_rsvp_results` | none → ERROR | rsvp_responses, guests (name only) | `is_console_agent()` |
| `console_campaign_targets` | none → ERROR | outreach_state, contacts, guests | `is_console_agent()` + phone mask `has_platform_permission('view_customer_data')` |
| `console_event_guests` | none → ERROR | guests, contacts, billed_results, call_attempts, campaigns | `is_console_agent()` + phone mask |
| `console_me` | none → ERROR | console_agents, platform_staff, platform_roles, platform_role_permissions, platform_permission_definitions | `ca.user_id = auth.uid()` |

Why `console_agents_roster` passes: all four of its base tables carry an `is_console_agent()` SELECT policy, and `console_agent_secrets` grants `authenticated` only the `user_id` column (column-level grant, the house precedent). Under invoker mode the caller's own rights suffice.

### 2.2 Base tables

Grants column = `information_schema.role_table_grants` for `authenticated`; est. rows from `pg_class.reltuples`.

| Table | RLS | SELECT policy for `authenticated` | `authenticated` grants | Columns a console agent must NOT see (protected class) | Index on policy/helper columns |
|---|---|---|---|---|---|
| events | on | `events_org_select` (owner or org member) | SELECT (no UPDATE; `arDxt`) | `notes` (owner-internal), `gift_payment_url`, `gift_link_token` — flagged, see §4 | pkey, `idx_events_owner`, `events_org_idx` |
| campaigns | on | `camp_org_select` via `can_access_event` | full (`arwdDxtm`, also `anon`) | pricing (`price_per_reached`, `base_price`, `final_charge_amount`…), `card_token_ref`, `card_citizen_id`, `auth_number`, charge document URLs | pkey; only a **partial** `(event_id) where status <> 'cancelled'` |
| guests | on | `guests_org_select` | full | `phone` (defeats the view's phone mask), `rsvp_token`, `note` (owner-internal), `meal_pref` | pkey, `idx_guests_event`, `guests_contact_idx` |
| contacts | on | `contacts_org_select` | full (also `anon`) | `normalized_phone` (permission-conditional today) | pkey, `contacts_event_idx`, `(event_id, normalized_phone)` |
| billed_results | on | `billed_results_org_select` | full (also `anon`) | `locked_price` (guarded by test: "no console view exposes locked_price") | `(event_id, contact_id)` unique |
| call_attempts | on | **none** for authenticated | **none** (0/34 columns) | `access_token`, `recording_url`, `media_session_access_*`, `transcript` | `(event_id, contact_id) where callback pending` (matches the lateral exactly) |
| outreach_state | on | `outreach_state_org_select` | full (also `anon`) | none | pkey, `(campaign_id, status)` |
| rsvp_responses | on | `rsvp_org_read` | full | `meal_pref`, `extras` (dietary preference = personal data per CLAUDE.md; the view already exposes `note`) | pkey, `idx_rsvp_event`, `(guest_id, created_at)` |
| call_analysis | on | `call_analysis_owner_select` via `can_access_event` | SELECT only | `cost_credits`, `cost_fiat` (platform cost, not customer price), `transcript_summary` | pkey, `call_analysis_event_idx`, `call_analysis_call_attempt_idx` |
| platform_staff / platform_roles / platform_role_permissions / platform_permission_definitions | on | `*_owner_select` = `is_platform_owner()` only | SELECT | none (role catalog + own membership row) | `platform_staff_user_id_key` (unique), role/permission idx |
| console_agents | on | `console_agents_select` = `is_console_agent()` | SELECT | none | pkey |

Gate functions (all `SECURITY DEFINER`, `STABLE`, `set search_path = public`, EXECUTE for `authenticated`): `is_staff()`, `is_console_agent()` (= `is_staff()` AND `console_agents.vox_active`), `has_platform_permission(_key)`, `is_platform_owner()`, `can_access_event(...)`. Existing console policies call `is_console_agent()` **unwrapped**; the linter's 0003 check only targets `auth.*`/`current_setting`, so no WARN today, but new policies must wrap per house rule.

Side finding (out of scope, follow-up): `campaigns`, `contacts`, `billed_results`, `outreach_state`, `rsvp_responses` still carry `anon=arwdDxtm`-class grants. RLS refuses (no anon policies), but that leaves RLS as the only layer — the same deviation 20260721005000 fixed for the console tables.

### 2.3 Measured behaviour as each console agent (read-only, `begin … rollback`)

Harness (proven working today; this is the smoke test for §6):

```sql
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from public.console_agents order by created_at offset :ix limit 1),
                    'role', 'authenticated')::text, true);
set local role authenticated;
select public.is_console_agent(), (select count(*) from public.console_events), (select count(*) from public.events), ...;
rollback;
```

| agent | platform role | `view_customer_data` | console_events (view) | events (direct) | console_event_guests (view) | guests (direct) | console_me.permissions |
|---|---|---|---|---|---|---|---|
| #0 | owner | yes | 3 | 2 (owns 2) | 47 | 45 | 12 keys |
| **#1** | owner | yes | **3** | **0** | **47** | **0** | 12 keys |
| #2 | owner | yes | 3 | 2 | 47 | 45 | 12 keys |

Agent #1 is staff but owns no events: **the invoker path without new policies returns zero rows** — the 20260720193844 rationale holds. Full baseline for agent #1 through today's definer views (VERIFIED-LIVE, the numbers §7.1 must reproduce after apply): console_events 3, console_campaigns 3, console_event_guests 47, console_campaign_targets 41, console_rsvp_results 45, console_call_analysis 20, console_me.permissions 12. All three enrolled agents hold the `owner` platform role today (VERIFIED-LIVE); the RBAC matrix in `docs/project/02-auth-and-authorization.md` §6A.2 defines `support_agent`/`auditor`/`ops_engineer` roles that are currently unstaffed but whose permission gaps (`view_customer_data`, `view_billing`) are what the column classes above protect.

## 3. Consumers of the views (what must keep working)

- Browser: `src/app/(admin)/admin/layout.tsx` reads `console_me (vox_username, display_name)` to mount the softphone; `src/components/console/softphone-panel.tsx` reads `console_event_guests (guest_id, event_id, guest_name, rsvp_status, phone)` filtered by `event_id` + `guest_id`; `src/app/(admin)/admin/voice/console/page.tsx` reads `console_me`.
- Android (`docs/voice-agent/app-integration-reference.md` §1.1, §2): reads **all** console views via PostgREST with the agent JWT; gates its UI on **`console_me.permissions`** (`text[]`); documents `console_event_guests.phone` as "`null` without `view_customer_data`" and the dial rule `dialable AND has_active_campaign AND can_start_outreach_call`.
- Workers/server use `createAdminClient` (service_role, BYPASSRLS) — untouched by anything here.

## 4. Findings that shape the option choice

1. **Row policies widen columns.** An additive `is_console_agent()` SELECT policy exposes every granted column of the base table to `GET /rest/v1/<table>` for every console agent. The view projection stops being the boundary. Per §2.2 this reaches guest phones/tokens, card and pricing data, `locked_price`, call access tokens and recording URLs.
2. **Option C as sketched is insufficient.** Gating only `contacts` on `view_customer_data` still leaks the phone via `guests.phone` (raw column) and the RSVP bearer token via `guests.rsvp_token`. Gating `guests` on `view_customer_data` instead removes guest *names* for agents without that key and changes the Android contract from "phone is null" to "no rows".
3. **`console_events` depends on `campaigns`** through two `EXISTS` subqueries; under invoker they run under `camp_org_select` and `has_campaign` becomes false for non-owner agents. Needs either a campaigns policy (Tier B, no) or a scalar helper.
4. **`console_me` needs the platform RBAC tables** readable by the agent (own `platform_staff` row + the role/permission catalog); otherwise `permissions` is `{}` and the Android UI hides every control.
5. **`call_attempts` has no `authenticated` grant** (0/34 columns) — an invoker view touching it fails with 42501 (the `show_meal_pref` precedent) unless a grant + policy is added, which would expose `access_token`.
6. **`vox_active` semantic shift.** `console_me` today lists an enrolled agent even if `vox_active = false` (self-row gate). Under invoker, `console_agents_select` requires `is_console_agent()` (which requires `vox_active`), so an inactive agent gets an empty `console_me` and no softphone. That matches the column's own comment ("FALSE means the console access gate treats this user as not a console agent") — accepted, documented.
7. **`create or replace view` without a `with (...)` clause replaces reloptions** (inferred from Postgres `DefineView` → `AT_ReplaceRelOptions`; to be confirmed in the rollback probe, §6.1). A future view redefinition would silently revert to definer — the corpus guard must assert `security_invoker` on the latest statement.
8. Function-backed views are never auto-updatable, which retires the write-through hole class that `console-view-grants.test.ts` exists to guard (three views are still "simply updatable" today and protected only by grants).

## 5. Option matrix

| # | Option | Security effect | Lint effect | Console breakage risk | Performance | Rollback |
|---|---|---|---|---|---|---|
| A | Keep definer views (status quo, accepted risk) | Unchanged; gate is inside the view; write hole closed by grants + test | 7 ERROR remain | none | unchanged | n/a |
| B | Invoker + `is_console_agent()` policies on ALL base tables | **Regression**: every column of guests/contacts/campaigns/billed_results/call_attempts readable by any agent via REST; phone mask bypassed | 7 → 0 ERROR; +9 WARN 0006 | low if grants added (`call_attempts` needs a new grant) | pushdown kept; +1 policy per table | drop policies, reset views |
| C | B, but `contacts` policy requires `view_customer_data`; `dialable` via tiny SECDEF boolean | Still leaks `guests.phone`, `guests.rsvp_token`, campaign card/pricing, `locked_price`, `access_token` (§4.2) | 7 → 0; +9 WARN | as B | as B | as B |
| D | Invoker only for views not touching `contacts` (`console_events`, `console_campaigns`, `console_call_analysis`, `console_rsvp_results`, `console_me`) | Still widens `campaigns` (card/pricing) and `guests` (via rsvp_results join) | 7 → 2 | medium (campaigns `EXISTS` in console_events) | pushdown kept | partial |
| E | Replace views with SECDEF RPC functions | Same trust model as today, explicit; but functions in `public` are REST-callable | ERROR 0010 → WARN `authenticated_security_definer_function_executable` (24 → 31) | **high**: Android/browser must switch from `/rest/v1/<view>` to `/rest/v1/rpc/<fn>` | no pushdown | drop functions, recreate views |
| F | Move views to a non-exposed schema + server route | Strongest boundary (server gate + audit) | 7 → 0 (not linted) | **very high**: Android reads PostgREST directly; would need an API layer and app release | server hop per read | move back |
| G | Invoker views over SECDEF **table functions in `private`** (body = today's SELECT, verbatim) | Identical semantics; gate explicit; `search_path=''`; not REST-callable; views no longer updatable | 7 → 0; **0 new WARN** | none (same columns, same URL, same filters) | **no predicate pushdown** (SECDEF SQL functions are not inlined) | drop functions, restore bodies |
| **H** | **Hybrid: policies where the base table has no protected column class (Tier A), G where it does (Tier B)** | Real RLS on events/call_analysis/rsvp_responses/platform_*; no widening on guests/contacts/campaigns/billed_results/call_attempts | 7 → 0; +7 WARN 0006 | none | pushdown kept on 4 views; lost on 3 | policies drop cleanly; bodies restored |

Rejected: B/C (security regression), E (client contract break, lint only downgraded), F (Android reality). A stays the documented fallback if the owner vetoes every widening flag in H — in that case G-for-all-7 is the uniform alternative (one mechanism, zero policies, zero WARN, no widening).

## 6. Recommendation: Option H

Tier A (invoker + additive policy): `console_me`, `console_events`, `console_call_analysis`, `console_rsvp_results`.
Tier B (invoker over `private` SECDEF table function): `console_campaigns`, `console_event_guests`, `console_campaign_targets`.
Two scalar helpers keep Tier-A views off Tier-B tables: `private.console_event_has_campaign(uuid)` and `private.console_guest_name(uuid)`.

**Owner decisions required before apply** (each "no" moves that view to Tier B, same migration shape):

| Flag | Table | Columns newly readable via REST by every active console agent |
|---|---|---|
| F1 | events | `notes`, `gift_payment_url`, `gift_link_token`, `celebrants`, `venue_*`, `invite_image_path`, `owner_id`, `status` |
| F2 | call_analysis | `cost_credits`, `cost_fiat`, `transcript_summary`, `summary_title`, `conversation_id` |
| F3 | rsvp_responses | `meal_pref`, `extras` |
| F4 | platform_* | role catalog and role→permission matrix to every staff member; own `platform_staff` row (`granted_by`) |
| F5 | vox_active=false agents lose `console_me` (§4.6) |

Conventions applied: `to authenticated`; `(select fn())` wrapping; names `<table>_console_select` / `<table>_staff_select` / `platform_staff_self_select` (matches `events_org_select`, `platform_staff_owner_select`); new SECDEF functions get `set search_path = ''`, fully-qualified names, `revoke … from public, anon` then explicit EXECUTE; views keep `is_console_agent()` literally in their body (defense in depth and the corpus guard); revoke-first grants restated on all 7 views. No business facts in schema.

### 6.1 Migration SQL (single file; create it with `npx supabase migration new console_views_security_invoker`)

```sql
-- Console views → security_invoker (Supabase lint 0010) without widening what a
-- console agent can read.
--
-- WHY NOW: 7 console views run as postgres (rolbypassrls). Base-table RLS is
-- owner/org-scoped, so a plain flip breaks the console (verified live 2026-09-08:
-- agent #1 sees 3 events through console_events and 0 through events).
--
-- SHAPE (docs/db/console-views-security-invoker-plan-2026-09-08.md, option H):
--   Tier A — base tables with no protected column class get an additive
--            `is_console_agent()` / `is_staff()` SELECT policy; view flips to invoker.
--   Tier B — guests / contacts / campaigns / billed_results / call_attempts hold
--            phone, tokens, card + pricing data. They get NO console policy. The
--            three views over them become invoker views over SECURITY DEFINER table
--            functions in the non-exposed `private` schema (Supabase RLS guide:
--            keep SECDEF helpers out of API schemas; search_path = '').
--
-- ROLLBACK: see the "Rollback" block in the plan document (restores the five
-- previous view bodies verbatim, drops 7 policies, 5 functions, the schema).

-- ───────────────────────────── 0. private schema ────────────────────────────
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
comment on schema private is
  'SECURITY DEFINER helpers that must not be reachable through PostgREST. Not in [api].schemas.';

-- ───────────────────────────── 1. scalar helpers (Tier A views → Tier B facts) ──
create or replace function private.console_event_has_campaign(_event_id uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select public.is_console_agent()
     and exists (select 1 from public.campaigns c where c.event_id = _event_id);
$$;

create or replace function private.console_guest_name(_guest_id uuid)
returns text
language sql
stable security definer
set search_path = ''
as $$
  select g.full_name
  from public.guests g
  where g.id = _guest_id
    and public.is_console_agent();
$$;

-- ───────────────────────────── 2. table functions (Tier B views) ────────────
-- Bodies are today's view SELECTs verbatim (pg_get_viewdef, 2026-09-08), with
-- schema-qualified names and initplan-wrapped gates. Column names/types match the
-- existing views exactly so `create or replace view` is legal.
create or replace function private.console_campaign_rows()
returns table (
  id uuid, event_id uuid, status public.campaign_status, enabled boolean,
  start_at timestamptz, close_at timestamptz, max_contacts integer,
  created_at timestamptz, updated_at timestamptz)
language sql
stable security definer
set search_path = ''
as $$
  select c.id, c.event_id, c.status,
         c.status = 'active'::public.campaign_status,
         c.start_at, c.close_at, c.max_contacts, c.created_at, c.updated_at
  from public.campaigns c
  where (select public.is_console_agent());
$$;

create or replace function private.console_event_guest_rows()
returns table (
  guest_id uuid, event_id uuid, guest_name text, dialable boolean, phone text,
  rsvp_status text, has_active_campaign boolean, reached_at timestamptz,
  callback_scheduled_at timestamptz, can_start_outreach_call boolean,
  call_block_reason text)
language sql
stable security definer
set search_path = ''
as $$
  select g.id, g.event_id, g.full_name,
         (c.normalized_phone is not null and c.removal_requested = false),
         case when (select public.has_platform_permission('view_customer_data'))
              then c.normalized_phone else null end,
         g.status::text,
         exists (select 1 from public.campaigns cp
                 where cp.event_id = g.event_id
                   and cp.status = 'active'::public.campaign_status),
         br.reached_at,
         cb.callback_scheduled_at,
         (br.reached_at is null and cb.callback_scheduled_at is null),
         case when br.reached_at is not null then 'already_reached'
              when cb.callback_scheduled_at is not null then 'callback_scheduled'
              else null end
  from public.guests g
  left join public.contacts c on c.id = g.contact_id
  left join lateral (
    select b.reached_at from public.billed_results b
    where b.event_id = g.event_id and b.contact_id = g.contact_id) br on true
  left join lateral (
    select min(ca.callback_iso) as callback_scheduled_at from public.call_attempts ca
    where ca.event_id = g.event_id and ca.contact_id = g.contact_id
      and ca.callback_iso is not null and ca.callback_dispatched_at is null) cb on true
  where (select public.is_console_agent());
$$;

create or replace function private.console_campaign_target_rows()
returns table (
  id uuid, event_id uuid, campaign_id uuid, contact_id uuid, status text,
  current_step_index integer, next_run_at timestamptz, reached_at timestamptz,
  reached_channel public.campaign_channel, stop_reason text, guest_name text,
  phone text)
language sql
stable security definer
set search_path = ''
as $$
  select o.id, o.event_id, o.campaign_id, o.contact_id, o.status,
         o.current_step_index, o.next_run_at, o.reached_at, o.reached_channel,
         o.stop_reason,
         g.full_name,
         case when (select public.has_platform_permission('view_customer_data'))
              then c.normalized_phone else null end
  from public.outreach_state o
  left join public.contacts c on c.id = o.contact_id
  left join public.guests g
    on g.event_id = o.event_id
   and regexp_replace(replace(g.phone, '-', ''), '^0', '+972') = c.normalized_phone
  where (select public.is_console_agent());
$$;

revoke all on function
  private.console_event_has_campaign(uuid),
  private.console_guest_name(uuid),
  private.console_campaign_rows(),
  private.console_event_guest_rows(),
  private.console_campaign_target_rows()
from public, anon;
grant execute on function
  private.console_event_has_campaign(uuid),
  private.console_guest_name(uuid),
  private.console_campaign_rows(),
  private.console_event_guest_rows(),
  private.console_campaign_target_rows()
to authenticated, service_role;

-- ───────────────────────────── 3. Tier A policies (additive) ────────────────
-- Grants verified live: authenticated already holds SELECT on every table below.
drop policy if exists events_console_select on public.events;
create policy events_console_select on public.events
  for select to authenticated
  using ((select public.is_console_agent()));

drop policy if exists call_analysis_console_select on public.call_analysis;
create policy call_analysis_console_select on public.call_analysis
  for select to authenticated
  using ((select public.is_console_agent()));

drop policy if exists rsvp_responses_console_select on public.rsvp_responses;
create policy rsvp_responses_console_select on public.rsvp_responses
  for select to authenticated
  using ((select public.is_console_agent()));

-- console_me: own membership row + the role/permission catalog for any staff.
drop policy if exists platform_staff_self_select on public.platform_staff;
create policy platform_staff_self_select on public.platform_staff
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists platform_roles_staff_select on public.platform_roles;
create policy platform_roles_staff_select on public.platform_roles
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists platform_role_permissions_staff_select on public.platform_role_permissions;
create policy platform_role_permissions_staff_select on public.platform_role_permissions
  for select to authenticated
  using ((select public.is_staff()));

drop policy if exists platform_permission_definitions_staff_select on public.platform_permission_definitions;
create policy platform_permission_definitions_staff_select on public.platform_permission_definitions
  for select to authenticated
  using ((select public.is_staff()));

-- ───────────────────────────── 4. view (re)definitions ──────────────────────
-- Same column names, order and types as today. `with (security_invoker = true)`
-- is REQUIRED on every future `create or replace view` of these — CREATE OR
-- REPLACE VIEW replaces reloptions, a bare redefinition would reopen lint 0010.

create or replace view public.console_events with (security_invoker = true) as
  select s.id as event_id,
         s.name as event_name,
         s.event_type::text as event_type,
         s.event_date,
         s.has_campaign
  from (select e.*, private.console_event_has_campaign(e.id) as has_campaign
        from public.events e) s
  where (s.with_ai_calls = true or s.has_campaign)
    and (select public.is_console_agent());

create or replace view public.console_rsvp_results with (security_invoker = true) as
  select r.id, r.event_id, r.guest_id,
         private.console_guest_name(r.guest_id) as guest_name,
         r.attending, r.adults, r.kids, r.note, r.created_at
  from public.rsvp_responses r
  where (select public.is_console_agent());

create or replace view public.console_campaigns with (security_invoker = true) as
  select id, event_id, status, enabled, start_at, close_at, max_contacts,
         created_at, updated_at
  from private.console_campaign_rows()
  where (select public.is_console_agent());

create or replace view public.console_event_guests with (security_invoker = true) as
  select guest_id, event_id, guest_name, dialable, phone, rsvp_status,
         has_active_campaign, reached_at, callback_scheduled_at,
         can_start_outreach_call, call_block_reason
  from private.console_event_guest_rows()
  where (select public.is_console_agent());

create or replace view public.console_campaign_targets with (security_invoker = true) as
  select id, event_id, campaign_id, contact_id, status, current_step_index,
         next_run_at, reached_at, reached_channel, stop_reason, guest_name, phone
  from private.console_campaign_target_rows()
  where (select public.is_console_agent());

-- Bodies unchanged; only the execution identity flips.
alter view public.console_call_analysis set (security_invoker = true);
alter view public.console_me            set (security_invoker = true);

-- ───────────────────────────── 5. grants (revoke-first, house rule) ─────────
revoke all on
  public.console_events, public.console_campaigns, public.console_campaign_targets,
  public.console_call_analysis, public.console_rsvp_results, public.console_me,
  public.console_event_guests
from anon, authenticated;
grant select on
  public.console_events, public.console_campaigns, public.console_campaign_targets,
  public.console_call_analysis, public.console_rsvp_results, public.console_me,
  public.console_event_guests
to authenticated;
```

Notes on the SQL:

- `language sql` SECDEF functions are **not inlined** by the planner, so PostgREST filters (`?event_id=eq.X`) apply after the function returns the full set. Today: `console_event_guests` = 47 rows with two indexed lateral lookups each. Threshold to revisit: if platform-wide guests exceed roughly 20k or the softphone refresh shows >100 ms in `pg_stat_statements`, add an `_event_id uuid` parameter and expose a second, parameterised RPC for the hot path.
- `campaigns` has only a partial `(event_id) where status <> 'cancelled'` index. `console_event_has_campaign` and the `has_active_campaign` subquery scan it (5 rows today, same as the current views). Optional follow-up: `create index campaigns_event_idx on public.campaigns (event_id)`.
- `with (security_invoker = true)` on `create or replace view` is valid syntax (Postgres `CREATE VIEW ... [ WITH ( view_option ... ) ] AS query`); the explicit `alter view ... set` is used only where the body is untouched.

### 6.2 Rollback SQL

```sql
-- 1. views back to definer with their previous bodies (pg_get_viewdef 2026-09-08)
create or replace view public.console_events as
  select e.id as event_id, e.name as event_name, e.event_type::text as event_type, e.event_date,
         (exists (select 1 from public.campaigns c where c.event_id = e.id)) as has_campaign
  from public.events e
  where (e.with_ai_calls = true or (exists (select 1 from public.campaigns c where c.event_id = e.id)))
    and public.is_console_agent();

create or replace view public.console_rsvp_results as
  select r.id, r.event_id, r.guest_id, g.full_name as guest_name, r.attending, r.adults, r.kids, r.note, r.created_at
  from public.rsvp_responses r
  left join public.guests g on g.id = r.guest_id
  where public.is_console_agent();

create or replace view public.console_campaigns as
  select id, event_id, status, status = 'active'::public.campaign_status as enabled,
         start_at, close_at, max_contacts, created_at, updated_at
  from public.campaigns c
  where public.is_console_agent();

create or replace view public.console_event_guests as
  select g.id as guest_id, g.event_id, g.full_name as guest_name,
         c.normalized_phone is not null and c.removal_requested = false as dialable,
         case when public.has_platform_permission('view_customer_data') then c.normalized_phone else null::text end as phone,
         g.status::text as rsvp_status,
         (exists (select 1 from public.campaigns cp where cp.event_id = g.event_id and cp.status = 'active'::public.campaign_status)) as has_active_campaign,
         br.reached_at, cb.callback_scheduled_at,
         br.reached_at is null and cb.callback_scheduled_at is null as can_start_outreach_call,
         case when br.reached_at is not null then 'already_reached'::text
              when cb.callback_scheduled_at is not null then 'callback_scheduled'::text
              else null::text end as call_block_reason
  from public.guests g
  left join public.contacts c on c.id = g.contact_id
  left join lateral (select b.reached_at from public.billed_results b where b.event_id = g.event_id and b.contact_id = g.contact_id) br on true
  left join lateral (select min(ca.callback_iso) as callback_scheduled_at from public.call_attempts ca
                     where ca.event_id = g.event_id and ca.contact_id = g.contact_id and ca.callback_iso is not null and ca.callback_dispatched_at is null) cb on true
  where public.is_console_agent();

create or replace view public.console_campaign_targets as
  select o.id, o.event_id, o.campaign_id, o.contact_id, o.status, o.current_step_index, o.next_run_at,
         o.reached_at, o.reached_channel, o.stop_reason, g.full_name as guest_name,
         case when public.has_platform_permission('view_customer_data') then c.normalized_phone else null::text end as phone
  from public.outreach_state o
  left join public.contacts c on c.id = o.contact_id
  left join public.guests g on g.event_id = o.event_id
        and regexp_replace(replace(g.phone, '-'::text, ''::text), '^0'::text, '+972'::text) = c.normalized_phone
  where public.is_console_agent();

alter view public.console_events           reset (security_invoker);
alter view public.console_rsvp_results     reset (security_invoker);
alter view public.console_campaigns        reset (security_invoker);
alter view public.console_event_guests     reset (security_invoker);
alter view public.console_campaign_targets reset (security_invoker);
alter view public.console_call_analysis    reset (security_invoker);
alter view public.console_me               reset (security_invoker);

-- 2. policies
drop policy if exists events_console_select                       on public.events;
drop policy if exists call_analysis_console_select                on public.call_analysis;
drop policy if exists rsvp_responses_console_select               on public.rsvp_responses;
drop policy if exists platform_staff_self_select                  on public.platform_staff;
drop policy if exists platform_roles_staff_select                 on public.platform_roles;
drop policy if exists platform_role_permissions_staff_select      on public.platform_role_permissions;
drop policy if exists platform_permission_definitions_staff_select on public.platform_permission_definitions;

-- 3. helpers + schema (views no longer depend on them after step 1)
drop function if exists private.console_campaign_target_rows();
drop function if exists private.console_event_guest_rows();
drop function if exists private.console_campaign_rows();
drop function if exists private.console_guest_name(uuid);
drop function if exists private.console_event_has_campaign(uuid);
drop schema if exists private;
```

Grants on the views survive both directions (`create or replace view` preserves ACLs — verified live per the test's own note).

## 7. Verification

### 7.1 Before apply — rollback probe (needs owner approval: DDL inside a transaction, rolled back)

House precedent: rollback probe is the only pre-apply verification available on this plan (no branching). Run the migration body plus the §2.3 smoke inside one transaction and roll back:

```sql
begin;
-- <paste §6.1 migration body>
-- smoke as agent #1 (owns no events):
select set_config('request.jwt.claims', json_build_object('sub',
  (select user_id from public.console_agents order by created_at offset 1 limit 1),
  'role','authenticated')::text, true);
set local role authenticated;
select (select count(*) from public.console_events)         as v_events,        -- expect 3
       (select count(*) from public.console_event_guests)   as v_guests,        -- expect 47
       (select count(*) from public.console_campaign_targets) as v_targets,     -- expect 41
       (select count(*) from public.console_campaigns)      as v_camp,          -- expect 3
       (select count(*) from public.console_rsvp_results)   as v_rsvp,          -- expect 45
       (select count(*) from public.console_call_analysis)  as v_ca,            -- expect 20
       (select cardinality(permissions) from public.console_me) as me_perms,    -- expect 12
       (select count(*) from public.campaigns)              as t_camp_direct,   -- expect 0 (Tier B untouched)
       (select count(*) from public.contacts)               as t_contacts_direct, -- expect 0
       (select count(*) from public.events)                 as t_events_direct; -- expect 3 (F1 widening, visible)
reset role;
select relname, reloptions from pg_class where relname like 'console_%' and relkind = 'v';
rollback;
```

Also inside the probe: `create or replace view public.console_me as <same body>` **without** `with (...)`, then read `reloptions` — confirms finding §4.7 (expected: option cleared). After `rollback`, re-read `pg_class.reloptions` for the 7 views: all must still be `null`, proving nothing leaked. Run via `npx supabase db query --linked -f probe.sql` (runs as `postgres`; the file must execute as one session so `begin/rollback` bracket everything — check the reloptions readback rather than trusting the CLI).

### 7.2 Apply

1. `npx supabase migration list --linked` clean (no drift; no Codex build lock held).
2. `npx supabase migration new console_views_security_invoker` → paste §6.1.
3. `npx supabase db push --linked` (single additive file). Exit code 1 can still mean "Finished" — read the output.
4. `npx supabase db advisors --linked` — expectations:
   - `security_definer_view`: **7 → 0**.
   - `multiple_permissive_policies`: 5 → **12** (events, call_analysis, rsvp_responses, platform_staff, platform_roles, platform_role_permissions, platform_permission_definitions). Accepted for this step; consolidation follow-up in §8.
   - `authenticated_security_definer_function_executable`: **24 → 24** (new functions live in `private`, not exposed). If it rises, the schema is exposed — stop and check `[api].schemas`.
   - `function_search_path_mutable`: 9 → 9 (all new functions set `search_path = ''`).
5. Smoke (§7.1 query without the DDL) for agents #0, #1, #2: view counts unchanged from §2.3; `console_me.permissions` still 12 keys; direct `campaigns`/`contacts`/`guests`/`billed_results` counts unchanged from §2.3 (0 for agent #1).
6. Negative smoke: same harness with `sub` = a customer user that is not staff → every console view returns 0 rows; `select vox_password from public.console_agent_secrets` → 42501 (unchanged).
7. Browser: `/admin` loads with the softphone gate (layout `console_me` read), `/admin/voice/console` renders, softphone guest lookup returns `guest_name` + `phone` for an owner-role agent. Android: event list, guest list (dial affordance computed from `dialable/has_active_campaign/can_start_outreach_call`), `permissions` array non-empty. No app change needed — same view names, columns, filters.
8. `npm run gen:types` → `git diff --stat src/lib/supabase/types.generated.ts` expected **empty** (same columns/types; generator only covers `public`). Any delta is a signal the column list drifted — stop.
9. `npx vitest run src/lib/supabase/console-view-grants.test.ts` — passes without changes: the new migration restates `revoke … from authenticated` on all seven views (satisfies the grants guard, which anchors on first creation), and every latest body still contains the literal `is_console_agent()` (`console_me` keeps `auth.uid()`; no body contains `locked_price`).
10. **Add** a guard in the same test file (or a sibling): for each view in `EXPECTED_VIEWS`, the latest `create … view` statement must contain `security_invoker = true`, or a later `alter view <name> set (security_invoker` must exist — this is what stops a future bare `create or replace view` from reopening lint 0010 (§4.7).
11. `EXPLAIN (analyze, buffers)` on `select * from console_event_guests where event_id = '<id>' and guest_id = '<id>'` as an agent, before and after, to record the pushdown loss in the migration PR.
12. Update `docs/project/02-auth-and-authorization.md` §6B (the sentence "בבעלות postgres ללא security_invoker … ידוע ומקובל" is no longer true) and `docs/voice-agent/app-integration-reference.md` (no contract change; note the `vox_active=false` behaviour of `console_me`).

## 8. Risks and follow-ups

- **Widening flags F1–F5 (§6)** are the only security-relevant changes; each needs an explicit owner "yes". Tier B tables (guests, contacts, campaigns, billed_results, call_attempts) get no new policy and no new grant; `call_attempts` stays at 0/34 columns for `authenticated`.
- **Phone mask** is preserved exactly (`has_platform_permission('view_customer_data')` inside the SECDEF functions). It remains a projection, not a row boundary; the row boundary for phones stays the absence of any console policy on `guests`/`contacts`.
- **Multiple permissive policies**: +7 WARN 0006. Postgres ORs permissive policies; with the initplan wrapper the console predicate costs one function call per statement, so the measurable overhead is negligible at current row counts. Follow-up migration (after the console has run on H for a while): fold `(select public.is_console_agent())` into `events_org_select`, `call_analysis_owner_select`, `rsvp_org_read`, and replace the four `platform_*_owner_select` policies with the staff/self predicates (`is_platform_owner()` ⊂ `is_staff()`), returning 0006 to today's 5.
- **Pushdown loss** on the three function-backed views (threshold in §6.1 notes).
- **Existing owner/org policies untouched**; `service_role` untouched; workers (`createAdminClient`) unaffected; RLS remains layer two behind server gates.
- **`private` schema is a new convention** (24 existing SECDEF helpers live in `public`). It is the shape the Supabase RLS guide shows; migrating the old helpers is out of scope.
- **Side finding** (§2.2): `anon` still holds full table grants on `campaigns`, `contacts`, `billed_results`, `outreach_state`, `rsvp_responses`. Separate hygiene migration, same pattern as 20260721005000 Part B.
- Types: `types.ts` (MergeDeep overrides) unaffected; if `gen:types` shows a delta, do not hand-edit — investigate the view column list.
