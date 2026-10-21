# Verification: harden-console-agent-permissions

Task 4.4. Every number below comes from a run on 21.10.2026 (IDT). The commands and raw outputs are under
`$TMPDIR/s2/final/` (scratch, outside the repo). Test layers are kept apart. A layer that did not run is
listed as a gap and never counted as evidence.

## 0. Status of the migrations

| Version | Stage | Git | Local DB | Production DB |
|---|---|---|---|---|
| `20261021020052_reconcile_local_only_to_prod` | (not this change) | `0e577c12` | applied | applied before this change |
| `20261021194728_console_roster_provisioned_helper_and_shift_grants` | S1 | `948f61a8` | applied | applied |
| `20261021195228_console_views_event_scope` | S2 | `9268f9f6` | applied | applied |
| `20261021195752_console_agent_helper_search_path` | S3 | `85bc87a8` | applied | applied |

- **The production deployment was not a planned step.** The Supabase GitHub integration applies
  `supabase/migrations` to production on a push to `main` once its *Supabase Preview* check passes. The
  push of `0e577c12` made the Preview pass, because it added the untracked `20261021020052` that production
  already listed. The integration then applied S1-S3.
- The earlier assumption that "push does not reach the database" came from reading `.github/workflows`
  only, and it was wrong.
- After the deployment, production was compared with local read-only (section 7). It is identical except
  for the known `support_agent` role.
- **Owner decision (21.10.2026): keep S1-S3 in production.** No revert migration is planned.
  `rollback-console.sql` stays available as the runbook.
- *Supabase Preview*:
  - failing since `9efc21c6`, with "Remote migration versions not found in local migrations directory";
  - green on `0e577c12`. CI `verify` is green on `0e577c12` too.

## 1. Database structure: before and after

"Before" means production and local before S1, read 21.10.2026. They were identical (parity task 1.3,
all SAME except `role_permissions`). "After" means local after S3, which also equals production after the
deployment.

