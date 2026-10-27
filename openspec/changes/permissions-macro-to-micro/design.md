# Design

## Context

Motivation: proposal.md, Why. Requirements: specs/authorization-model and specs/event-rsvp-run-state.

All facts are as of 2026-10-26, from the code and the live database (SELECT only; 392 migrations in the repo). Each
fact is tagged:
- **MEASURED**: read in this rewrite, with its file:line or catalogue query;
- **review**: measured by the four planning reviews of the pre-split plan (application, database, run state,
  sessionless). Untagged facts carried over from the pre-split plan are also review facts;
- **INFERRED**: not measured;
- **DOCUMENTED**: stated by a repo document about a system that is not readable here (the Android app), not measured.

### The map today, macro → micro

| Axis | Identity / transport | Roles | Keys | Gates (code) | Gates (DB) |
|---|---|---|---|---|---|
| Sessionless | token, signature, shared secret | — | — | harden-public-access-surface | harden-public-access-surface |
| Customer / org | cookie; active org verified against memberships | 4 org roles | 24 `resource.action` | organization-action-map | organization-action-map |
| Platform staff | cookie; console Bearer (Supabase JWT); MCP OAuth Bearer | 5 roles | 17 keys | literal keys in ~150 files; CASL for 2 keys; `requirePlatformStaff` (7 files, identity floor) | `has_platform_permission` in 37 policies (all initplan-wrapped, MEASURED), 7 functions, 2 views; 1 Realtime channel policy |
| Platform owner | as staff | `is_owner_role` holds all | all | `requirePlatformOwner` (16 files), `isPlatformOwner` (6 files) (MEASURED: grep) | `is_platform_owner` in 13 policies (8 not wrapped) and 2 functions, `ops_job_health` and `ops_db_health` (MEASURED) |
| Console agent | `console_agents` row with `vox_active` | none | none | `requireConsoleAgent` (19 routes, 403 on non-membership) | `is_console_agent` in 18 policies (16 not wrapped), 2 functions and 7 views: the 5 event-scoped work views, `console_campaigns` and the roster (MEASURED) |
| Delegated | owner-agent runner (service role); MCP OAuth Bearer | — | a hard-coded list of 6 keys | `has_platform_permission_for_user` per key | — |
| System | worker, payment proof | — | — | `CampaignActor 'system'` | — |

Transports and gate types (MEASURED):
- The console Bearer path is `requireConsoleAgent` (`src/lib/auth/console-agent.ts:60-76`).
- The MCP path is `requireBearerAuth` (`src/app/api/mcp/route.ts:44`), then `grantedOwnerAgentPermissions` (`:54`,
  `src/lib/owner-agent/mcp/oauth.ts:138-148`). It resolves the 6-key `OWNER_AGENT_PERMISSIONS`
  (`src/lib/owner-agent/tools/shared.ts:17-24`) one key at a time, as the WhatsApp owner agent and the report path
  do. D8 lists every consumer of the list.
- The one Realtime channel policy is "staff read own permission signal" on `realtime.messages`, topic `staff:<uid>`
  (migration `20261022100542_platform_permission_change_signal.sql:104-110`).
- Column grants arrive with harden-public-access-surface's guests change.

People today (MEASURED, live):
- 2 staff members, both active console agents: the owner and a billing clerk.
- The billing clerk holds `manage_billing`, `view_activity_log`, `view_billing`, `view_customer_data` and
  `view_events`, without `manage_voice` or `campaigns.runstate`.
- The ops engineer, auditor and support roles have no member.

### Constraints

- The Android console app is a separate repo. It keeps every status code and body unless the owner decides
  otherwise.
- A push of a migration to main deploys it.
- Six Realtime tables carry console data: `agent_status`, `call_dispatch_status`, `console_call_feed`, `console_calls`,
  `console_chat_messages` and `human_agent_call_legs`. `postgres_changes` delivers to each subscriber exactly what its
  own SELECT returns (`src/lib/realtime/console-channels.ts:9-17`, MEASURED). An RLS change is therefore a delivery
  change.
- `is_console_agent()` is the only enforcement of `vox_active` for SDK sign-in and monitor. `signOneTimeKeyForAgent`
  and `attachableVoxUsername` do not filter by it.
- The web console's own direct reads (MEASURED):
  - it reads the agent's own live call through the browser client, by `agent_id` or `transferred_to_agent_id` only
    (`softphone-panel.tsx:479-484`, `call-bar.tsx:143-148`), and that call's guest from `console_event_guests`
    (`:514-520`). It reads no other work-data view (grep);
  - it loads the colleague directory from `console_agents_roster` (`softphone-panel.tsx:310-316`);
  - it reads non-terminal AI calls from `console_call_feed` (`ai-handoff-section.tsx:110-118`);
  - it claims a takeover with a client UPDATE (`:197-213`).
- The Android app's data layer (DOCUMENTED):
  - it reads the `console_*` views through PostgREST and `console_call_feed` through Realtime with the agent's own
    JWT, and "RLS and `is_console_agent()` are the whole authorization story"
    (`docs/agent-console-api-contract.md:66`);
  - the views are filtered by `is_console_agent()`, so the app does not filter by user
    (`docs/voice-agent/app-integration-reference.md:48-49`), and it reads `console_campaigns` (`:66-77`).

  C-O1 and C-O9a therefore also narrow what the app shows an agent without `manage_voice`.

## Goals / Non-Goals

**Goals:**
- One chain for every staff decision: key → action → gate, the same on every transport.
- Console membership kept only for what a seat at the console needs (D4).
- Event RSVP run state on the target model first, with atomic staff audit, as the template for later domains.
- Tooling that proves the map, so a missing or wrong gate fails a check.
- No access change for a live person unless an owner decision says so, and each such change is in its own task.

**Non-Goals:**
- Changing which role holds which key, beyond the owner decisions in D12.
- The Android app's code. Only its contract, which is kept.
- The sessionless and organization axes, except as rows of the shared map (D0).
- `permittedFieldsOf`, JWT claims, and server decisions through a client-built ability.

## Decisions

### D0. Relation to other changes

**Siblings**, split from this change with the owner's approval (2026-10-26, ~21:52):
- `harden-public-access-surface` (no session) takes the former D10, D9's manifest part, and pre-split tasks 1.4, 2.1,
  2.4 and 11.x.
- `organization-action-map` (customers and organizations) takes:
  - the former D13 and the organization parts of D11 and D14;
  - pre-split tasks 1.3 (the org invariant), 5.2 (the org functions), 5.4 and 9.x.
- **The shared map.** `docs/project/02a-permissions-map.md` and its generator (`scripts/permission-matrix`) belong to
  this change:
  - task 1.5 creates the macro table of every axis, and the staff, owner, console, delegated and MCP sections. It
    marks `02-auth-and-authorization.md` §6A and §6B superseded;
  - harden-public-access-surface supplies the sessionless rows: its manifest, `src/lib/security/public-surface.ts`
    (its task 1.1). This change renders them as the map's sessionless section (task 1.8), which is what that change's
    design D0 and task 1.2 expect;
  - organization-action-map's org-gates task teaches the analyzer the org gates, renders the organization section and
    marks §7 superseded.
