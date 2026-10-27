# Design

## Context

Motivation: proposal.md, Why. Requirements: specs/organization-authorization.

Each fact is marked as one of two kinds:
- **MEASURED**: read in the code at the cited line, or from a live SELECT on 2026-10-26 (migrations 392/392 in sync).
- **INFERRED**: everything else; the text says so.

### The organization axis today (all MEASURED)

| Layer | What decides |
|---|---|
| Catalogue | `permission_definitions`: 24 `resource.action` keys, of which `campaigns.create` and `campaigns.manage` are `system_protected`. Template `role_permissions`: 71 rows (owner 24, admin 23, member 16, viewer 8). Per-org `organization_role_permissions`: 67 rows per org (24/20/15/8), 268 in 4 orgs. |
| Resolver | `has_org_permission` reads only `organization_role_permissions` for the caller's membership. A `system_protected` key is admitted only for the owner role. There is no owner shortcut, so the owner too needs a row. |
| Event gate | `can_access_event` = the event's `owner_id` is the caller, OR `has_org_permission(<the event's org_id>, …)`. `requireEventAccess` calls it with the event id (`events.ts:79`). |
| Code gates | String pairs: `requireEventAccess` (44 sites in 20 files), `canAccessEvent` (7 sites in 4 files, `events.ts:654`), `can` / `requirePermission` (9 sites in 3 files, `permissions.ts:23,44`), one direct RPC (`campaigns.ts:355`). Owner checks: `requireOrgOwner` / `isOrgOwner` (`dal.ts:286,303`), 7 calls in 4 files. One admin entry reaches an org gate: `/admin/cancellations/[id]` → `campaignPaymentsView` → `canAccessEvent` on its non-staff branch (`campaign-payments-view.ts:34`). |
| RLS | `can_access_event`: 27 policies. `has_org_permission`: 6. `is_org_member`: 4. `is_org_owner`: 2 (`organization_role_permissions_owner_select`, `organization_role_audit_log_owner_select`). `owns_event`: 1 (`event_questions.eq_owner_delete`). |
| Invariant | Triggers on `organization_role_permissions`: `protect_system` (BEFORE INSERT; a `system_protected` key only for the owner role), `protect_owner` (BEFORE DELETE of an owner-role row), `no_update`, and `audit` (AFTER INSERT/DELETE; actor `auth.uid()`; `actor_id` is nullable). `role_permissions` has no trigger. The FK from `organization_role_permissions` to `permission_definitions` has no cascade. |
| SECDEF on `search_path=public` | 12 org functions: `accept_invitation`, `can_access_event`, `create_organization`, `has_org_permission`, `is_org_member`, `is_org_owner`, `owns_event`, `org_role_permissions_{audit,no_update,protect_owner,protect_system}` and `org_role_rank`. Every body is schema-qualified (`pg_get_functiondef`). |
| Analyzer | `scripts/permission-matrix` knows no org gate (`analyze.mjs:41-51`) and scans only `src/app/(admin)/` and `src/app/api/admin/` (`analyze.mjs:77`). |

People: 4 organizations, each with exactly 1 owner; 1 further member; no admin and no viewer. No user is in more than 1
organization: of 7 users, 5 are in one and 2 in none, because the first event creates the org (`events.ts:205-207`).
There is 1 invitation (0 pending). The 10 events each belong to their owner's organization.

The default-grant rule is copied in 3 places:
- the one-time backfill, `20260713203826:75-83`;
- `create_organization`;
- the reset, `orgs.ts:404-410`.

Each skips `system_protected` keys and `guests.delete` for non-owner roles. Two consequences:
- **3 rows can never take effect.** The template still grants admin `campaigns.create`, admin `campaigns.manage` and
  member `campaigns.create`. The trigger refuses to copy them and the read-time guard ignores them; they are in 0 of
  4 orgs.
- **`guests.delete` is opt-in, not forbidden.** "An owner may grant it back via UI" (`20260713203826:73-74`), and
  `setOrgRolePermission` blocks only `system_protected` keys (`orgs.ts:340`).

Multi-org:
- `accept_invitation` inserts one membership per (org, user);
- `setActiveOrgAction` checks the requested org against the memberships before it writes the cookie
  (`team/actions.ts:40-54`);
- `getOrgContext` falls back to the first row of its memberships query, which has no ORDER BY (`dal.ts:253-256`,
  `:270`).

`docs/project/02-auth-and-authorization.md` §7.4 is stale: it still shows `has_org_permission` reading
`role_permissions`, the body before 2026-07-13.

### Constraints
- A migration push to main deploys it.
- Three teams plan and build the sibling changes in parallel (D0).
- Today's two refusal shapes differ:
  - `requireOrgOwner` redirects a non-owner to `/app/team` (`dal.ts:303-309`);
  - `requirePermission` throws a user-facing error (`permissions.ts:49-51`).

## Goals / Non-Goals

**Goals:**
- Every organization decision goes through `ORG_ACTIONS`. No gate takes a string pair.
- Role management moves onto a key that only the owner role can hold, with no window in which an owner loses it.
- Each decision is made in the right organization: the given (active) one for org-scoped gates, the event's own for
  event-scoped gates.
- Org database hygiene changes no access, and pgTAP proves it.

**Non-Goals:**
- Changing which org role holds which key. Default grants stay as they are; the only access change is B-O18.
- `requireOwnedEvent` (owner-only paths) and the `owner_id` shortcut inside `can_access_event`. Both stay as they are,
  outside the action map.
- A client-side org ability. UI flags stay booleans computed on the server.
- Event creation: `canCreateEvent`, the one-event rule, and its staff exemption (owned by the core change).
  `events.create` stays enforced by the RLS policy `events_owner_insert`.
- The `guests.rsvp_token` grant and every session → credential arc (`harden-public-access-surface`).
- A CI change. The core change owns it (D6).

## Decisions

### D0. Relation to the sibling changes, and the team boundary

**`permissions-macro-to-micro` (the core).** It owns:
- platform staff, the console and event RSVP run state;
- `docs/project/02a-permissions-map.md` and its generator, `scripts/permission-matrix` (its tasks 1.3 and 1.5; umbrella 1.2 and 1.5);
- the CI change (review S10);
- the platform pgTAP, and the platform half of the `search_path` set. Two more platform functions were found here
  and are reported to it: `platform_rbac_audit` and `platform_role_permissions_protect_owner`.

This change supplies two things to the core's map:
- **The organization section of 02a.** It links to this change until task 3.4 renders it.
- **The supersede note on §7 of `docs/project/02-auth-and-authorization.md`.** §7 is the organization axis, so the
  core does not touch it.

The core removes the three organization requirements from `authorization-model`. They live in
`organization-authorization` here. These parts of the umbrella move here:
- tasks 9.1–9.6 and 5.4;
- the org halves of 5.2 and 1.3;
- B's part of 1.5 and of 12.2.

tasks.md maps each one. Umbrella D13 and the org part of D14 become D1–D3 here, and D11's org part becomes D4.

**`harden-public-access-surface`.** It owns:
- the `guests.rsvp_token` grant;
- the `guest_totals` rewrite;
- the session → credential arcs that start in this axis: the RSVP link `getRsvpLinkInfo` shows to `Guest.edit`
  holders (`rsvp-links.ts:28-45`), the workflow that submits an RSVP, and the invitation token behind
  `/join/[token]`.

This change touches none of those credentials.

**Team boundary.**
- **B owns these files:**
  - `src/lib/org-actions.ts` and `src/lib/auth/org-permission-keys.generated.ts`;
  - `scripts/gen-org-permission-keys.mjs`;
  - `supabase/tests/database/org_*_test.sql`;
  - `src/lib/org-actions-static.test.ts` and `src/lib/org-authorization.local-it.test.ts`.
- **B edits in files the core owns,** only after the core's tasks 1.3 and 1.5 are committed:
  - `scripts/permission-matrix/{analyze,db,report}.mjs` and `analyze.test.mjs`: the org gate recognizers and 02a's
    organization section, nothing else;
  - `docs/project/02a-permissions-map.md`, only by regenerating it.
- **B does not edit:** `src/lib/casl.ts`, `.github/workflows/ci.yml`, `s6_helpers_test.sql`, or any platform
  function.
- **Shared files, textual overlap only.** No key changes in any of them:
  - `campaigns.ts` and `event-stats.ts` are in the core change's uncommitted run-state diff (core task 1.1). B's
    event-gate move starts after that commit.
  - `src/app/(customer)/app/events/[id]/campaign/[campaignId]/page.tsx`: the core's campaign-page task edits it too.
  - `events.ts` and `dal.ts`: the core changes `canCreateEvent` (C-O16), `isStaff` and the platform owner checks there.
  - `guests.ts` is A's `guest_totals` caller (`:727-729`), and `rsvp-links.ts` is A's credential arc.

  In the code files, B changes only a gate call's arguments, or deletes the org owner checks.
- **`package.json`** gets the two org-key scripts of task 1.3. The file holds uncommitted changes of its own, which get
  their own grouped commit first (project rule).
- **Contract with the core.** `ORG_ACTIONS` stays a plain `as const` literal, so the analyzer reads it from source.

### D1. `ORG_ACTIONS`, the organization action map (umbrella D13, D14 org part)
It lives in its own isomorphic module, `src/lib/org-actions.ts`, shaped like `PLATFORM_ACTIONS`: subject → action →
key. Its values `satisfies` a generated `OrgPermissionKey` union, and `buildOrgAbility(held)` uses
`createMongoAbility`.

It is not in `src/lib/casl.ts`, because the core change edits that file. Keeping the two in separate files lets the
teams work without conflicts. It is still a CASL map, so the owner's rule "every permission a change touches is
defined in CASL" holds.

| Subject | Action → key |
|---|---|
| `Event` | `view`, `create`, `edit`, `delete` → `events.*`; `view_rsvp`, `create_rsvp`, `edit_rsvp`, `delete_rsvp` → `campaigns.{view,create,edit,delete}`; `administer_rsvp` → `campaigns.manage` |
| `Guest` | `view`, `create`, `edit`, `delete` → `guests.*` |
| `Contact` | `view`, `create`, `edit`, `delete` → `contacts.*` |
| `Report`, `Billing` | `view` → `reports.view`, `billing.view` |
| `Member` | `view` → `members.view`; `administer` → `members.manage` |
| `Organization` | `view` → `organization.view`; `edit` → `organization.edit`; `administer` → `organization.manage`; `administer_roles` → the B-O21 key (D3) |

- **Action names.** `manage` is CASL's wildcard, so the `*.manage` keys get `administer` / `administer_rsvp` (umbrella
  O22, a decision taken). `administer_roles` follows the same rule, and keeps its name whatever key B-O21 names.
- **Two `Event` subjects cannot be confused.** The org `Event` actions are disjoint from the platform `Event` actions
  the core change plans (umbrella D14: `read`, `mark_test`, `purge_test`, `pause_rsvp`, `revive_rsvp`, `close_rsvp`,
  `cancel_rsvp`). `casl.ts` still has `Campaign.runstate` today (MEASURED). A pair from one map therefore does not
  type-check against the other's gates, and a test pins the disjointness against whatever `PLATFORM_ACTIONS` holds.
- **The key union is generated.** `scripts/gen-org-permission-keys.mjs` reads `permission_definitions` on the local
  stack and has a `--check` mode, like `gen-platform-permission-keys.mjs`. Every catalogue key is bound exactly once.

*Rejected alternatives:*
- String pairs checked against the catalogue at run time (`permissions.ts:16-18` today): a typo there is a silent
  deny.
- One map shared with the platform keys: there are two catalogues, two resolvers, and an `Event` subject in each.

### D2. Where each decision is made (review S14)

**Org-scoped gates** are `can` and `requirePermission`: the team, members, roles and organization settings.
- They decide in the organization they are passed. That is always the server-verified id from `requireActiveOrg()`,
  never a value from the browser.
- `getOrgAbility(orgId)` builds the ability from `current_org_permission_keys(orgId)`, memoized per (render, orgId).
  Because it is keyed by the argument, not by the cookie, `requirePermission(orgId, …)` can never use another org's
  keys.

**`current_org_permission_keys(_org_id)`** returns `text[]`.
- It uses the same predicate as `has_org_permission`: the membership join plus the read-time `system_protected`
  guard, aggregated over the catalogue.
- It is SECURITY DEFINER, `search_path=''` and STABLE, with EXECUTE for `authenticated` and `service_role` only.
- It mirrors `current_platform_permission_keys` (casl-console-ability-foundation D1). Parity with
  `has_org_permission` is tested per role, not assumed.

**Event-scoped gates** are `requireEventAccess` and `canAccessEvent`.
- They take `(eventId, action, subject)`, split the bound key into `(resource, action)`, and keep calling
  `can_access_event`. That function decides in the event's own organization, and the active organization is never
  consulted.
- `requireEventAccess` loses its default arguments, so a missing pair is a type error.
- The direct RPC in `getCampaignStageForEvent` (`campaigns.ts:355`) moves onto `canAccessEvent`.

*Rejected alternative:* the active-org ability for event gates. A user who is an admin in A (active) and a viewer in
B would pass B's event gates with A's keys.

**Static ban** (`org-actions-static.test.ts`):
- no string pair passed to `can`, `requirePermission`, `requireEventAccess` or `canAccessEvent`;
- no `.rpc('has_org_permission' | 'can_access_event')` outside `permissions.ts` and the two `events.ts` gates;
- test files are exempt from every clause, including the owner-check clause that task 4.2 adds, by the same predicate
  as the analyzer's `isTest` (`analyze.mjs:65`, which covers `src/test/`). The parity local-it must call `has_org_permission` directly, as
  `permissions.local-it.test.ts:274` does for the platform gate, and vitest runs `*.local-it.test.ts` files too
  (`vitest.config.mts:63`), so without the exemption the ban would fail on this change's own test (MEASURED).

RLS stays the tenant-isolation layer, unchanged.

### D3. Role management on a system-protected key (umbrella 9.4, review B5, B-O21)

**Migration 1: the key and its backfill.** It inserts three things:
- the key into `permission_definitions`: resource and action from B-O21, a Hebrew label (`label` is NOT NULL),
  `sort_order` 83 (after `organization.manage` at 82), and `system_protected = true`. The flag is what makes the
  trigger, the read-time guard and `setOrgRolePermission` refuse the key for every non-owner role.
- the template row for the owner role;
- the owner role's row in every existing org.

Without the backfill every current owner would lose role management, because `has_org_permission` has no owner
shortcut (review B5). New orgs get the key from the template through `create_organization`.

The audit trigger writes one `permission_granted` row per org with a NULL actor. Those rows are kept as the record of
the change. The live check matches them by the new key's `permission_id`, not by the NULL actor: every role-matrix
edit already records a NULL actor, because `orgs.ts` writes through the service-role client (`orgs.ts:325`, `:388`)
and the trigger records `auth.uid()`. MEASURED: 30 of 164 audit rows, all in one org.

Code ships only after a read-only live check finds 0 orgs whose owner role lacks the key, and 0 non-owner rows.

**App.** These gate on `Organization.administer_roles`:
- the roles page and its actions;
- `getOrgRolePermissionMatrix`, `setOrgRolePermission` and `resetOrgRolePermissionsToDefault`;
- `canManageRoles` on the team page.

A refusal keeps today's shape, a redirect to `/app/team`, and a test pins it. `requireOrgOwner` and `isOrgOwner` are
deleted, with their tests and comments.

**Migration 2: the role-table policies move to the key** (a decision taken, by the core change's S13 precedent).
- `organization_role_permissions_owner_select` and `organization_role_audit_log_owner_select` move from
  `is_org_owner(organization_id)` to the key, through `has_org_permission`.
- No access changes, because only the owner role can hold the key.
- Without this step, "no gate checks is-the-owner" would still be false at the RLS layer.

**Migration 3, after the app no longer calls it:** `drop function is_org_owner`. Nothing else calls it: no function,
view or policy in any other schema, and no file in `src` (MEASURED). `types.generated.ts` still declares it
(`:8613`) until `npm run gen:types` runs after the drop (Migration Plan).

*Rejected alternative:* keep `is_org_owner` as a key-less shortcut. Its gate would stay outside the map.

### D4. Database hygiene with no access change (umbrella D11 org part, 5.2, 5.4)

**`search_path`.** `alter function … set search_path = ''` on the 12 functions. No body is rewritten, because every
body is already schema-qualified. Rollback is the same ALTER back to `public`.

**One seeding rule.** `org_role_permissions_defaults()` returns the default (role, permission) rows: the template;
for non-owner roles, minus `system_protected` keys and `guests.delete`. The owner role keeps every template row, which
today is every catalogue key (MEASURED: 24 of 24). It is SECURITY INVOKER, `search_path=''` and STABLE, with EXECUTE
for `service_role` only.
- `create_organization` seeds through it. Its redefinition repeats `set search_path = ''`, because
  `create or replace` without the clause would silently undo the hardening.
- The reset reads it through the service-role client instead of its own filter (`orgs.ts:398-419`).
- The backfill in `20260713203826` already ran; it is history and stays.
- The rule keeps the `system_protected` exclusion even after the cleanup below. Without it, one such template row
  would make the trigger raise inside `create_organization` and block every new org.
- **Proof that `create_organization` reads it.** Its body today holds the same inline filter (MEASURED: live
  `pg_get_functiondef`), so a bypass seeds the same rows, and a check that a new org's rows equal the function's rows
  cannot fail. The pgTAP case is structural instead: inside the rolled-back transaction it replaces the function with
  a copy that omits one seeded pair, and the new org must lack exactly that row. A second case pins the rule's
  content: a new org's owner role holds every catalogue key, and no non-owner role holds a `system_protected` key or
  `guests.delete`.

**The 3 inert template rows are deleted** (umbrella O14, a decision taken). They cannot take effect and are in no
org. From then on the org invariant pin also covers `role_permissions`, so they cannot return.

**`org_role_rank`** has no caller (MEASURED: no function, policy or src file; EXECUTE for `postgres` and
`service_role` only). It is hardened with the rest, and removing it is a follow-up.

### D5. Deleting RSVP questions (owner decision B-O18)
`event_questions` checks SELECT, INSERT and UPDATE through `can_access_event(event_id, 'events', 'view'|'edit')`.
Only DELETE is owner-only, through `owns_event`: `20260705115539:172-194` deliberately kept it so.

Recommendation: `can_access_event(event_id, 'events', 'edit')`, the same check as INSERT and UPDATE. Live effect:
none, because the table has 0 rows and no app code writes it (MEASURED). If B-O18 is accepted, `owns_event` loses
its last caller and the same migration drops it.

### D6. Proof

**pgTAP files owned by B.** The core change extends `s6_helpers_test.sql`; B does not.
- `org_invariants_test.sql` (umbrella 1.3, org half): no organization row grants a `system_protected` key to a
  non-owner role; after D4, no template row either, plus the seeding rule's content and its structural case (D4).
  The mutation check runs inside the rolled-back transaction: disable the trigger, then insert the bad row.
  It also pins every `(resource, action)` literal that a policy passes to `can_access_event` or `has_org_permission`
  to `permission_definitions` (MEASURED: 41 pairs in 33 policies, none missing; no function or view passes one). The
  core's key-literal pin covers the platform helpers only, so this is the org half of it.
- `org_policies_test.sql`: the live expressions of the 13 policies (the 12 org-helper policies and
  `eq_owner_delete`). A task that changes one of them updates its pin in the same task.
- `org_helpers_test.sql`: for the 12 functions, SECURITY DEFINER, `search_path=''`, the EXECUTE grants, and
  behaviour under real sessions (the `s6_helpers_test` pattern).

**local-it.** `src/lib/org-authorization.local-it.test.ts` uses real users for each role in each org. It runs through
`scripts/integration/run-local.sh`. The events in the two-org fixture are owned by a third user, so the owner shortcut
in `can_access_event` cannot let a case pass for the wrong reason.

**The map section.** The core's analyzer learns the four org gates: `can`, `requirePermission`,
`requireEventAccess` and `canAccessEvent`.
- It resolves each `ORG_ACTIONS` pair to its org key.
- It keeps org keys in their own namespace, checked against the org catalogue.
- It treats the org gate RPCs (`has_org_permission`, `can_access_event`, `current_org_permission_keys`) as gates,
  not as operations.
- It renders 02a's organization section: org role → key → subject.action → code gates → RLS policies.

The admin findings must not get worse. The one admin entry that reaches an org gate today (Context) is pinned by a
case. 02a's organization section replaces §7 of `docs/project/02-auth-and-authorization.md`, which B marks
superseded.

**CI.** The core change owns `.github/workflows/ci.yml` and adds only `npm run test:permission-matrix`. That step then
also runs B's analyzer cases. vitest already runs B's unit and static tests. pgTAP, local-it and the `--db`
regeneration of 02a stay documented manual gates (review S10). B adds no CI change.

### D7. Decisions

Owner decisions (each gates the tasks it names):

| # | Decision | Recommendation | Live effect | Blocks |
|---|---|---|---|---|
| B-O18 | `event_questions.eq_owner_delete` → `can_access_event`, which widens deletion to org members | yes, with `events.edit`; drop `owns_event` | none: 0 rows, no app path | 5.1 |
| B-O21 | Name of the system-protected org key for role management | `organization.roles` | none: only the owner role holds it, and every current owner is backfilled | 4.1, 4.2, 4.3, 4.4 |

Decisions taken (engineering), each with its reason:

| Choice | Reason |
|---|---|
| Delete the 3 inert template rows (umbrella O14) | they cannot take effect and are in 0 of 4 orgs |
| Name the seeding function `org_role_permissions_defaults()` | 2.3, the regenerated types and the pgTAP case need a fixed name; it joins the `org_role_permissions_*` functions |
| Test files are exempt from the static ban | the parity local-it calls the gate RPCs directly, and vitest runs it (D2) |
| `administer` / `administer_rsvp` / `administer_roles` (umbrella O22) | `manage` is CASL's wildcard |
| `ORG_ACTIONS` in its own module | the core change edits `src/lib/casl.ts` |
| A generator for the org key union, apart from the platform one | a separate catalogue needs its own key type |
| Org keys in their own namespace in the analyzer | org and platform keys share the `resource.action` shape, so mixing them would report every org key as missing from the platform catalogue |
| Event-scoped gates decide in the event's org; the ability serves org-scoped gates only | review S14 |
| The ability is keyed by the `orgId` argument | no gate can read another org's keys |
| Keep the redirect to `/app/team` on refusal | no behaviour change for a refused member |
| The 2 role-table policies move to the key, then `is_org_owner` is dropped | the core's S13 precedent; retire what is superseded |
| `alter function` for `search_path`, over the full set of 12 | no body is rewritten; the 5 trigger and helper functions found by measurement are on the same axis |
| Keep the backfill's audit rows | they are a true record of the key's arrival |

Approved by the owner on 2026-10-26, not asked again:
- ~20:26: every permission a change touches is defined in CASL (here, `ORG_ACTIONS`);
- ~21:23: include the organization axis;
- ~21:30: the event is the subject in both maps;
- ~21:52: split into three changes and apply the review fixes.

Not approved: any migration push, any access change, any commit, B-O18 and B-O21.

## Risks / Trade-offs

- **[Current owners lose role management when the key ships]** → The backfill is in the same migration. Code ships
  only after a live check finds 0 orgs without the owner row (review B5).
- **[A typo or a missing pair becomes a silent deny]** → The key union is generated and checked with `satisfies`.
  Gates have no default arguments, the static ban covers every org gate, and every catalogue key must be bound.
- **[The active org leaks into event decisions]** → Event gates never read the org context. One unit test and two
  local-it cases pin it: admin in the active org, viewer in the event's org → refused; the reverse → allowed.
- **[The two `Event` subjects are confused]** → The action sets are disjoint and the types are separate. A test pins
  it.
- **[A role-table policy narrows]** → Only owners can hold the key. local-it reads the tables as owner and as admin,
  and pgTAP pins the expressions.
- **[Parallel teams edit the same files]** → The D0 boundary. B's event-gate move waits for the core's run-state
  commit (core task 1.1). B's analyzer work waits for the core's tasks 1.3 and 1.5, and adds recognizers and one
  section only.
- **[The org recognizers change the core's admin findings]** → Org keys stay in their own namespace. The verify fails
  if the admin MISMATCH count rises.
- **[`current_org_permission_keys` drifts from `has_org_permission`]** → A parity local-it test per role. It includes
  a key flipped to `system_protected` while a non-owner holds it.
- **[A drop removes a function something still calls]** → Each drop ships after its last caller is gone. Its verify
  SELECTs for remaining references.
- **[Rolling back the key migration]** → `protect_owner` refuses to delete owner-role rows, and the FK has no
  cascade. The rollback in the header therefore disables that trigger around its own delete, inside the migration's
  transaction.
- **Trade-off: round trips.** INFERRED: per render, one RPC per org replaces one RPC per checked (org, key) pair.
  Event gates keep one `can_access_event` call per check.

## Migration Plan

**Order:**
1. the pins and the action map (no database change);
2. `search_path`;
3. the seeding rule, then the reset that reads it;
4. `current_org_permission_keys`, then the org-scoped gates;
5. the event-scoped gates, after the core's run-state commit (core task 1.1);
6. the static ban, the analyzer's org gates and 02a's organization section, after the core's tasks 1.3 and 1.5;
7. [B-O21] the key and its backfill, then the gates, then the policy move, then `drop function is_org_owner`;
8. [B-O18] `event_questions`.

**Each migration:**
- It is its own push, and the owner approves it before the push.
- Its header carries the rollback SQL, which is one of:
  - `alter function` back to `public`;
  - the prior body of `create_organization`;
  - re-inserting the 3 template rows;
  - `drop function` for a new function;
  - a policy's recorded text;
  - deleting the new key's rows, as in Risks.
- A read-only "applied on live" check passes before any app task that depends on it: migration history equal on both
  sides, and the live catalogue equal to the local result for every object the migration touches. Precedent: commits
  cc49ba31 and e1966ba9.
- When it adds or drops a function, `npm run gen:types` runs after that check (MEASURED):
  - Both clients are typed with `Database` (`server.ts:15`, `admin.ts:45`), so an RPC the types lack does not
    compile, and CI runs `tsc --noEmit` (`ci.yml:47`).
  - The script reads the linked project (`package.json:12`), so it can only run after the push.
  - An added function's types land with the app task that first calls it (2.3, 3.2).
  - A dropped function's types land in their own `chore(types)` commit (4.4, 5.1; precedent 01960f9b, 8e74f022).

Each app task can be undone with a git revert, and none needs a data migration.

### Implementation team

The cross-team rules (the worktree base after the core's 1.1–1.2, one migration queue, redefined functions, one local
stack, generated files, checks that bind every team) are in the core's design, Migration Plan, "Implementation team".
This change's one redefinition, `create_organization` in 2.2 (DEFINER today, MEASURED), restates SECURITY DEFINER and
`set search_path = ''` (D4). This change adds:
- **Waits.**
  - 1.3 waits for the core's 1.2, which commits the pending `package.json` change first (D0).
  - 3.3 waits for the core's 1.1.
  - 3.4 waits for the core's 1.3 and 1.5.
- **Shared files** (the boundary of D0). The task that merges second rebases and re-runs both tasks' tests:
  - `dal.ts` and `dal.test.ts`: 4.2 here; the core's 7.3 and 8.5;
  - `events.ts`: 3.3 here; the core's 9.6;
  - `campaigns.ts`, `event-stats.ts` and the campaign page: 3.3 here; the core's 3.2 and 3.5;
  - `guests.ts`: 3.3 here; harden-public-access-surface 3.2;
  - `scripts/permission-matrix/*`: 3.4 here, recognizers and one section only.

**This team.**

| Role | Agent type | Owns |
|---|---|---|
| Org gates engineer | general-purpose | 1.3, 2.3, 3.2–3.5, 4.2 |
| Database engineer | rls-schema-engineer | 1.1, 1.2 and every `Migration:` task (2.1, 2.2, 3.1, 4.1, 4.3, 4.4, 5.1), each with its pgTAP, local-it, applied-on-live check and types; the 6.2 personas |
| Security reviewer | auth-authz-guardian | the adversarial review of every group. Multi-tenancy and org permissions are its domain (its agent file). It is read-only (MEASURED: its tools are Read, Grep, Glob, Bash, WebFetch, WebSearch), so it never implements |

The lead runs 6.1. No design reviewer is assigned: this change moves no live person's access except through B-O18,
which has no live effect (D5).

**Workflow per group.**
1. The implementer works in its own worktree.
2. It runs the focused tests.
3. A fresh auth-authz-guardian reviews adversarially, with the security lens. For a group with a migration, the
   brief adds rls-schema-engineer's SQL checklist: `search_path`, grants, triggers, the rollback header and the
   applied-on-live query.
4. The implementer fixes what the review found.
5. The full gates run: `npm test` (its pretest runs `worker:deps`), `npm run typecheck`, `npm run lint` and
   `npm run build`. pgTAP and the org local-it run when the group touches SQL, and
   `npm run check:org-permissions:generated` and `npm run test:permission-matrix` when it touches the map.
6. STOP. The lead asks the owner before the merge, and separately before each migration push.

**Cost.** One group is one implementer run and one review run, in sequence. Only one window genuinely runs in
parallel, so it is the only place for a workflow. In that window, the event-gate move (3.3) and, once the core's
1.3 and 1.5 land, the static ban and map section (3.4) run beside the database tasks 2.1, 2.2 and 3.1.

**Owner decisions.**
- Before the team starts: none from D7. The team's base needs the owner's approval of the core's commits 1.1 and 1.2.
- Before a later group: B-O21 before group 4, and B-O18 before 5.1. B-O21 only names a key, so it can be asked at the
  start without holding anything back.