| Object | Before | After | Stage |
|---|---|---|---|
| `console_agents_roster` view | `security_invoker=on`; `provisioned` = `vox_username IS NOT NULL AND cas.user_id IS NOT NULL` through `LEFT JOIN console_agent_secrets`; md5 `a97cffd7…` | same columns, order, types and grants; `provisioned` = `vox_username IS NOT NULL AND console_agent_provisioned(user_id)`; md5 `c8baad24…` | S1 |
| `console_agent_secrets` | policy `console_agent_secrets_select` (`is_console_agent()`); `attacl user_id {authenticated=r}` | no policy; no table or column privilege for `anon`/`authenticated` | S1 |
| `console_agent_shift` | `authenticated=arwdDxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN included); `update_own` = own row only | `authenticated=r`, plus column `INSERT, UPDATE (agent_id, active, updated_at)`; `update_own` = own row AND `(select is_console_agent())` | S1 |
| `console_events` | inline scope `with_ai_calls OR EXISTS(campaign)` AND `is_console_agent()`; md5 `81337873…` | `is_console_agent() AND console_event_in_scope(e.id)`; md5 `0642cf1d…` | S2 |
| `console_event_guests` | `is_console_agent()` only; md5 `285143c5…` | AND `console_event_in_scope(g.event_id)`; md5 `6924f3d4…` | S2 |
| `console_rsvp_results` | `is_console_agent()` only; md5 `7e35470e…` | AND `console_event_in_scope(r.event_id)`; md5 `d71e6662…` | S2 |
| `console_campaign_targets` | `is_console_agent()` only; md5 `ef2e4813…` | AND `console_event_in_scope(o.event_id)`; md5 `3ac07b2e…` | S2 |
| `console_call_analysis` | `call_attempt_id IS NOT NULL AND is_console_agent()`; md5 `549da860…` | AND (`event_id IS NULL` OR `console_event_in_scope(event_id)`); md5 `7b55509e…` | S2 |
| `is_console_agent()` | SECURITY DEFINER, `search_path=public`; body md5 `574aed8f…` | `search_path=""`; body unchanged | S3 |
| `human_agent_call_legs_update_own` | own row only | own row AND `(select is_console_agent())`; grants unchanged | S3 |

The column lists of all 8 console views are identical before and after (`information_schema.columns`,
compared with production before the change). Unchanged objects, pinned by the inventory test: the other
tables, `console_me`, `console_campaigns`, and every grant except those listed above.

Aggregate fingerprints (parity probe; md5 of sorted catalog text):

| Key | Before | After |
|---|---|---|
| views | `24c4298c…` | `76ef73ef…` |
| functions | `b883ca42…` | `8e795e6a…` |
| policies | `73420777…` | `b3815a80…` |
| relacl | `75e722ef…` | `6a1d8b6d…` |
| attacl | `c9d2ec72…` | `49e61cf8…` |
| helpers_present | none | `console_agent_provisioned`, `console_event_in_scope` |
| tables_views | 14 tables, 8 views | 14 tables, 8 views |

## 2. Objects that changed

**Views (6):**
- `console_agents_roster` (S1);
- `console_events`, `console_event_guests`, `console_rsvp_results`, `console_campaign_targets`,
  `console_call_analysis` (S2).

S2 bodies were generated from the live definitions, so each select list is byte-identical; only `WHERE`
changed. `create or replace view` kept owners and grants.

**SECURITY DEFINER functions:**

| Function | Change | Settings | EXECUTE |
|---|---|---|---|
| `console_agent_provisioned(uuid)` | new (S1) | `stable`, `search_path=""`, gated by `is_console_agent()` | `postgres`, `service_role`, `authenticated`; not `anon`/PUBLIC |
| `console_event_in_scope(uuid)` | new (S2) | `stable`, `search_path=""`, gated by `is_console_agent()` | same |
| `is_console_agent()` | `search_path` `public` → `""` (S3) | body unchanged and fully qualified | unchanged |

**GRANT:**
- `console_agent_secrets`: `revoke all from anon, authenticated` (removes `SELECT(user_id)`).
- `console_agent_shift`: `revoke all from anon, authenticated`; `grant select`;
  `grant insert/update (agent_id, active, updated_at)`. `agent_id` is needed because the PostgREST upsert
  sets `agent_id = excluded.agent_id`.
- Function grants as in the table above.

**Policies:**
- dropped `console_agent_secrets_select`;
- `console_agent_shift_update_own` and `human_agent_call_legs_update_own` gained
  `(select public.is_console_agent())` in both `USING` and `WITH CHECK`.

## 3. Test results, by layer

| Layer | What runs | Result | Evidence for |
|---|---|---|---|
| Unit, static (no DB) | `src/lib/supabase/console-view-grants.test.ts`, which parses `supabase/migrations` | part of 110/110 | latest view bodies: roster uses the helper; no view reads secrets; 5 views apply the scope helper; every view `is_console_agent()`-gated; grants revoked |
| Unit, mocks (no DB) | console provisioning, voximplant console routes, `api/agents/*` (9 files with the above) | 110 passed, 0 failed | route code paths only. **Not evidence of RLS/GRANT** (S-09: these pass without a database) |
| Integration, PostgreSQL local (SQL as the role, one transaction, ROLLBACK) | `src/lib/auth/console-views.local-it.test.ts` | **44 passed, 0 failed** | the matrix: personas × 8 views × 14 tables; S1/S2/S3 behaviour; workflows in client statement shapes; privilege inventory of 22 objects; legs device columns, with a red check |
| same | `src/lib/auth/console-findings.local-it.test.ts` | **15 passed, 0 failed** | per-finding behaviour after S1-S3 |
| same, regression | `src/lib/auth/permissions.local-it.test.ts` | **17 passed, 0 failed** | finding-4 matrix unaffected |
| same, harness | `src/lib/testing/cleanup.local-it.test.ts` | **20 passed, 0 failed** | fixture cleanup and isolation |
| PostgREST, local HTTP `127.0.0.1:54321` (real GoTrue user) | `src/lib/auth/console-rest.local-it.test.ts` | **8 passed, 0 failed** | anon 401/42501 on the 8 views, the server-only tables and the helper RPCs; regular user 0 rows on views and readable tables, 403/42501 on server-only tables incl. `console_agent_secrets.user_id`, filterless PATCH 400/21000, shift upsert 403/42501, helper RPCs return `false` |
| Realtime, live | none | **not run** | see section 6 |
| CI on `main` (`0e577c12`, run 39671088969) | `lint`, `tsc --noEmit`, `npx vitest run` | success | unit and static only. **The console `*.local-it` suites were skipped in CI**: console-views 44 skipped, console-findings 15, permissions 17, cleanup 20 (`describe.skipIf(!RUN)`, no `OUTREACH_DB_IT` and no database in CI). CI is not evidence for any integration row above. |

Every integration file ran alone through `scripts/integration/run-local.sh <file>` against
`supabase_db_beta` (label `com.supabase.cli.project=beta`, DB 54322, API 54321). Each run reported
"swept 0 leftover owner(s)" and "fingerprint unchanged after the run" (158 tables).

Earlier full runs on the same code: `npm run test` 13,169 passed, 2 expected fail; `npm run lint` and
`npx tsc --noEmit` clean.

## 4. Findings of design Appendix A (73), mapped to fixes and tests

Legend:
- **VT** `console-views.local-it`
- **FT** `console-findings.local-it`
- **RT** `console-rest.local-it`
- **GT** `console-view-grants` (static)

Kinds:
- **DB**: schema change;
- **DECISION**: behaviour kept on purpose;
- **DOC**: correction of the artifacts;
- **CTX**: context fact, no change;
- **OPEN**: open question.

Verdicts are the claim-level verdicts of the review (`findings.py`). They were not re-scored here. A
finding is counted once; MIXED findings keep each claim's verdict.

73 unique IDs, 97 claims: 89 confirmed, 2 refuted, 6 not verified. By fix kind: CTX 10, DB 16, DECISION 6, DOC 37, OPEN 4.

**Refuted claims** (the finding stays; only this claim was wrong):

- G2: an inactive agent can update its own shift row through a client (PostgREST)
- P02: an inactive agent can write its shift through a client

**Claims not verified** (each remains open; none is presented as fact):

- V-16: event names may contain customer personal data
- G3: no client channel can issue TRUNCATE
- W-07: the Android app's current DTO nullability
- W-11: the documents describe the app as it is today
- P05: a wider grant elsewhere would leave the current test green
- P22: archiving drops the delta Purpose section

| ID | Result | Kind | Fix mechanism | Verified by (now) | Claims (verdict, method) |
|---|---|---|---|---|---|
| V-01 | CONFIRMED | DECISION | console_me keeps the own row for an inactive agent (spec: inactive agent) | VT console_me; FT V-01/P01/P02 | console_me returns the inactive agent its own row (confirmed, BEH); spec R1 and R3 contradict for an inactive agent (confirmed, DOC) |
| V-02 | CONFIRMED | DB | S2 `20261021195228`: console_event_in_scope() on the 4 data views + console_events | VT S2/D3a scope (2 cases); FT V-02 after S2; GT scope guards | only console_events applies the AI-calls-or-campaign scope (confirmed, CAT); an agent reads guests and RSVP of an out-of-scope event (confirmed, BEH) |
| V-03 | CONFIRMED | CTX | no change; phone stays in 2 views, masked by view_customer_data | VT D2 work data; VT WITH view_customer_data | the phone column exists only in console_campaign_targets and console_event_guests (confirmed, CAT) |
| V-04 | CONFIRMED | DB | S1 `20261021194728`: provisioned via console_agent_provisioned() | VT S1/D4 roster; FT V-04/S-01; GT roster guard | roster filters on is_console_agent() and joins 4 base tables (confirmed, CAT); provisioned is computed from console_agent_secrets.user_id (confirmed, CAT+BEH) |
| V-05 | CONFIRMED | DOC | 8 views named everywhere | GT covers every console view; RT anon 8 views | there are 8 console views, not 7 (confirmed, CAT) |
| V-06 | CONFIRMED | DOC | D2 column classes list the RSVP answers | VT in-scope lists | RSVP answer columns exist and the old scenario/task omitted them (confirmed, CAT+DOC) |
| V-07 | CONFIRMED | DOC | spec defines work data and the masked identifier | artifact text | "needed to work" and "absent or masked" were undefined (confirmed, DOC) |
| V-08 | CONFIRMED | DECISION | D2: work data stays readable without view_customer_data | FT V-08/P20; VT D2 work data | an agent without view_customer_data reads rsvp_digit, chat body and console_calls ids (confirmed, BEH) |
| V-09 | CONFIRMED | DOC | access map + workflow requirement include the web softphone | VT console workflows (9 cases) | the in-repo web softphone reads console views with the user session (confirmed, CODE+REST) |
| V-10 | CONFIRMED | DECISION | colleague directory is a requirement | FT V-10; VT roster workflow | every active agent reads every console_agents row (confirmed, BEH) |
| V-11 | CONFIRMED | DOC | two-agent scenario added | VT console_me (only the caller) | the single positive scenario could not prove "never another agent" (confirmed, DOC) |
| V-12 | CONFIRMED | DECISION | mask wrapper and console_me filter unchanged (no behaviour change) | VT console_me; GT console_me self-row gate | the live phone mask has no (select ...) wrapper (confirmed, CAT); console_me filters on ca.user_id = auth.uid(), not is_console_agent() (confirmed, CAT) |
| V-13 | CONFIRMED | DOC | contact-identifier scenarios use one persona pair | VT phone cases | the "permitted agent sees today's data" rule was phrased with different personas (confirmed, DOC) |
| V-14 | CONFIRMED | DOC | spec names view_customer_data | VT phone cases | the spec named no permission key (confirmed, DOC) |
| V-15 | CONFIRMED | DOC | proposal wording: owner-rights views | artifact text | views carry no SECURITY DEFINER attribute; they run with owner rights (reloptions empty) (confirmed, CAT) |
| V-16 | MIXED | OPEN | OQ1: event names may hold personal data | not verified (needs production row content) | several view columns were not classified (confirmed, DOC+CAT); event names may contain customer personal data (not verified, needs production row data) |
| S-01 | CONFIRMED | DB | S1 `20261021194728`: helper replaces the roster join; secrets closed | VT S1/D4 roster; FT S-01/W-04/P11 after S1 | the roster is the client reader of secrets.user_id (confirmed, CAT+CODE); old D4 own-row policy makes colleagues provisioned=false (confirmed, SIM); old D4 alternative makes the roster fail with 42501 (confirmed, SIM); provisioned gates dial/transfer/consult targets in the softphone (confirmed, CODE) |
| S-02 | CONFIRMED | CTX | no change; vox_password only via service role (hash) | VT S1/D4 secrets refused; RT secrets 403 | vox_password reaches no client; the only reader returns a hash (confirmed, CAT+RUN+CODE) |
| S-03 | CONFIRMED | DOC | spec secrets wording covers service_role | VT S1/D4 no policy/privilege | service_role holds SELECT on vox_password and bypasses RLS (confirmed, CAT); no function or view exposes vox_password (confirmed, CAT) |
| S-04 | CONFIRMED | DB | S1 `20261021194728`: policy dropped, grants revoked | VT S1/D4 (2 cases); RT secrets 403 incl. user_id | "only where a console path needs it" was untestable (confirmed, DOC); every active agent lists every secret row today (confirmed, BEH) |
| S-05 | CONFIRMED | CTX | no change; both tables closed | FT S-05/S-06/P16; RT server-only 401/403 | console_agent_commands is closed exactly like console_call_pii (confirmed, CAT+BEH) |
| S-06 | CONFIRMED | DOC | closed-shape scenario: RLS on + no policy + no privilege | FT S-06 (simulated); VT privilege inventory | 42501 alone does not prove RLS (still 42501 with RLS disabled) (confirmed, SIM) |
| S-07 | CONFIRMED | DOC | non-agent outcomes per operation in spec | FT G3/S-07; RT regular user cases | non-agents get 42501, not zero rows, on closed tables (confirmed, BEH) |
| S-08 | CONFIRMED | CTX | grant/policy origin recorded in S1 header | migration header | 20260827123914 added the secrets grant/policy on purpose for the roster (confirmed, CODE(migration)) |
| S-09 | CONFIRMED | DOC | D6: integration tests are the evidence; mocks are smoke only | VT/FT/RT green; unit smoke 110/110 | the vox_password case is already green (confirmed, RUN); the 2.3 suites are mock-only and pass without a database (confirmed, RUN) |
| S-10 | CONFIRMED | CTX | estimate removed | artifact text | 1267 is a pg_stat estimate; the local table is empty (confirmed, CAT) |
| S-11 | CONFIRMED | DOC | old D4 replaced | artifact text | old D4 text was unwrapped and unqualified (confirmed, DOC) |
| G1 | CONFIRMED | DB | S1 `20261021194728`: revoke all + column grants on console_agent_shift | VT S1/D5 privileges; FT G1/G6 | authenticated holds MAINTAIN on console_agent_shift (confirmed, CAT+BEH) |
| G2 | MIXED | DB | S1 `20261021194728`: is_console_agent() in console_agent_shift_update_own | VT S1/D5 inactive agent; FT G2/P02 | console_agent_shift_update_own has no is_console_agent() (confirmed, CAT); an inactive agent can update its own shift row in raw SQL without WHERE (confirmed, BEH); an inactive agent can update its own shift row through a client (PostgREST) (refuted, REST+BEH) |
| G3 | MIXED | DB | S1 `20261021194728`: TRUNCATE/DELETE revoked | FT G3/S-07; VT privilege inventory | a non-agent gets 42501 on insert and 0 rows on update/delete (confirmed, BEH); authenticated can TRUNCATE console_agent_shift in SQL (confirmed, BEH); no client channel can issue TRUNCATE (not verified, inferred; PostgREST has no TRUNCATE operation, not exhaustively tested) |
| G4 | CONFIRMED | CTX | policies described as they are | artifact text | the shift policies differ from the old design wording (confirmed, CAT) |
| G5 | CONFIRMED | DOC | spec Purpose includes the 3 non-prefixed tables | FT G5/P24; VT privilege inventory (22 objects) | agent_status, call_dispatch_status, human_agent_call_legs are gated by is_console_agent() (confirmed, CAT+BEH) |
| G6 | CONFIRMED | DOC | inventory uses has_table_privilege (MAINTAIN visible) | VT privilege inventory | information_schema omits MAINTAIN (confirmed, CAT) |
| G7 | CONFIRMED | DOC | map covers views and PUBLIC | VT privilege inventory | R6 excluded views and PUBLIC (confirmed, DOC) |
| G8 | CONFIRMED | DECISION | queues/presence SELECT-only kept | FT G8/W-03; VT privilege inventory | queues, agent queues and presence are SELECT-only for clients; writes use the service role (confirmed, CAT+BEH+CODE) |
| G9 | CONFIRMED | DOC | shift grants rebuilt once (S1 only) | S1 `20261021194728` only | the shift grant rebuild was duplicated across S1 and S3 (confirmed, DOC) |
| G10 | CONFIRMED | CTX | facts confirmed | artifact text | the table rows and is_console_agent() facts are accurate (confirmed, CAT) |
| G11 | CONFIRMED | DB | S3 `20261021195752`: is_console_agent() search_path = '' | VT helpers search_path; FT G11; all suites green after S3 | search_path='' on is_console_agent() keeps correct answers (confirmed, SIM) |
| W-01 | CONFIRMED | DOC | impact names the web softphone | VT console workflows | the web admin softphone is a user-session console client (confirmed, CODE+REST); queues and presence are read only through the service role (confirmed, CODE) |
| W-02 | CONFIRMED | DOC | provisioning path corrected | artifact text | provisioning runs from /admin/roles, not /admin/voice (confirmed, CODE) |
| W-03 | CONFIRMED | DOC | workflow list rebuilt from code | VT console workflows | the old R7 list missed real workflows and listed queues (confirmed, CODE+CAT) |
| W-04 | CONFIRMED | DB | S1 `20261021194728`: roster flag unchanged by design | VT roster provisioned 3/3 | old D4 breaks the roster provisioned flag (confirmed, SIM) |
| W-05 | CONFIRMED | DOC | D6: red/green on a real database | S1 cases were red before the migration, green after | task 2.3 could not turn red (confirmed, RUN) |
| W-06 | CONFIRMED | DOC | task 1.1 access map | design: Console access map | task 1.1 omitted the roster and several sources; voximplant/functions have no console access (confirmed, CAT+CODE) |
| W-07 | MIXED | OPEN | OQ2: Android out of scope | partly: contract docs read; app DTOs not verified | the Android contract is in the repo and models phone as nullable (confirmed, DOC); nothing in the repo evidences strict parsing / a crash on NULL (confirmed, DOC); the Android app's current DTO nullability (not verified, separate repository) |
| W-08 | CONFIRMED | DOC | one workflow list | artifact text | the workflow list was repeated with different subsets (confirmed, DOC) |
| W-09 | CONFIRMED | CTX | permission gates stay in routes | route code (unchanged) | no console policy uses a permission key; gates are route-level (confirmed, CAT+CODE) |
| W-10 | CONFIRMED | CTX | shift origin recorded | artifact text | console_agent_shift originates in 20260812200243 and holds MAINTAIN (confirmed, CAT+CODE) |
| W-11 | MIXED | OPEN | OQ2 | partly: documents only | the repo documents that Android reads the console views (confirmed, DOC); the documents describe the app as it is today (not verified, documents come from app commit cc89325) |
| P01 | CONFIRMED | DOC | inactive agent sees its console_me row | FT V-01/P01/P02 | design said inactive agent gets 0 rows; console_me returns 1 (confirmed, BEH) |
| P02 | MIXED | DB | S1 `20261021194728`: shift update gated | FT G2/P02; VT S1/D5 inactive agent | console_me returns the inactive agent its row (confirmed, BEH); an inactive agent can write its shift through a client (refuted, REST+BEH); an inactive agent can write its shift in raw SQL (confirmed, BEH) |
| P03 | CONFIRMED | DOC | fixtures create roles inside the transaction | VT fixtures control case | the test relies on seeded roles (confirmed, CODE+CAT) |
| P04 | CONFIRMED | DOC | key holder reads notes/analysis | FT P04 | key-holder notes/analysis were not asserted (confirmed, CODE) |
| P05 | MIXED | DB | full inventory replaces the single-table check | VT privilege inventory (a wider grant now fails it) | the only grant inventory covers console_agent_secrets via information_schema (confirmed, CODE+CAT); a wider grant elsewhere would leave the current test green (not verified, needs a committed grant; shown by code only) |
| P06 | CONFIRMED | DOC | one description of flipping cases | artifact text | proposal and design described the flipping cases differently (confirmed, DOC) |
| P07 | CONFIRMED | DOC | matrix covers 22 objects incl. roster | VT 44 cases | the test covered 8 of 19 objects and not the roster (confirmed, CODE); S1 changes the roster output (confirmed, SIM) |
| P08 | CONFIRMED | DOC | "eight views" | artifact text | "seven views" where eight exist (confirmed, CAT) |
| P09 | CONFIRMED | DB | S1 `20261021194728`: MAINTAIN revoked | VT S1/D5 privileges | MAINTAIN missing from proposal and task 2.1 (confirmed, CAT+DOC) |
| P10 | CONFIRMED | DOC | run one file at a time | ground rules | run-local.sh without a file runs every local-it file (confirmed, CODE(config glob)) |
| P11 | CONFIRMED | DB | S1 `20261021194728`: old D4 alternative not used | FT S-01/W-04/P11 after S1 | old D4 alternative contradicted R4 and the roster (confirmed, SIM) |
| P12 | CONFIRMED | DB | shift upsert in PostgREST shape tested | VT S1/D5 upsert; VT own state; RT shift upsert | the shift upsert user-session path had no test (confirmed, RUN+CODE) |
| P13 | CONFIRMED | DOC | section labelled S0 | artifact text | section 1 was not labelled S0 (confirmed, DOC) |
| P14 | CONFIRMED | DOC | parity task 1.3 + production comparison | this document, Production | the parity re-run was promised but not in the tasks (confirmed, DOC) |
| P15 | CONFIRMED | DECISION | no per-agent key (D2) | artifact text | the per-agent key decision had no task (confirmed, DOC) |
| P16 | CONFIRMED | DOC | closed tables: 3 | FT S-05/S-06/P16; RT server-only | R5 named only console_call_pii (confirmed, CAT+BEH) |
| P17 | CONFIRMED | DB | S3 `20261021195752`: search_path requirement + change | VT helpers search_path | search_path on is_console_agent() had no requirement (confirmed, DOC) |
| P18 | CONFIRMED | DOC | no new key | artifact text | proposal said "possibly a new key" while D2 reused one (confirmed, DOC) |
| P19 | CONFIRMED | DOC | static guard extended | GT 8 views + roster + scope guards | console-view-grants.test.ts pins the 8 views (confirmed, RUN) |
| P20 | CONFIRMED | DB | S2 `20261021195228` views; tables already gated | FT V-08/P20; VT S2/D3a | "every console view and table" while S2 covered views only (confirmed, BEH) |
| P21 | CONFIRMED | DOC | files committed | git 77d2e4e4, ed60c04a | the test file and change were untracked (confirmed, RUN(git)) |
| P22 | MIXED | OPEN | OQ3: archive vs Purpose | not verified (archive not run) | openspec validate --strict is valid with 8 ADDED deltas (confirmed, RUN); archiving drops the delta Purpose section (not verified, archive writes files; not run) |
| P23 | CONFIRMED | CTX | counts confirmed | artifact text | the counts 11 tables, 2 agents, 21 cases, 6 personas are correct (confirmed, CAT+RUN) |
| P24 | CONFIRMED | DOC | "console table" defined | FT G5/P24 | "console table" was undefined and the 3 gated tables were excluded (confirmed, CAT+BEH) |

## 5. Supabase Advisors

**Local, after S1-S3** (`supabase db advisors --db-url …54322 --type all --level info`):
- 202 findings: 7 ERROR, 10 WARN, 185 INFO.
- The only console-related structural difference from the pre-change baseline:
  `rls_enabled_no_policy` INFO on `console_agent_secrets`. This is intended, the same closed shape as
  `console_call_pii` and `console_agent_commands`.

The local Advisors set lacks three rules that production runs: `authenticated_security_definer_function_executable`,
`extension_in_public` and `auth_db_connections_absolute`. So "is_console_agent resolved" in a local versus
production diff is an artifact of the environment, not a fix. `unused_index` differences depend on usage
statistics and are not compared.

**Production, before and after** (read-only `--linked`, same rule set, to cover the rule missing locally):

| Rule (console objects) | Before | After |
|---|---|---|
| `security_definer_view` ERROR × 7 (console views) | present | unchanged. Known, intended exception: the views run with owner rights by design (`20260720193844`) |
| `rls_enabled_no_policy` INFO | `console_agent_commands`, `console_call_pii` | + `console_agent_secrets` (intended) |
| `authenticated_security_definer_function_executable` WARN | `is_console_agent` | + `console_agent_provisioned`, `console_event_in_scope` |
| `unindexed_foreign_keys` INFO × 8 | present | unchanged |

**Assessment of the two new WARNs.** Both helpers are callable as `/rest/v1/rpc/...`. Each returns
`false` unless the caller is an active console agent. For an active agent, the answer is information the
agent already reads: `console_agents_roster.provisioned` and the `console_events` list.

Verified over HTTP (RT, "helper RPCs"):
- anon: 401 / 42501;
- a regular user: `false`, even for an event that is in scope.

No new exposure, so this is **accepted**. Removing the WARN would mean moving the helpers to a schema the
Data API does not expose. That is listed as a deferred option (section 9).

## 6. Verification gaps that remain

**HTTP:**
- Agent personas were exercised in SQL, as the role in a transaction, and in the exact statement shape
  PostgREST sends (`WHERE` + `RETURNING`, the upsert with `on conflict … set agent_id = excluded.agent_id`).
  They were not exercised over HTTP. The reason is design D6 / decision 1.4: an agent needs committed
  `platform_staff` + `console_agents` rows, which only FixtureScope's GoTrue cleanup removes.
- Over HTTP only anon and a regular user were tested. The HTTP-specific codes (401 versus 403, 400/21000)
  are covered for them.
- The application routes (`/api/agents/*`, `/api/console-calls/*`, `/api/calls/*`) were not called over
  HTTP against the migrated database. Their unit tests use mocks.

**Realtime:** no live subscription was run. What is proven:
- `console_calls`, `console_call_feed` and `console_chat_messages` keep `SELECT` for `authenticated` and
  their `is_console_agent()` select policies (VT "Realtime tables…");
- S1-S3 did not touch any select policy of the 6 published tables (`agent_status`, `call_dispatch_status`
  and `human_agent_call_legs` included; inventory test).

Not proven: event delivery to a subscribed agent after the change, and non-delivery to an inactive agent.
A live check needs committed agent fixtures and a Realtime client against `127.0.0.1:54321`.

**Production behaviour:** a read-only transaction as an active production agent returned counts only:

| Check | Result |
|---|---|
| roster | 2 rows, 2 provisioned (expected 2 and 2) |
| `console_me` | 1 |
| events | 8 of 8 in scope |
| guests | 45 of 45 in scope |
| privilege on `console_agent_secrets` | none |

No softphone session (dial, transfer, shift toggle) was exercised in production.

**Open questions, still open:**
- OQ1 (V-16): event names may hold personal data;
- OQ2 (W-07, W-11): Android;
- OQ3 (P22): archive versus the Purpose section.

## 7. Production comparison (workflow follow-up)

After the deployment, the catalog probes used for the local after-state were run read-only on production:
- `s1-live` (roster, secrets, shift);
- view md5 (5);
- view columns (8);
- `chat-legs`;
- `s3-live`;
- parity fingerprint.

All are **SAME** as local, except `role_permissions`, where production also has `support_agent` (known,
pre-existing).

## 8. Rollback

The migration headers were **not** edited, because they are recorded in the history. They are incomplete
as a rollback:
- S2's header gives only md5 values and file names for the old view bodies.
- S1's header does not revoke the new column grants on `console_agent_shift`. Without that, stray
  `attacl` entries remain.

The full procedure is in **`rollback-console.sql`** (this change directory). It runs S3 → S2 → S1, one
transaction per stage, and uses the original definitions captured before each migration:
- S2: the 5 view bodies rendered by `pg_get_viewdef` under `search_path=''`;
- S1: the original roster body, the secrets column grant and policy, the revocation of the shift column
  grants, the original table-level `arwdDxtm`, and the original ACL order. `service_role` is re-granted
  after `authenticated`, which is cosmetic but makes `relacl` identical;
- S3: `search_path=public`, and the ownership-only legs policy.

**Verified locally.** The whole file was applied inside one transaction, the same probes were read, and
the transaction ended in ROLLBACK. Results against the pre-change baselines, all SAME:
- `s1` (13 rows);
- view md5 (5);
- view columns (8);
- `s3` (2);
- legs/chat (8);
- parity (8 keys, `relacl` and `attacl` included).

The catalog md5 before and after the verification was equal, so nothing was committed.

To use it in production, put the SQL in a **new** migration (`supabase migration new
revert_console_hardening`), review it, and push. Do not use `migration repair` and do not edit the
applied files. The history must stay truthful.

What each stage's rollback re-opens is listed at the top of `rollback-console.sql`.

## 9. Possible effects on shared systems, deferred

- **Android app (out of scope, OQ2):**
  - The contract (`docs/agent-console-api-contract.md`, `docs/voice-agent/app-integration-reference.md`)
    reads `console_event_guests`, `console_rsvp_results` and `human_agent_call_legs`. S2 removes only the
    rows of out-of-scope events, which is 0 rows of console work in production. Columns are unchanged.
  - The app writes `device_id`/`vox_sdk_call_id` on its own leg (§7). That keeps working for an active
    agent and stops for an inactive one.
  - The contract does not read `console_agent_secrets` or the roster.
  - The app's own DTO handling was not verified.
- **CASL / UI:** the softphone shows consult, conference and AI-handoff controls on feature flags alone,
  while the routes require `manage_voice` (`call-bar.tsx:339`, `softphone-panel.tsx:1042`,
  `consult/route.ts:71`). This is unchanged by this change and is a UI/server mismatch. It goes to the
  separate CASL change.
- **Helper RPC exposure:** to clear the Advisors WARN, move `console_agent_provisioned`,
  `console_event_in_scope` and possibly `is_console_agent` to a schema not exposed by the Data API. This
  affects every policy and view that calls them, so it is a separate change.
- **Platform roles:** production's `support_agent` role is not in the local seed (parity
  `role_permissions`). That belongs to `staff-tables-permission-rls`.
- **Service-role paths** (worker, provisioning, `console-sdk-auth`) bypass RLS and are unaffected. This
  is by design: RLS/GRANT bind clients only.
- **Manual dial scope:** `(eventId, contactId)` from the client is checked only for existence. A server
  authorization follow-up (task 1.1 note) is not part of this change.