- **CI.** This change owns the `.github/workflows/ci.yml` change (task 1.6). The siblings reference it.
- **Pre-split task ids → here.** The ids changed in the rewrite, and the siblings cite this change by its own ids
  (harden-public-access-surface D0 maps its umbrella ids; organization-action-map's tasks name theirs inline):

  | Umbrella | Here | Umbrella | Here |
  |---|---|---|---|
  | 1.1 | 1.1, 1.2 | 5.1 | 7.1 |
  | 1.2 | 1.3 | 5.2 (platform half) | 7.2, 7.3 |
  | 1.3 (platform pins) | 1.4 | 5.3 | 7.4 |
  | 1.5 | 1.5, 1.8 | 6.1 | 4.1, 4.2 |
  | 1.6 | 1.7, 6.5 | 6.2 | 4.3, 4.4 |
  | 2.2 | 2.2 | 6.3 | 4.5 |
  | 2.3 | 2.3 | 7.1 | 8.1, 8.2 |
  | 3.1 | 3.1 | 7.2 | 8.3, 8.4 |
  | 3.2 | 3.2 | 7.3 | 8.1 (the guard), 8.5 |
  | 3.3 | 3.3 | 8.1–8.4 | 9.1–9.4 |
  | 3.4 | 3.5 | 8.5 | 9.5, 9.6 |
  | 3.5 | 3.6 | 8.6 | 9.7 |
  | 3.6 | 3.7 | 10.1, 10.2 | 6.1, 6.2 |
  | 4.1 | 2.1 | 10.3 | 6.3, 6.6 |
  | 4.2 | 5.2 | 12.1 | 10.1 |
  | 4.3 | 5.1 | 12.2 (staff half) | 10.2 |
  | 4.4 | 6.4 | | |

  Tasks the review added, by their ids here: 1.6 (S10), 3.4 (S1), 3.8 (C-O7), 3.9–3.10 (C-O9b), 5.3 and 6.7
  (app-team docs), and 8.6 (S13).

**casl-console-ability-foundation** (0/12 checked; partly implemented on 2026-10-26 and committed by task 1.1). It is
absorbed and does not proceed on its own. Its task ids map here; it has no task 6.2:

| casl | here | casl | here |
|---|---|---|---|
| 1.1 | 4.1 | 4.1 | 2.1 (map part), 6.2 (conditions) |
| 1.2 | 4.2 | 4.2 | 6.2 |
| 2.1–2.2 | 4.3 | 5.1 | superseded by D3; its literal replacement is in 3.6, 5.1 and 5.2 |
| 2.3 | 4.4 | 6.1 | 6.3 |
| 3.1 | 6.1 | 7.1, 7.2 | 6.5, 6.6 |

- Its D5 gate order (`requireConsoleAgent → requireConsoleAction`) is superseded by D3.
- Of its specs, `platform-permission-resolution` is kept whole. In `console-action-authorization`, two parts are
  superseded, and task 1.7 marks both:
  - the requirement "The console API refuses an action without its key, before doing anything" (active agent first),
    by `authorization-model`;
  - its run-state line (`campaigns.runstate` on a campaign), by `event-rsvp-run-state`.
- Its D6 says there is no Realtime on the RBAC tables. That predates migration
  `20261022100542_platform_permission_change_signal`. The migration sends `permissions_changed` on `staff:<uid>` when
  `platform_roles`, `platform_role_permissions`, `platform_staff` or `console_agents` changes (MEASURED: triggers).
  Task 6.3 reuses it.

**harden-console-agent-permissions** (15/15):
- Superseded, subject to C-O1 and C-O9a, and marked by task 6.5:
  - D3 ("console access stays `is_console_agent()`");
  - in its `console-access-control` spec:
    - "Authenticated callers who are not agents see and change nothing", for the three call tables and the
      work-data views: a key holder without a seat reads them;
    - "Active agents see the work data of console-scope events only", whose key becomes C-O9a;
    - "Console workflows keep working", scenarios "Profile, lists and directory" (the lists), "Calls and dispatch" and
      "Realtime": an agent without `manage_voice` keeps only its own call and that call's guest;
    - if C-O24 is yes, "An inactive agent keeps only its own profile", scenario "Other console data": a blocked agent
      that holds the key reads what the key allows.
- Kept: D2 (a phone only for `view_customer_data`), D3a (one scope helper), and "Agent profile and colleague
  directory": `console_me` and `console_agents_roster` stay operational (D4).
- Its suites pin today's reads. Task 6.4 moves each assertion below to its new expectation and states the reason
  (MEASURED; no persona holds `manage_voice` except in console-realtime):
  - `console-findings.local-it.test.ts` (personas at :99, billing clerk and auditor roles):
    - :266-277: the auditor agent reads 0 feed digits and 0 `console_calls` rows, because neither is its own call.
      Its chat read stays 1;
    - :279-285: the billing-clerk agent reads 0 notes and 0 analyses. A `manage_voice` persona reads 1 and 1;
    - :312-329: `dispatch_agentNoVcd` (:316, :324) becomes 0.
  - `console-views.local-it.test.ts` (custom roles holding nothing or only `view_customer_data`, :95-105):
    - :254-259, :261-267 and :290-293: 0 rows, `console_campaigns` included;
    - :269-272: targets become 0. The guest row stays (1, named, phone) through agentVcd's own connected call
      (fixture :163-167, C-O23);
    - :412-433: every list is 0 for both agents, except agentVcd's own call's guest. A `manage_voice` persona gets
      the owner-computed sets;
    - :456-462: dispatch becomes 0, and the own monitor leg stays 1;
    - :483-494: the claim moves to a seated `manage_voice` persona;
    - :496-511: the pinned SELECT quals of `console_calls` and `console_call_feed` become the new expressions.
  - `console-realtime.local-it.test.ts` (ops-engineer personas, which hold `manage_voice`, :55-56): if C-O24 is yes,
    the inactive persona receives the `console_calls` and `console_call_feed` changes through the key, and still no
    chat message, so :145 changes. If C-O24 is no, it stays.
  - `src/lib/supabase/console-view-grants.test.ts` (runs in CI): :167-177 pins `is_console_agent()` in every view
    except `console_me`. The work-data views carry the C-O9a key instead; the roster keeps the seat.
  - Unchanged: `console-rest.local-it.test.ts` (anon and a regular user only). The scope tests console-findings
    :240-247 and console-views :274-288 stay green, and get a `manage_voice` persona so that they still prove the
    scope.

**pilot-casl-package-permissions** (18/21). Kept unchanged. This change builds on its map and static guards.

**staff-tables-permission-rls** (29/30). Its grant-cleanup follow-up absorbs the TRUNCATE note in Risks.

### D1. Identity axes; the owner is a role, not an axis
The owner role already holds every key through `is_owner_role` in `has_platform_permission`. Its gates retire into
keys:
- role management goes to `roles.manage`;
- staff and console-agent enrollment, blocking and removal go to `manage_staff`;
- each owner-only domain gets a new key, granted to no role: owner-agent, relocation, debug, RDP approval, Meta
  connect, number registration, WhatsApp ES, Exchange. These are the domains of the 16 `requirePlatformOwner` files
  (MEASURED: grep).

The database follows (review S13). The 13 policies and 2 functions convert to keys (MEASURED live list), and
`is_platform_owner()` is then dropped:

| Gate today (`is_platform_owner()`) | After task 8.3 |
|---|---|
| `platform_roles_owner_select`, `platform_role_permissions_owner_select`, `platform_permission_definitions_owner_select`, `platform_role_audit_log_owner_select` | `roles.manage` |
| `platform_staff_owner_select`, `support_access_log_owner_select` | `manage_staff` |
| `owner_agent_{allowlist,audit,intake,report_run,report_subscription}_owner_select` | the new owner-agent key |
| `ops_errors_owner_select`; functions `ops_job_health`, `ops_db_health` | the new debug key. `/admin/debug` reads all three (`src/lib/ops/app-health.ts:38-50`, `db-health.ts:42,71`) |
| the ALL policy "Platform owners can manage staff" on `platform_staff` | dropped by task 8.1 |

**Escalation guard (review B4), before any non-owner gate opens.** Three gaps today (MEASURED):
- every role and staff write uses `createAdminClient` (`src/lib/data/admin/platform-roles.ts:145-176`), so a SECDEF
  guard that reads `auth.uid()` sees NULL;
- `StaffMember.assign` would let a `manage_staff` holder assign itself the owner role;
- the TS guard (`:162-166`) covers grants, not role assignment.

The ALL policy is not a write path, which corrects review B4. `authenticated` holds only REFERENCES, SELECT and
TRIGGER on `platform_staff`, and no column write privilege, so a client write fails with 42501 before RLS runs
(MEASURED: grants). The policy repeats `platform_staff_owner_select` for reads, and dropping it is hygiene.

The role audit has three gaps of its own (MEASURED: trigger definitions and the function body):
- `platform_rbac_audit` reads `app.actor_id` only for `platform_role_permissions`. For `platform_staff` it takes
  `auth.uid()`, then `granted_by`, so a revoke names the original granter, not the revoker. Today 5 of the 35
  `platform_role_audit_log` rows name an actor: all 5 staff rows, and none of the 30 grants;
- `platform_staff_audit` fires AFTER INSERT OR DELETE only. `assignStaffRole` changes a role with an upsert on
  `user_id` (`platform-roles.ts:542-543`), which is an UPDATE, so a role change writes no row, an owner's demotion
  included;
- `platform_staff_last_owner` fires BEFORE DELETE only. Only `assignStaffRole`'s TS guard (`:537-539`) stops the last
  owner's demotion by an UPDATE.

The fix is RPCs taking `p_actor`, which every role and staff write goes through:
- they refuse a change to one's own role or to one's own role's grants;
- only an owner-role member may assign the owner role, or a role holding `roles.manage` or `manage_staff`;
- only an owner-role member may change or revoke the role of an owner-role member;
- they set `app.actor_id`. `platform_rbac_audit` reads it before `granted_by` in its `platform_staff` branch, and
  `platform_staff_audit` also fires on UPDATE OF `role_id`, recording the old and the new role;
- `platform_staff_last_owner` also fires on UPDATE OF `role_id`, so the database keeps the guard that the TS code
  holds today.

Rejected alternative: change a role as a DELETE plus an INSERT, which the triggers already audit. The delete cascades
to `console_agents` (`console_agents_staff_fkey` ON DELETE CASCADE, MEASURED) and would un-enrol the agent.

The ALL policy is dropped. A pgTAP test pins three things: the policy is absent, `authenticated` holds no write
privilege on `platform_staff`, and no non-owner role holds `roles.manage` or `manage_staff` (C-O15).

Rejected alternative: keep `requirePlatformOwner` as a key-less shortcut. Its gates would stay outside the map, and a
typo in a key would stay hidden, because the owner passes every check.

### D2. All 17 keys in `PLATFORM_ACTIONS`
The map keeps its shape: subject → action → key (casl D3). No action is named `manage` or `all`, which CASL treats as
wildcards. Moving a literal gate onto an action changes no access by construction: the action is bound to the key the
literal named. A derived table checks this against the scan.

| Key | Subjects and actions |
|---|---|
| campaigns.runstate | Event.{pause_rsvp,revive_rsvp,close_rsvp,cancel_rsvp} (replaces today's `Campaign.runstate`, D14) |
| manage_voice | ConsoleCall.{transfer,consult,conference}, ConsoleDial.dial, AiCall.{monitor,command,end}, EventGuest.start_outreach; VoiceConfig.{read,update}, DncEntry.{read,update}, ConsoleHistory.read |
| manage_billing | Package.* (exists); Offer.*, CouponAssignment.*, Cancellation.{read,settle}, PaymentReview.read, SumitTest.run |
| view_billing | BillingReport.read |
| view_customer_data | Contact.read, Callback.read, SupportCase.read, Analytics.read, SearchConsole.read, WorkflowRun.read, CallLog.read |
| view_events | Event.read |
| events.mark_test / events.purge_test | Event.mark_test / Event.purge_test; Event.mark_test also gates the one-event exemption (C-O16, taken) |
| integrations.manage / integrations.read | Integration.{configure,disconnect}, PaymentTerminal.use_test / Integration.read |
| manage_settings | SystemSetting.{read,update}, Template.*, Channel.*, Faq.*, Agreement.*, CallbackPolicy.*, Fleet.*, Workflow.*, Webhook.replay |
| manage_staff | StaffMember.{read,assign,revoke}, ConsoleAgent.{read,enroll,remove,block}, AccessLog.read |
| roles.manage | PlatformRole.{read,create,grant} |
| rdp.request | RdpAccess.request |
| view_activity_log / view_recordings / view_webhooks | ActivityLog.read / Recording.read / WebhookInbox.read |
| the 8 owner-domain keys (task 8.3) | one subject each, named in task 8.3 |

Several subjects share one key, as `manage_settings` does. A later split (C-O4, `manage_voice`) is then a one-line edit
of the map plus a grant migration.

If C-O5 is no, `Cancellation.settle` enters the map in task 3.5, where the cancellation close first needs it. Task 9.3
moves the rest of the billing domains.

### D3. Bearer gates: identity, action and operational precondition kept apart
`console-agent.ts` gets three gates. Each first validates the JWT with `getUser` and answers 401 'לא מורשה'. Every
other refusal is 403 'אין הרשאה'. These are today's bodies (`console-agent.ts:29-30`, MEASURED).
- `requireConsoleIdentity(request)` checks `is_console_agent()`: staff AND an enrolled agent with `vox_active`. It is
  today's `requireConsoleAgent` check, used only where a live Voximplant identity is needed.
- `requireBearerStaff(request)` checks `is_platform_staff()`.
- `requireBearerAction(ctx, action | action[], subject)` is today's `requireConsoleAction`, renamed. It holds when the
  caller holds the key of the action, or of any of the listed actions.

`requireConsoleAgent` is deleted (task 5.2). All gates run before the body is read, in this order:
- operational routes: identity, then the key if the route has one;
- action routes: staff, then the key.

The order is not visible to a client, because every refusal has the same body. `is_console_agent()` already includes
the staff check. Its live body is `select public.is_staff() and exists (…)` (MEASURED). So an operational route needs
no separate staff call.

The 19 routes fall into two groups:
- **Operational (6):** `agents/{sdk-auth,status,shift,telemetry}`, `console-calls/dial-intent` (`ConsoleDial.dial`)
  and `calls/[id]/monitor` (`AiCall.monitor`). Telemetry and dial-intent are INFERRED operational: the scenario script
  was not read.
- **Action (13):**
  - `console-calls/[id]/*` (6 routes): `ConsoleCall.*`;
  - `calls/[id]/{end,agent-command}`: `AiCall.*`;
  - `events/[eventId]/outreach-call`: `EventGuest.start_outreach`;
  - `campaigns/[id]/status`: any of `Event.pause_rsvp` and `Event.revive_rsvp` before the body. The RPC re-checks
    the requested one (D5);
  - `agents/{call-history,callbacks}`: `CallLog.read` (C-O2, taken);
  - `agents/transfer-targets`: any `ConsoleCall` action (C-O3, taken).

All 13 action routes read and write through `createAdminClient`, so dropping membership causes no silent RLS refusal
inside a route. A static classification test lists every Bearer route and its group. A route missing from the list
fails the test.

**Order of work (review B3):**
- task 2.1 adds the gates and changes no route;
- 2.2 adds `CallLog.read` and keeps `requireConsoleAgent` until 5.2;
- the run-state route moves in 3.6, `transfer-targets` in 5.1, and the rest in 5.2.

**Round trips** (MEASURED from the code). Today an operational route makes 2 auth calls: `getUser` and
`is_console_agent` (`console-agent.ts:67,72`). It makes 1 more key RPC when it has a key (`:87`). An action route
makes 3. This order keeps every count.

**Blocking an agent (C-O24).** `blockConsoleAgent` sets `vox_active` false (`platform-roles.ts:451-467`). Today that
cuts all 19 routes and every console read except `console_me`. Under this design a blocked agent:
- loses the 6 operational routes, the agents' shared console (D4) and the own-call branch of D4;
- keeps what its keys allow: the action routes and D4's key branches. A `manage_voice` holder keeps transfer, end,
  agent-command and conference, and the call data. `transfer/route.ts:40-44` documents that the key, not the agent,
  is the call-floor authority.

If C-O24 is no, the action routes (in `requireBearerStaff`) and D4's key branches also refuse a blocked seat: a caller
whose `console_agents` row has `vox_active` false. Staff who are not enrolled stay allowed by their key, because membership is not a permission
(approved direction). `requireConsoleIdentity` cannot serve here, because it would refuse every key holder who is not
enrolled.

### D4. Console data in the database
Of the 18 `is_console_agent` policies, 14 are operational and stay as they are (MEASURED). They cover the agents'
shared console: own status and shift, the colleagues' status, presence and directory, the queues, the agents' chat,
and own call legs. The other 4 change (columns MEASURED):
- `console_calls_select`: the key, or the seat AND one's own call:
  `(select public.has_platform_permission('manage_voice')) or ((select public.is_console_agent()) and (agent_id = (select auth.uid()) or transferred_to_agent_id = (select auth.uid())))`;
- `console_call_feed_select`: the key, or the seat AND `agent_id = (select auth.uid())`. The feed has no
  `transferred_to_agent_id`;
- `call_dispatch_status_select`: the key only. The table has no agent column;
- `console_call_feed_update_agent` (the takeover claim): the key AND the seat, because it writes
  `agent_id = auth.uid()` and needs a Voximplant identity.

The own-call branch (C-O23) keeps the softphone's own call card and its Realtime refresh for an agent without the key.
The web client reads its own call only by those two columns (Context).

**The console views** (MEASURED: view definitions). Seven of the eight call `is_console_agent()`:
- the 5 event-scoped work views: `console_events`, `console_event_guests`, `console_campaign_targets`,
  `console_rsvp_results` and `console_call_analysis`. They carry guest names, RSVPs, notes and call analysis across
  customers. Each has its own `is_console_agent()` conjunct and calls `console_event_in_scope`, which checks
  `is_console_agent()` again (harden D3a's one helper);
- `console_campaigns`, filtered only by `is_console_agent()`. It lists every customer's campaigns, and Android reads
  it (Constraints);
- `console_agents_roster` (`security_invoker`), the colleague directory. It stays operational, as does `console_me`,
  which filters by `user_id = auth.uid()` and does not call `is_console_agent()`.

The key of the work-data views (the five and `console_campaigns`) is C-O9a. Changing the helper alone does not move
them. Each view's own conjunct must change with it, and `console_call_analysis` admits its rows with no `event_id` by
that conjunct alone. So the helper's check and every conjunct become the key. Phones stay behind
`view_customer_data`, and `console_call_pii` is closed to every client.

The own-call branch reaches one view only: `console_event_guests`, for the guest of one's own ringing or connected
call. The softphone builds the call card's guest from it (`softphone-panel.tsx:514-520`). Without the branch, C-O9a
would take the guest off the agent's own call card.

**Android, the gate of task 6.4.** The Android repo is not readable here, and its documents say that the views alone
decide what it shows (Constraints). Before 6.4, the app team answers in writing two questions:
- which console objects the app reads;
- by which columns it finds its own call (for example `consult_agent_id`, `conference_agent_ids` or `peer_agent_id`).

The answer is recorded here. The own-call branch then covers every column it names.

`is_console_agent()` itself is kept: it is the only `vox_active` check. Task 7.2 changes its body from `is_staff` to
`is_platform_staff`.

**Effect on live people (C-O1, C-O9a).**
- The owner is not affected.
- The billing clerk keeps its own live call and that call's guest (C-O23), and the agents' shared console. It loses:
  - other agents' calls, the AI call feed (it took over none and cannot claim one), dispatch status, and their
    Realtime delivery;
  - the work-data views, `console_campaigns` included, which the Android app reads. The web console reads only its
    own call's guest from them, which it keeps.

**Ordering.** The policies ship after the routes move (5.2), and the console UI (6.1–6.3) deploys just before them in
the same window. An agent without the key therefore never sees controls whose lists go empty.

### D5. Event RSVP run state: one staff actor, one atomic RPC
**Actor.** It is `{ kind: 'staff', staffUserId, via: 'web' | 'bearer' | 'cancellation_request' }` or
`{ kind: 'system', paymentOperationId }`. The `admin` and `console` kinds are removed. A staff actor is built only by
these gate functions:
- `runstateActorFromSession(action)`: `requirePlatformAction`, then `user.id`;
- `runstateActorFromBearer(ctx)`: after `requireBearerAction`;
- `runstateActorFromCancellation(requestId)`: after the gate that C-O5 picks, `Event.close_rsvp` if yes or
  `Cancellation.settle` if no (added to the map by task 3.5). It carries `via = 'cancellation_request'` and the request
  id, so the RPC checks that the request is pending and belongs to the event whatever C-O5 decides.

`reviveCampaign` replaces today's console-only `activateCampaign`.

**RPC** (final; agreed by the database and run-state reviews):
`public.campaign_runstate(p_campaign uuid, p_action text, p_actor uuid, p_via text, p_cancellation_request uuid default null, p_reason text default null) returns text`.
It is SECURITY INVOKER with `search_path = ''`, and EXECUTE is granted to `service_role` only. `p_via` has no
default. The RPC validates `p_action` and `p_via` itself; no enum type or CHECK constraint holds them. The steps run
in this order:
1. Check the key of (`p_action`, `p_via`) for `p_actor` with `has_platform_permission_for_user`, before any state is
   read. If it fails, answer `forbidden`.
2. `select … from campaigns … for update`. If there is no row, answer `no_campaign`.
3. If the campaign is already in the target state, answer `already_<state>` and write no audit row. This covers a
   retry after a close succeeded and the resolve that followed it failed.
4. For `via = 'cancellation_request'`:
   - only close is allowed, and `p_cancellation_request` is required;
   - `select … from event_cancellation_requests where id = … for share`;
   - the status must be `pending`, else `request_not_pending`;
   - the request must belong to the campaign's event, else `request_mismatch`.

   The lock order campaign → request is the same as cancel's and the ledger trigger's.
5. The guarded UPDATE, with from and to fixed in SQL:
   - pause: active → paused;
   - revive: paused → active;
   - close: active, paused, approved or scheduled → closed.

   If no row matches, answer `not_allowed_from_<status>`.
6. Write the audit rows in the same transaction, and answer `done`.

**Key per action:**
- pause, revive, close and cancel: `campaigns.runstate` on every channel (`Event.*_rsvp`);
- close through `cancellation_request`: `campaigns.runstate` if C-O5 is yes, or `manage_billing` (`Cancellation.settle`)
  if no;
- C-O9b moves pause onto its own key, on every channel.

Task 3.3's matrix pins the SQL keys to the map: a holder of the mapped key must pass.

**Answers, per caller:**

| RPC result | Console route (3.6) | Web actions | `resolveCancellationRequest` |
|---|---|---|---|
| `done` | 200 `{ ok: true, status }` | success | continues |
| `forbidden` | 403 'אין הרשאה' | refusal | refused; the request stays pending |
| `no_campaign` | 404 'הקמפיין לא נמצא' | `notFound()` | error; nothing written |
| `already_<state>` | 409 'לא ניתן לשנות את מצב הקמפיין במצבו הנוכחי' (route.ts:59,106) | today's message (`campaign-transition.ts:183`) | `already_closed`: continues (the retry path) |
| `not_allowed_from_<status>` | 409, same body | today's message | error; nothing written |
| `request_not_pending`, `request_mismatch` | — | — | error; nothing written |

The request body enum stays `'activate' | 'pause'` (route.ts:48, MEASURED), although the domain function is
`reviveCampaign`.

**Audit.** `support_access_log` is the evidence: one row per success. It gets three new nullable columns: `via` and
`action` (text, with no CHECK constraint or enum, because the RPC validates the values) and `details` (jsonb).
`campaign_runstate` writes `{statusBefore}` into `details`. `reason` is not used for this, because it is the
break-glass justification (`access-log.ts:13-17`). Why this table:
- authenticated holds only SELECT on it, so clients cannot insert;
- only the owner role reads it (`support_access_log_owner_select`), and after task 8.3 holders of `manage_staff`
  (MEASURED);
- `activity_log` is not evidence. `al_owner_insert` lets any signed-in user insert any action under their own id,
  and its rows cascade with the event (MEASURED).

Its event FK has no ON DELETE action, so a row blocks deleting its event (MEASURED). The test purge nulls the column
(`20260929001415_test_event_purge.sql:210`). The other event-deletion paths are not checked; task 3.3's migration
header lists them.

An `activity_log` row that the event's readers can fetch through the Data API (no screen shows it) is C-O10. If it is written, revival is `campaign.revived`, because first-start
repair keys on `campaign.activated` (`activate-paid-package.ts:90-99`). Both rows are written in the RPC's
transaction.

**`cancel_campaign` gets the same contract (review S1, C-O26).**

Live state (MEASURED: function definition):
- it is INVOKER, with `search_path=''`, and EXECUTE is granted to `service_role` only;
- it takes `p_actor uuid default null`;
- it re-checks no key and records no channel;
- it writes its row into `activity_log`.

It is amended, not folded into `campaign_runstate`. Its cancellable predicate (no billed result, no payment
activity) and the payment evidence in its row are its own, and they are tested. The two functions share the actor,
the key re-check and the audit contract.

The payment evidence stays in the staff row whatever C-O10 decides. Today's `activity_log` row records
`hadSucceededPayment` and `testMoneyOnly`, the payment facts that the cancel waves through (MEASURED: function body).
`support_access_log` has no column for them (MEASURED: columns). So they go into `details`, with `statusBefore`. If
C-O10 is yes, the customer row keeps today's meta, adds `via`, and has `user_id` NULL.

The new `p_via` parameter makes a new function identity, because argument types identify a Postgres function
(INFERRED from the CREATE FUNCTION reference). The migration therefore drops and recreates the function in one
transaction:
- `p_via text default 'web'`, so the deployed call `{p_campaign, p_actor}` (campaigns.ts:764-767) still resolves;
- a NULL or keyless actor makes it **raise** (errcode 42501), not answer `forbidden`. The deployed caller throws only
  on an error, `no_campaign` or `not_cancellable`. It treats any other answer as success and then releases the
  campaign's benefit (campaigns.ts:768-776, MEASURED). A new answer would therefore release a benefit in the window
  between the migration and task 3.5;
- EXECUTE goes to `service_role` only;
- a pgTAP test pins that exactly one `cancel_campaign` exists.

**What stays in TS:**
- The revival guards (past event, active event, package funding) run before the call. The RPC guards against the
  race, and `campaigns_require_active_event` re-checks the move to active (MEASURED trigger).
- Whether the request was declined is written only after the close: the close is at :696 and the resolve at
  :706-721. So it stays checked in TS (`event-cancellation.ts:690-696`). A database condition on it would break the
  legitimate flow.

**Retired:**
- `TransitionSession.requireStaff`;
- the route's post-transition `recordStaffAccess` and its swallow (route.ts:111-127);
- the revival `logActivity` block (campaigns.ts:540-559), which is broken on Bearer;
- `approveCampaign`, which has no non-test caller (`agreements.test.ts:6` mocks it);
- the `admin` and `console` kinds;
- the stale comments at `campaign-transition.ts:27-31` (`requireConsoleAgent`) and `:104-107` (pause on a non-active
  event; see C-O17 in D12).

Rejected alternative: keep the transition in TS and write the audit after it. Two writes are not atomic, which is
exactly today's defect.

### D6. Cancellation request
`resolveCancellationRequest` checks the close authority before any refund or email, but only when the resolve will
close the RSVP service. That is exactly the condition at `event-cancellation.ts:690-697`: a package campaign in a
closeable status, and a resolution other than declined. A decline, or a resolve that closes nothing, needs only
`manage_billing`, as today.

The refund (:640) and the customer email (:600-655) both come before the close (:696) (MEASURED).

The close always goes through `campaign_runstate` with `via = 'cancellation_request'` and the request id, using D5's
third actor builder, so the request checks hold either way. C-O5 picks only the gate and the key:
- yes: the resolver also holds `Event.close_rsvp` (`campaigns.runstate`). Task 2.3 adds the pre-check early, with
  today's `Campaign.runstate`, which task 3.1 renames. It runs once the resolution is final, because a resumed refund
  rewrites it (:542-556), and before the first refund or email. It mirrors :690-697 on that final resolution;
- no: `manage_billing` (`Cancellation.settle`) is enough. Every resolver already holds it (:472), so no pre-check
  exists to add. The defect is fixed in task 3.5, when the close runs through `campaign_runstate` under that key.
  An interim close path in TS would be a second close path without atomic audit, which 3.5 would then retire.

### D7. UI matches the server
Today the campaign page's staff branch is chosen by `hasPlatformPermission('manage_billing')`. The ability replaces
it:
- `can('pause_rsvp'|'close_rsvp'|'cancel_rsvp', 'Event')` shows each control. `revive_rsvp` is shown too if C-O7 is
  yes;
- the read gate admits a holder of an Event run-state action (C-O6). The staff branch reads through four readers, and
  each requires `manage_billing` and audits under it (MEASURED: page.tsx:59-70, `admin/campaigns.ts:45-46,93-96`):
  `getEventForAdminView`, `getCampaignForAdminView`, `getCampaignDeliveryForAdminView` and
  `getThankyouScheduleForAdminView`. Opening the branch alone would get a run-state holder redirected by the readers,
  and a mocked page test would not show it. So the four admit `manage_billing` or any Event run-state action, and
  their `recordStaffAccess` row names the key that admitted the caller;
- the branch's other controls keep their own key, `manage_billing`: reschedule (`manage-client.tsx:982`,
  `rescheduleEventForAdmin`) and the thank-you schedule (page.tsx:109, `updateThankyouSchedule`). Today they ride on
  `viewerIsAdmin`.

The billing summary panel (`getCampaignBillingSummary`, page.tsx:82) returns only `reached_count` (MEASURED: the
result type of `campaign_billing_summary`). A run-state holder therefore sees no money on the page.

Admin nav entries declare `{action, subject}`. Each of the 4 analyzer mismatches is fixed in its domain's task:
- the CardCom entry checks `integrations.manage` but reads with `integrations.read` (9.4);
- the Meta WhatsApp page, under `manage_settings`, reaches `manage_voice` (9.6);
- console history, under `manage_voice`, reaches `view_recordings` on some paths (9.2);
- the dashboard menu entry is shown to all staff, but the page needs `view_activity_log` (9.6).

The 7 `requirePlatformStaff` sites are identity floors followed by soft key checks (MEASURED):
`analytics.ts:26-28,32-35`, `search-console.ts:157-158`, `dashboard.ts:53-62`, `nav-counts.ts:85-100`,
`nav-visibility.ts:73`, `integrations/index.ts:186-211` and `admin/layout.tsx:46`. A staff member without the key
sees a no-permission state, not a redirect. Hard gates there would narrow access (C-O25).

### D8. One key source
casl D1 and D2 are kept: `current_platform_permission_keys()`, and a resolver independent of the auth source. A third
source, `delegated(userId)`, replaces the hard-coded `OWNER_AGENT_PERMISSIONS` with subject.action declarations, so
`view_billing` gets its home (`BillingReport.read`). Every consumer of the list moves (MEASURED: grep):
- three places resolve it one key at a time: the WhatsApp owner agent (`consumer/reply.ts:412-416`), the report path
  (`reports/report.ts:445-449`) and the MCP route (`mcp/oauth.ts:138-148`, called at `api/mcp/route.ts:54`);
- the runner validates it (`runner.ts:362`) and hands it to its MCP child (`:508`), which parses it (`mcp/main.ts:36`,
  `mcp/permissions.ts:1-4`);
- `scripts/owner-agent-smoke.ts:29,49` validates its command-line keys against it.

**Placement.** Group 4 runs after the run state and before the console groups, for two reasons:
- casl 1.1's widened tuple and `canOn` are prerequisites of casl 4.1's conditions and casl 6.1's controls;
- casl 7.1's RPC count is meaningful only after casl 2.3.

Bearer round trips do not decide the placement; D3 keeps them.

### D9. The map is generated and checked
**What the analyzer learns.** `scripts/permission-matrix` learns:
- the CASL gates: `requirePlatformAction`, `requireAnyPlatformAction`, `getPlatformAbility` / `ability.can`;
- the Bearer gates: `requireBearerAction`, `requireBearerStaff`, `requireConsoleIdentity`;
- the MCP gate: `requireBearerAuth`, then the delegated source;
- the SQL helpers `is_platform_staff`, `is_console_agent` and `has_platform_permission_for_user`.

**What it misses today** (MEASURED):
- its entry scope is `src/app/(admin)/` and `src/app/api/admin/` (analyze.mjs:77), so it scans none of the 19 Bearer
  routes and not `api/mcp`;
- its gate table (analyze.mjs:41-51) has no CASL gate;
- its SQL recognizer (db.mjs:40-44) knows only `has_platform_permission`, `is_platform_owner` and `is_staff`;
- it reports the CASL-gated package screens as 6 false M1s and as U5s (review).

**What it emits.** The macro → micro table per axis, and each entry point's transport and gates. Gate types include
column grants (`information_schema.column_privileges`) and Realtime channel policies on `realtime.messages`.

**pgTAP pins:**
- every key literal passed to `has_platform_permission` or `has_platform_permission_for_user` in policies, functions
  and views exists in `platform_permission_definitions`. The owner shortcut in `has_platform_permission` hides typos,
  which is why this pin is needed. Org pairs share the `resource.action` shape but not the catalogue, so
  organization-action-map's task 1.1 pins them;
- the 18 `is_console_agent` and 13 `is_platform_owner` policy expressions, so every planned rewrite updates them on
  purpose.

**The document.** `docs/project/02a-permissions-map.md` is generated from the tool's output, with no timestamp in the
generated body. Regenerating therefore shows a diff only when the map changed. Its owner and its sibling sections are
set out in D0.

**CI (review S10).** `.github/workflows/ci.yml` runs lint, tsc and vitest only, and has no database secrets (its
header, MEASURED). It gains `npm run test:permission-matrix` (package.json:64). pgTAP, local-it and the `--db`
regeneration stay documented manual gates in task 10.1.

### D11. Database hygiene, platform part (no access change)
- **initplan.** `alter policy` wraps 12 `is_console_agent` calls and the 8 unwrapped `is_platform_owner` calls. There
  are 16 unwrapped `is_console_agent` calls today; task 6.4 rewrites 4 of them in wrapped form. All 37
  `has_platform_permission` policy calls are already wrapped (MEASURED). A new pgTAP pins the wrapped form. None
  exists today: `supabase/tests/database` has no initplan test (MEASURED).
- **search_path.** `search_path=''` is set on `is_platform_owner` and `integrations_configured_flags` (both today
  `public`), and on `admin_reschedule_event` (today `public, pg_temp`) (MEASURED). Each body is first checked to be
  fully qualified. `is_staff` is left out, because it is dropped two tasks later.
- **The three platform trigger functions** are SECURITY DEFINER on `search_path=public` too: `platform_rbac_audit`,
  `platform_role_permissions_protect_owner` and `platform_staff_prevent_last_owner` (MEASURED: live `pg_proc`; their
  bodies name only schema-qualified relations). organization-action-map's D0 reported the first two; the third was
  found in this check. Task 7.2 hardens them with the rest. Task 8.1 redefines two of them, so each redefinition
  repeats `set search_path = ''`: `create or replace` assigns every property it does not restate (PG17 CREATE FUNCTION
  reference).
- **Retire `is_staff`.** Its callers are `is_console_agent` (DB), `dal.ts:177` and the analyzer (analyze.mjs:63,
  db.mjs:43) (MEASURED). They move to `is_platform_staff`, and the function is dropped after the app is deployed.
- The org functions, the org seeding rule and the template rows belong to organization-action-map (D0).

### D14. The event is the subject (platform map)
An event has at most one non-cancelled campaign. `createCampaign` creates or continues it, and
`campaigns_event_noncancelled_uidx` is unique on `event_id` where `status <> 'cancelled'` (MEASURED). The campaign is
therefore the event's RSVP service.

The platform map uses `Event.{read, mark_test, purge_test, pause_rsvp, revive_rsvp, close_rsvp, cancel_rsvp}`. The
organization map's `Event` actions are organization-action-map's. They are separate maps with separate types and
resolvers, so the two cannot be confused at the type level.
- The four run-state actions share `campaigns.runstate`. Splitting the pause out (C-O9b) is a map edit, a grant and
  the RPC's key check (D5).
- What does not change: the DB keys, and the storage and code names (the `campaigns` table, `campaign_runstate`,
  `campaigns.ts`).

### D15. The baseline commits (review B6)
Task 1.1 commits the run-state cleanup of 2026-10-26. It is not "no access change": it removes the customer start
path, which the owner approved (2026-10-26, ~20:21). The first start is the server's, after the recorded payment.

The commit holds exactly these 26 files (MEASURED: `git status`, 2026-10-26):
- 20 modified source files:
  - `src/app/(customer)/app/events/[id]/campaign/[campaignId]/manage-client.tsx`
  - `src/app/(customer)/app/events/[id]/campaign/campaign-actions.test.ts`
  - `src/app/api/campaigns/[id]/status/route.ts`
  - `src/app/api/campaigns/[id]/status/route.test.ts`
  - `src/lib/auth/{console-agent,platform-ability,staff-table-permissions}.ts`
  - `src/lib/auth/platform-ability.test.ts`
  - `src/lib/casl.ts`, `src/lib/casl.test.ts`
  - `src/lib/data/{campaigns,event-labels,event-stats,setup-steps}.ts`
  - `src/lib/data/campaigns.test.ts`, `src/lib/data/campaign-lifecycle-parity.test.ts`
  - `src/lib/payments/{activate-paid-package,package-purchase}.ts`
  - `src/lib/payments/cardcom-webhook-activation.local-it.test.ts`
  - `src/lib/validation/agent-console.ts`
- 3 new source files: `src/lib/data/campaign-transition.ts`, `src/lib/auth/console-agent.test.ts` and
  `src/lib/casl-campaign-runstate-static.test.ts`.
- 3 docs: `docs/voice-agent/app-integration-reference.md`, `docs/voice-agent/app-repo-handoff-2026-07-21.md` and
  `openspec/changes/casl-console-ability-foundation/tasks.md`.

Task 1.2 commits every other pending change in its own group, because the project rule is to commit all changes,
whoever made them. Each file is read first. A secret, generated output or debug material is listed to the owner
instead of being committed (CLAUDE.md, Git). The groups:
- **knip adoption:** `package.json`, `package-lock.json`, `knip.json`, `skills-lock.json`, `.agents/skills/knip/`,
  `.claude/skills/knip/`, and the 4 `.claude/fleet/settings/tier*.settings.json` (each adds `Skill(knip)`; MEASURED
  diff);
- **the three OpenSpec planning changes:** `openspec/changes/{permissions-macro-to-micro,harden-public-access-surface,organization-action-map}/`;
- **the root working files:**
  - images: `IMG_9511.jpg`, `IMG_9514.PNG`, `IMG_9515.PNG`, `IMG_9542.PNG`, `IMG_9543.PNG`;
  - notes: `console-access-map.md`, `diff.md`, `maps.md`, `elevenlabs-cli-full-reference-20261016-014339.md`,
    `elevenlabs-cli-full-reference-20261016-021921.md`, `elevenlabs-git-review-20261016-022543.md`;
  - other: `supabase-security-advisors.json`, `skills/`, `.vscode/`.

### D12. Owner decisions
Each decision is one yes/no on the recommended mechanism, and it gates the tasks named. The specs state the
recommended answers; a different answer changes the scenario named in the decision's row.

| # | Decision | Recommendation | Live effect | Blocks |
|---|---|---|---|---|
| C-O1 | Console call data comes from `manage_voice`, not membership (supersedes harden D3)? | yes | the billing clerk keeps its own call (C-O23). It loses other agents' calls, the AI call feed, dispatch status and their Realtime delivery. In practice the billing clerk has made 0 console calls (MEASURED 2026-10-27) | 6.4, 6.5, 6.7 |
| C-O5 | Must a cancellation resolve that closes the RSVP service also hold `Event.close_rsvp`? If no, `manage_billing` is enough for that close, still through `via='cancellation_request'` (spec scenario "Billing staff without close authority" flips) | yes: closing is a run-state action, and money moves only after every authority is checked | the billing clerk is refused, before money moves, on a resolve that would close a running RSVP service; declines are unaffected | 2.3, 3.3, 3.5 |
| C-O6 | Does a holder of a run-state action without billing reach the campaign page's staff branch, its four staff readers included (D7)? | yes: the page must offer what the server allows | none live (the ops-engineer role has no member) | 3.2 |
| C-O7 | May web staff revive from the campaign page? | yes: a web pause has no web undo today, and revive uses the same key and RPC | holders of `revive_rsvp` gain a web revive. Today only the owner role holds `campaigns.runstate` (1 person, MEASURED 2026-10-27) | 3.8 |
| C-O9a | Is `manage_voice` the key of the console work-data views: the 5 event-scoped views (`console_events`, `console_event_guests`, `console_campaign_targets`, `console_rsvp_results`, `console_call_analysis`) and `console_campaigns`, which lists every customer's campaigns? If no, the owner names the key. `console_agents_roster` and `console_me` stay operational either way (D4) | yes: the views serve live call handling; phones stay behind `view_customer_data` | the billing clerk loses the six views, in Android too, except its own live call's guest in `console_event_guests` (C-O23); it keeps the roster | 6.4, 6.5, 6.7 |
| C-O9b | Does the safety pause get its own key, so that a role can stop sends without closing or reviving? | yes: pausing is the safety stop that whoever takes the customer's call must reach (campaigns.ts:580-585) | none live (the support role has no member) | 3.9, 3.10 |
| C-O10 | Is an `activity_log` row written for each staff run-state action, including cancel, with `user_id` NULL and `meta.via`? No screen shows these rows to the customer. The event's owner, and org members whose role holds `events.view`, can read them only through the Data API (RLS `al_org_read`) | yes: the cancel row that a customer can already read through the API stops naming the staff member | No screen changes: the customer UI reads `activity_log` only for the event's ended/cancelled label (`events/[id]/page.tsx:135`, `events/page.tsx:55`). Through the Data API, the event's readers no longer see the staff id on a cancel (today `cancel_campaign` writes `user_id = p_actor`, MEASURED), and they can read pause, revive and close rows. Staff with `view_activity_log` see these rows in `/admin/activity`. Today every staff-written cancel or close row is on the acting staff member's own event (0 of 3, MEASURED 2026-10-27) | 3.3, 3.4 |
| C-O15 | Do `roles.manage` and `manage_staff` stay owner-only, with console-agent enrollment under `manage_staff`? | yes: each lets its holder grant further keys | none | 8.1–8.6 |
| C-O23 | Does an enrolled agent always see its own ringing or connected call, and that call's guest, without the console data keys? | yes | the billing clerk keeps its own call card (the call and its guest) and its Realtime refresh | 6.4 |
| C-O24 | Does blocking an agent remove only its live Voximplant identity, so that a blocked agent keeps the action routes and the console data its keys allow, and authority is removed by revoking its role? If no, the action routes and D4's key branches also refuse a blocked seat, while staff who are not enrolled stay allowed by key (D3; spec scenario "Blocking removes the identity, not the keys" flips) | yes: membership is an operational attribute (the owner's direction, 2026-10-26) | none live (both agents are active, MEASURED) | 3.6, 5.1, 5.2, 6.4 |
| C-O25 | Do the 7 staff-floor sites keep the floor with a soft key check (a no-permission state), instead of refusing the page? | yes: the floor is the identity check, and the data is already gated by key (analytics.ts:26-28) | none | 9.4 |
| C-O26 | Does cancel's evidence, its payment facts included, move to `support_access_log`, written in `cancel_campaign`'s transaction, with the actor required and its key re-checked? | yes | Only the owner role can read the staff row: `support_access_log_owner_select = is_platform_owner()`, and the `/admin/access-log` page requires `manage_staff`. So the billing clerk (`view_activity_log`, 1 person) no longer sees in `/admin/activity` which staff member cancelled. If C-O10 is no, the clerk also loses the cancel row and its payment facts there. MEASURED 2026-10-27; 1 cancel row live | 3.4 |

**Decisions taken** (engineering, with the reason):
- **C-O2.** `CallLog.read` is bound to `view_customer_data`. harden D2 already decided that a phone is shown only to
  its holders.
- **C-O3.** `agents/transfer-targets` takes any `ConsoleCall` action (`manage_voice`), because the list serves only the
  transfer actions. The review reclassified it, and the owner approved the review fixes (~21:52). Live effect: the
  billing clerk loses a list it cannot use.
- **C-O16.** `events.mark_test` (`Event.mark_test`) exempts its holders from the one-event rule, in `canCreateEvent` and
  in `events_before_insert` (the same review reclassification). This changes no live access (MEASURED), which
  corrects this plan's earlier claim that the billing clerk would lose a second event:
  - `events_before_insert` is SECURITY INVOKER and reads `platform_staff` under the inserting user's RLS, whose only
    SELECT policies are owner-only. The database therefore exempts only an owner-role member's own account today, and
    it would refuse the billing clerk's second event (the clerk owns 0);
  - only the owner role holds `events.mark_test`;
  - `canCreateEvent` returns true for any staff member (`events.ts:175-177`, through SECDEF `is_staff`), so it offers
    a second event that the database refuses. The key aligns the two.

  Mechanism (task 9.5): the trigger function becomes SECURITY DEFINER, keeps `search_path = ''`, and checks
  `has_platform_permission_for_user(new.owner_id, 'events.mark_test')`. It must not stay INVOKER and call that
  helper: only `postgres` and `service_role` may execute it (MEASURED), and `createEvent` inserts through the cookie
  client (`events.ts:208-218`), so every customer insert would fail with 42501. The function's owner, `postgres`, may
  execute it. As definer, the events lookup runs without RLS, with the same result, because `events_owner_insert`
  pins `owner_id = auth.uid()` for client inserts. Rejected alternative: a SECDEF helper that takes a user id and that
  `authenticated` may execute. Any signed-in user could then probe another user's keys, whereas a trigger function
  cannot be called through the API.
- **C-O17.** The trigger stays and the comment is fixed. An operational campaign on a non-active event is unreachable
  (MEASURED):
  - `campaigns_require_active_event` refuses pending_approval, approved, scheduled, active and paused unless the event
    is active;
  - `events_guard_update` allows only draft → active or closed, and active → closed;
  - it refuses to close an event that has an operational campaign.
- **`cancel_campaign`** is amended, not folded into `campaign_runstate` (D5).
- **One key source before the console groups** (D8).
- **The console UI** deploys just before the console policies, in one window (D4).
- **Task 7.1 also wraps the owner policies,** although 8.3 rewrites them. Each migration stays correct on its own, and
  the initplan pgTAP stays green between them.
- **`is_staff`** is left out of the `search_path` set (D11).
- **`support_access_log.via` and `.action`** are free text, validated by the RPC. **`.details`** (jsonb) carries
  `statusBefore`, and cancel's payment facts (D5).
- **The own-call branch reaches `console_event_guests` only** (D4). The softphone's call card is the only own-call
  read of a work-data view, and the Android reads are settled by the gate of task 6.4.
- **A role change stays an UPDATE.** The audit and last-owner triggers learn UPDATE OF `role_id`, because a DELETE
  plus an INSERT would cascade to `console_agents` (D1).
- **If C-O5 is no, task 2.3 adds no interim close path** (D6). The defect is fixed in 3.5, so no second close path
  without atomic audit is built and then retired.

**Approved by the owner (2026-10-26):**
- delete the old customer activation path and its cleanups (~20:21): task 1.1;
- console membership is not a permission (~20:44): D3. The route moves (3.6, 5.1, 5.2) change no live person's access
  beyond C-O3;
- every permission a change touches is defined in CASL (~20:26): D2;
- the event is the subject in both maps (~21:30): D14;
- split into three changes and apply the review fixes (~21:52): D0 and the reclassifications above.

Not approved: any migration push, any access change, any commit, and every decision in the table.

**Outside this change** (Workflow follow-up):
- C-O4, splitting `manage_voice`: decided after the map exists, in its own change.
- C-O8, keeping 403 for operational refusals (recommended): a 409 would be its own change, with an Android release.

## Risks / Trade-offs

- **[A policy key that differs from the caller's key returns 0 rows, not an error]** →
  `staff-table-sql-consistency` covers every new subject, and the persona local-it tests check rows and Realtime
  delivery.
- **[Realtime on 3 console tables narrows to key holders and to one's own call]** → Persona tests subscribe and
  assert delivery, including the own call.
- **[The Android app reads console data by a column the own-call branch does not cover]** → Task 6.4 is gated on
  the app team's written answer (D4), and the own-call branch covers every column it names.
- **[The Android app's lists go empty for an agent without `manage_voice`]** → This is C-O1 and C-O9a's live effect. Task
  6.7 updates the app-team documents, which today say that membership decides what the app shows.
- **[A SECURITY INVOKER trigger that calls `has_platform_permission_for_user` fails every customer event insert with
  42501]** → Task 9.5 makes the trigger SECURITY DEFINER. Its verify inserts through the authenticated role, as
  `createEvent` does, so the INVOKER form fails the customer's first event.
- **[Android contract]** → D3 and D5 keep every code and body, and route tests pin them.
- **[Escalation keys]** → The keys stay owner-only (C-O15). The `p_actor` guard ships before any non-owner gate opens
  (8.1 before 8.2), and a pgTAP test pins the invariant.
- **[Ordering]** → Every migration ships before the app that depends on it, behind an applied-on-live check. Drops ship
  after the app.
- **[TOCTOU on revival]** → Funding is append-only, the trigger re-checks, and the RPC locks the row.
- **[A `support_access_log` row blocks deleting its event (NO ACTION FK)]** → The test purge nulls it. Task 3.3's
  header lists the other event-deletion paths and how each treats the rows.
- **[Recreating `cancel_campaign` leaves two overloads or loses its grant]** → The drop and the create run in one
  migration. A pgTAP test checks exactly one function, and local-it checks the deployed call shape and the 42501 for
  anon and authenticated.
- **[The 1.4 pins fail on every planned rewrite]** → This is intended. Tasks 6.4, 7.1, 8.1 and 8.3 update them on
  purpose.
- **[The scan is textual, and misses keys passed through variables]** → D9's type-checked analyzer; the owner-agent
  list moves in D8.
- **[`authenticated` holds TRUNCATE on `campaigns`, which RLS does not cover (MEASURED grant)]** → There is no
  PostgREST path (INFERRED). Handed to staff-tables-permission-rls grant cleanup.

## Migration Plan

- **Phase order:**
  1. tooling and baseline (1.1 is the owner-approved removal of the customer start path);
  2. the Bearer gate primitives and the urgent defects;
  3. the run state: UI, RPC, cancel, wiring, route;
  4. one key source;
  5. the Bearer routes;
  6. the console UI, then the console policies;
  7. database hygiene;
  8. the owner axis;
  9. literal keys → CASL, domain by domain;
  10. integration.
- **Each migration:**
  - it is its own task and its own push, and a push to main deploys it;
  - it is additive or reversible, with rollback SQL in its header (`drop function`, `alter policy` back to the
    recorded text, re-grant);
  - it needs owner approval before the push;
  - a function it redefines restates its SECURITY clause and its `SET search_path`, because `create or replace`
    assigns every property it does not restate (PG17 CREATE FUNCTION reference). Here that covers `is_console_agent`
    (7.2), `console_event_in_scope` (6.4), `ops_job_health` and `ops_db_health` (8.3), all DEFINER on
    `search_path=""` today, and `platform_rbac_audit` and `platform_staff_prevent_last_owner` (8.1) (MEASURED:
    live `pg_proc`). A dropped and recreated function, such as `cancel_campaign` (3.4), states both as well;
  - then comes the **applied-on-live check**, read-only, before any app task that depends on it. The live catalogue
    (function bodies, security and `proconfig`, policy text, grants, columns) must equal the local result, and the
    migration-history counts must match. It is recorded as in commits cc49ba31 and e1966ba9;
  - when it adds or drops a function or a column, `npm run gen:types` runs after that check. Both clients are typed
    with `Database` (`server.ts:15`, `admin.ts:45`, MEASURED), so an RPC the types lack does not compile, and CI runs
    `tsc`. An added function's types land with the app task that first calls it (3.5, 4.4, 8.2). A dropped
    function's types land in their own `chore(types)` commit (7.4, 8.6; precedent 01960f9b).
- **Each app stage** is a git revert. None needs a data migration.
- **Verification per stage:**
  - focused tests, then `npm test` (with `worker:deps`), typecheck, lint and build;
  - a stage that changes access also runs the local-it personas.

### Implementation team

**Cross-team rules.** They bind all three changes; the two siblings point here.
- **Base.** Every implementer works in its own git worktree, branched from main after tasks 1.1 and 1.2 are
  committed. Until then the run-state cleanup and the three planning directories exist only in the main working tree
  (MEASURED: `git status` at HEAD 79069ca4). A worktree runs its own `npm ci` and links `.env.local` and
  `.env.test.local` from the main checkout, never copying or committing them.
- **One migration queue.** A merge to main deploys its migrations. The lead (the main session) keeps one queue for the
  three changes and merges a branch that holds a migration only with the owner's approval of that push. The file is
  created by `npx supabase migration new` when it is next in the queue, after a rebase on main; an earlier draft is
  re-created with a fresh timestamp. `db push` has an `--include-all` flag that will "Include all migrations not
  found on remote history table" (MEASURED: CLI 2.122.0 help). INFERRED from that text: a default push does not
  apply a file older than the newest remote migration, and the GitHub integration behaves the same. The flag is
  never used.
- **Redefined functions.** Every migration in the three changes that redefines a function restates its SECURITY
  clause and `SET search_path`, and its applied-on-live check compares `prosecdef` and `proconfig` (Each migration,
  above). The siblings' cases: harden-public-access-surface 3.1 (`guest_effective_attending`, `guest_totals`, both
  INVOKER on `search_path=public`; `owner_agent_rsvp_people_totals`, INVOKER on `search_path=""`) and 8.3
  (`submit_rsvp`, DEFINER on `search_path=public`); organization-action-map 2.2 (`create_organization`, which it
  already handles) (MEASURED: live `pg_proc`).
- **One local stack.** pgTAP and local-it share the stack on 127.0.0.1:54322: `run-local.sh` accepts no other target
  (`:23`) and neither resets nor migrates it (MEASURED). A group that runs SQL gates holds the stack alone, across the
  three teams, and first brings it to its own branch's migrations. A local reset needs the owner's approval
  (CLAUDE.md). App-only work runs in parallel freely.
- **Generated files.** `types.generated.ts` is never merged by hand: after a rebase, `npm run gen:types` regenerates it
  from the live project, which holds every team's applied migrations. `02a-permissions-map.md` changes only through
  this change's generator.
- **Shared files.** The overlap is textual. The task that merges second rebases and re-runs both tasks' tests:
  - `src/lib/auth/dal.ts` and its test: 7.3 and 8.5 here; organization-action-map 4.2;
  - `src/lib/data/events.ts`: 9.6 here; organization-action-map 3.3;
  - `campaigns.ts`, `event-stats.ts` and the campaign page: 3.2 and 3.5 here; organization-action-map 3.3;
  - the `console-findings`, `console-views` and `console-realtime` local-it suites: 6.4 here; harden-public-access-surface 7.4;
  - `package.json`: organization-action-map 1.3, after 1.2 here commits its pending change;
  - `src/lib/data/guests.ts`: harden-public-access-surface 3.2; organization-action-map 3.3;
  - `scripts/permission-matrix/*`: owned here; organization-action-map 3.4 adds its recognizers and one section, after
    1.3 and 1.5 here;
  - `src/lib/casl.ts` belongs to this change alone. Inside this team, one lane edits it at a time, in the lead's
    merge order.
- **Checks that bind every team once merged:**
  - the manifest test (harden-public-access-surface 1.1): a new route, `'use server'` module or edge function adds
    its row in the same task;
  - the org string-pair ban (organization-action-map 3.4);
  - the key-literal ban (9.7 here).

  Task 1.6 adds the analyzer cases to CI.
- **Order between the changes.**
  1. 1.1–1.2 first: every worktree branches from them.
  2. Then harden-public-access-surface groups 1–2. Forged `X-Forwarded-For` values defeat the SMS-code and
     widget-call limits for any anonymous client today (its Context). This change's urgent defects (2.2, 2.3) need
     one of the 2 live staff sessions (Context).
  3. Then the three teams run in parallel. The waits:
     - harden-public-access-surface 2.1 and organization-action-map 3.3 wait for 1.1;
     - organization-action-map 3.4 waits for 1.3 and 1.5;
     - 1.8 here waits for harden-public-access-surface 1.1.
  4. The siblings archive when done. This change archives after casl-console-ability-foundation and
     harden-console-agent-permissions (Workflow follow-up).

**This team.**

| Role | Agent type | Owns |
|---|---|---|
| Tooling engineer | general-purpose | 1.1–1.2 (it prepares the commits; the lead commits after the owner approves), 1.3, 1.5–1.8, 7.3, 9.7 |
| Database engineer | rls-schema-engineer | 1.4 and every `Migration:` task (3.3, 3.4, 3.9, 4.3, 6.4, 7.1, 7.2, 7.4, 8.1, 8.3, 8.6, 9.5), each with its pgTAP, local-it, applied-on-live check and types; the 10.2 personas |
| Run-state engineer | campaign-outreach-engineer | 2.3, 3.1, 3.2, 3.5–3.8, 3.10. Campaign status transitions are its domain (its agent file) |
| Console engineer | voximplant-engineer | 2.1, 2.2, 5.1–5.3, 6.1–6.3, 6.5, 6.7: the console Bearer routes, the softphone and the app-team docs |
| CASL engineer | general-purpose | 4.1, 4.2, 4.4, 4.5, 8.2, 8.4, 8.5, 9.1–9.4, 9.6 |
| Security reviewer | auth-authz-guardian | the adversarial review of every group. It is read-only (MEASURED: its tools are Read, Grep, Glob, Bash, WebFetch, WebSearch), so it never implements |
| Design reviewer | eng-manager-review | the run-state RPC before 3.3's push (state machine, lock order, error paths), and the integrated diff and test matrix before 10.2 |

6.6 is the owner's own browser check, and 10.1 is the lead's.

**Workflow per group.** 1.1 and 1.2 run in the main checkout, because they create the base; every other task follows
these steps.
1. The implementer works in its own worktree.
2. It runs the focused tests.
3. A fresh auth-authz-guardian reviews adversarially. Authorization is the domain of every group here, and the brief
   adds the implementer type's checklist. For a group with a migration, the brief also adds rls-schema-engineer's SQL
   checklist: locks, grants, `search_path`, the rollback header and the applied-on-live query.
4. The implementer fixes what the review found.
5. The full gates run: `npm test` (its pretest runs `worker:deps`), `npm run typecheck`, `npm run lint` and
   `npm run build`. pgTAP and local-it run when the group touches SQL, and `npm run test:permission-matrix` when it
   touches the analyzer.
6. STOP. The lead asks the owner before the merge, and separately before each migration push or access change in it.

**Cost.** One group is one implementer run and one review run. A workflow serves only lanes that genuinely run in
parallel. After group 1 there are three:
- run state: 2.3, then group 3;
- console: 2.1–2.2, group 5, then group 6 once group 4 is merged (D8) and 5.2 is deployed;
- CASL: group 4, then group 8's app tasks, then group 9, in tasks.md's order. The owner-only admin links hang off
  `isPlatformOwner`, not a key (`nav-visibility.ts:47-48`, MEASURED), so 9.6 can declare their subjects only after
  8.4.

The lanes wait for each other at three points:
- 3.6 starts after 2.1 is merged, because it uses `requireBearerStaff` and `requireBearerAction` (review B3);
- 8.1 is pushed after 7.2, because its verify relies on 7.2's `s6_helpers_test` cases;
- group 6 waits for group 4, as above.

The database engineer serves all three lanes through the one queue, and runs the rest of group 7 when it is
otherwise idle. Group 10 is the lead's and runs sequentially.

**Owner decisions.**
- Before the team starts: none from D12. Group 1 needs only the owner's approval of commits 1.1 and 1.2, which are
  also every team's base.
- Each later decision blocks only the tasks named:
  - C-O5 before 2.3;
  - C-O5, C-O6, C-O10 and C-O26 before group 3;
  - C-O24 before 3.6, 5.1 and 5.2;
  - C-O7 before 3.8, and C-O9b before 3.9 and 3.10;
  - C-O1, C-O9a, C-O23 and C-O24 before 6.4, 6.5 and 6.7;
  - C-O15 before group 8, and C-O25 before 9.4.
- The app team's written answer of D4 also gates 6.4. It is not an owner decision.

## Open Questions

- Does the Android app treat a 403 from an operational route differently from one from an action route? This is
  answered by reading its repo if C-O8 is ever revisited; until then the contract is unchanged.
