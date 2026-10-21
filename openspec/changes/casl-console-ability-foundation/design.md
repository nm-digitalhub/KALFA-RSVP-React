# Design

## Context

See proposal.md, Why. The research behind this design is in
`$TMPDIR/casl-explore/EXPLORE-2.md` (read-only exploration, 21.10.2026). It includes a runtime probe on
`@casl/ability` 7.0.2 and `tsc` checks of the type changes.

The current state:

**The map and the ability.**
- `PLATFORM_ACTIONS` (`src/lib/casl.ts:12-19`) is `{ Package: { read, create, update, delete →
  'manage_billing' } }`, typed by the generated catalogue (`platform-permission-keys.generated.ts`).
- `buildPlatformAbility(held)` (`casl.ts:66-76`) emits claim rules only.
- The tuple is `[action, subjectName]` (`casl.ts:25`).

**Key resolution.** `getPlatformAbility` is `cache()`d per render and calls `hasPlatformPermission(key)`
once per distinct key (`platform-ability.ts:21-40`). Each call is one `has_platform_permission` RPC
(`dal.ts:178-189`). The admin layout adds `is_platform_staff`, `is_platform_owner` and 9 nav keys: 11
permission RPCs per render (counted from code, not measured).

**Two definitions of "my keys" already exist:**
- `has_platform_permission(_key)`: owner role short-circuits to true for any `_key`, even one outside
  the catalogue (read from `pg_proc`);
- `console_me.permissions`: owner role gets the whole catalogue, others get their role's keys (read
  from `pg_get_viewdef`). The Android app hides controls from it (`app-integration-reference.md:35,54,58`).

**The console's gates:**
- eligibility: `requireConsoleAgent`, i.e. Bearer → `getUser` → `rpc('is_console_agent')`
  (`console-agent.ts:59-75`);
- key: 12 routes call `callerHasPlatformPermission(ctx.supabase, '<literal>')`. 10 use `manage_voice`
  under `console-calls/*`, `calls/*` and `dial-intent`, plus `events/[eventId]/outreach-call:65`; one
  uses `campaigns.runstate` at `campaigns/[id]/status:70`;
- operational checks: in the routes;
- data: RLS, GRANT and the console views (harden D2–D5, deployed).

**Library facts (7.0.2, probe and changelog):**
- conditions, `cannot(...).because()`, `subject()` (since 4.0.0), `permittedFieldsOf`, `rulesToAST`
  (since 5.1.0) and `rulesToCondition(rules, convert, {and, or, empty})` all work. `rulesToCondition`
  is new in 7.0.0 and replaces `rulesToQuery`;
- a type-only `can(a, S)` returns true if any rule for `(a, S)` exists, even a conditional one that
  every real row fails;
- `subject(type, obj)` tags the object in place and throws when re-tagging or on a frozen object;
- `manage` and `all` are wildcards.

## Goals / Non-Goals

**Goals:**
- One key resolution per request, pinned by parity to both existing definitions.
- One ability builder for cookie and Bearer callers. The server keeps deciding from fresh state.
- Conditions for display only, built from constants that the server imports too.
- The Package pilot's map entries, gates and tests unchanged, except one test that encodes the old
  RPC-per-key behaviour.

**Non-Goals (design level):**
- Field-level rules: the only field rule, the phone mask, stays in the view SQL (harden D2).
- Translating rules to data-layer filters: RLS already bounds every console list.
- Pushing permission changes to clients in real time.

## Decisions

### D0. Relation to the pilot

This change starts after `pilot-casl-package-permissions` closes (its tasks 6.1 and 6.2). It keeps
every requirement of the pilot's `platform-action-authorization`. It supersedes pilot D2 ("no new
database code") only, by adding the key-resolution function. Pilot D3 (the server gate delegates to the
DAL check) stays: `requirePlatformAction` still ends in a database answer.

*Alternative:* fold this into the pilot. Rejected: the pilot is under evaluation, and its report says it
does not approve a wider migration (`evaluation.md:206`).

### D1. `current_platform_permission_keys()`: one call, catalogue-bounded

```sql
create function public.current_platform_permission_keys()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(d.key order by d.key), '{}')
    from public.platform_permission_definitions d
   where exists (select 1 from public.platform_staff s join public.platform_roles r on r.id = s.role_id
                  where s.user_id = (select auth.uid()) and r.is_owner_role)
      or exists (select 1 from public.platform_staff s
                   join public.platform_role_permissions rp on rp.role_id = s.role_id
                  where s.user_id = (select auth.uid()) and rp.permission_id = d.id);
$$;
revoke all on function public.current_platform_permission_keys() from public, anon;
grant execute on function public.current_platform_permission_keys() to authenticated, service_role;
```

- It answers the same question as `has_platform_permission`, limited to catalogue keys. That is the
  same rule as `console_me.permissions`.
- A SELECT-only form of this query matched `has_platform_permission_for_user` on 255 of 255 cells
  locally. Locally only owners exist, so the real parity test (D8 P1) creates one fixture user per role.
- `console_me` is not changed: it belongs to harden. Its column is pinned by parity instead.

*Alternatives:*
- Keep N RPCs: they grow with every domain.
- JWT claims: they go stale until token refresh, and they would add a third definition.
- Read `platform_role_permissions` from the client: RLS lets only owners read it.

### D2. Held-key resolver independent of the auth source; a pure builder

- `resolveHeldPlatformKeys(source)`, with `source = { kind: 'cookie' } | { kind: 'bearer', supabase }`:
  - cookie: `getHeldPlatformKeys`, `cache()`d in `dal.ts`;
  - bearer: `callerHeldPlatformKeys(supabase)` in `console-agent.ts`. Route handlers do not share
    `cache()`, and each request resolves once.
- `buildPlatformAbility(held: ReadonlySet<PlatformPermissionKey>, ctx?: { userId })` stays isomorphic
  and pure. `ctx` exists for conditions only. No condition reads the user today, so it is reserved and
  unused in this change.
- `getPlatformAbility` and `getAdminNavGrants` use the cookie resolver. `requireAnyPlatformAction`
  reads the held set instead of one RPC per key.
- `hasPlatformPermission` and `requirePlatformPermission` stay. Every other domain still uses them.

### D3. The map keeps its shape; conditions live beside it

- `PLATFORM_ACTIONS` stays subject → action → key. New entries:

  | Subject | Actions → key | Row (`SubjectRows`) | Conditions (display) |
  |---|---|---|---|
  | `ConsoleCall` | `consult`, `conference`, `transfer` → `manage_voice` | `Pick<console_calls, 'id' \| 'kind' \| 'status'>` | `kind ∈ CONSULTABLE_KINDS`, `status = 'connected'` |
  | `ConsoleDial` | `dial` → `manage_voice` | none (claim) | – |
  | `AiCall` | `monitor`, `command`, `end` → `manage_voice` | `Pick<console_call_feed, 'call_attempt_id' \| 'status'>` | `status ∉ TERMINAL_STATUSES` |
  | `EventGuest` | `start_outreach` → `manage_voice` | none (claim; server-only today) | – |
  | `Campaign` | `runstate` → `campaigns.runstate` | none (claim) | – |
  | `Package` | unchanged | none (claim) | – |

  `consult` also covers consult/cancel and consult/complete; `conference` covers conference/remove.
  They use the same key and the same display conditions.
- `ConsoleDial` is split from `ConsoleCall`, so that every subject is either always conditional or
  never conditional. That keeps the static guard (D4) a simple rule.
- `PLATFORM_ACTION_CONDITIONS` maps (subject, action) to a function `(ctx) => MongoQuery<Row>`. The
  builder adds `can(action, subject, condition)` for a held key that has a condition, and the plain claim
  otherwise.
- **Single source for operational constants.** New `src/lib/console/call-rules.ts`, isomorphic, with no
  `server-only` import:
  - `LIVE_CUSTOMER_CALL_KINDS`;
  - `CONSULTABLE_KINDS`, derived from it as a subset that excludes `widget`, with a comment saying why;
  - `TERMINAL_STATUSES`;
  - `MANUAL_DIAL_MAX_LIVE_CALLS`.

  `console-calls.ts:137` and `call-attempts.ts:40-47` re-export them, so their API is unchanged. The
  copies at `call-bar.tsx:66-71` and `ai-handoff-section.tsx:37` are deleted. The precedent is
  `src/lib/console/presence.ts`, which is already shared.

*Alternatives:*
- Put conditions inside `PLATFORM_ACTIONS`: that changes the shape that the pilot's types and tests
  derive from.
- Put conditions in the database: they are operational and change with code, not with grants.

### D4. Typed instance checks and a guard against type-only checks

- `SubjectRows` (type-only import of `Tables<>`) and `InstanceOf<S>`. The tuple becomes
  `[A, S | (SubjectRows[S] & ForcedSubject<S>)]` for subjects with a row, and `[A, S]` otherwise. A
  `tsc` check showed `Package` unchanged, with every `@ts-expect-error` consumed.
- `canOn(ability, action, subjectType, row)` copies the row (`{ ...row }`) before `subject()`, because
  `subject()` mutates the object and throws on frozen or re-tagged objects.
- **Static guard.** No string-typed `.can('<a>', '<S>')` and no `<Can I= a=>` on a conditional subject
  (`ConsoleCall`, `AiCall`). CASL cannot enforce this: declaring an instance-only subject infers
  `action: never` (`AbilityBuilder.d.ts:14`).
- Reserved names: a unit test fails if `manage` or `all` appears in the map.

### D5. The Bearer action gate

`requireConsoleAction(ctx, action, subject)` returns `null` or a 403 `NextResponse`. It resolves the key
through `platformActionKey` and asks `callerHasPlatformPermission(ctx.supabase, key)`, the same function
the routes call today. Each of the 12 routes replaces one line, and the order stays:

```
requireConsoleAgent -> requireConsoleAction -> request.json() -> operational checks -> work
```

The route tests mock `callerHasPlatformPermission`, so they stay valid unchanged. The server never calls
`ability.can`.

### D6. Console UI

- **Controls.**
  - `call-bar.tsx:339`: `consultConferenceEnabled && canOn(ability, 'consult', 'ConsoleCall', collab)`.
  - `softphone-panel.tsx:1042` and the controls in `ai-handoff-section.tsx`: `handoffEnabled &&
    canOn(ability, 'monitor' | 'command' | 'end', 'AiCall', row)`.
  - The ability comes from the existing `PlatformAbilityProvider`, which already wraps the admin shell.
- **Mount gate.** `admin/layout.tsx` adds `rpc('is_console_agent')` to its `Promise.all`, and
  `softphone.enabled` requires it. That is one extra RPC, offset by D1. `console_me` is still read for
  `vox_username` and `display_name`.
- **Refresh contract.** A console fetch that receives 403 calls `router.refresh()` once. The layout then
  re-renders and the provider gets fresh rules. Plain navigation does not re-render the layout (Next
  docs), which is why the refresh is needed. There is no Realtime on RBAC tables and no polling.

### D7. Outside CASL, by name

The spec requirement lists the decisions that stay out of CASL:
- eligibility;
- data access (RLS, views, scope, phone mask, provisioned);
- feature flags;
- concurrency;
- DNC, opt-out and quiet hours;
- target readiness;
- claim ownership.

`is_console_agent` does not enter the map. It is not a catalogue key, and adding it would create a
parallel catalogue.

### D8. Proof

- **P1, key parity (local integration, rolled back).** One fixture user per platform role and one
  non-staff user. For every catalogue key, membership in `current_platform_permission_keys()` equals
  `has_platform_permission(k)`. For each fixture agent it equals `console_me.permissions`. anon gets
  42501 over HTTP.
- **P2, action parity (unit, extends `casl.test.ts`).** For every subset of keys:
  - claim subjects: `can(a, S)` holds exactly when the key is held;
  - conditional subjects: a row exists that is allowed only if the key is held;
  - the JSON round trip of the rules is unchanged.
- **P3, condition implication (unit, table).** For every combination of {kind × status × terminal},
  `canOn` true implies that the route's client-visible operational checks pass. This is an implication,
  not an equality.
- **P4, static checks.**
  - no duplicate of a `call-rules.ts` constant;
  - no key literal in the 12 routes;
  - `requireConsoleAgent` then `requireConsoleAction` come before `request.json()`;
  - no type-only check on a conditional subject;
  - no `manage` and no `all`.
- **Refusal.** The existing route refusal tests stay green. A forged-rules test posts with client rules
  that say yes while the database says no, and expects 403. This is the pilot's open evaluation item 4.
- **UI (component tests).**
  - an agent without the key sees none of the six controls;
  - an agent with the key sees them only in the right call state;
  - an inactive agent gets no panel.
- **Cost.**
  - one key RPC per admin render, measured with a counting mock;
  - the bundle delta, re-measured with the pilot's `evidence/measure-bundle-size.cjs`.
- **Regression.** Every pilot suite and every harden suite stays green. The exception is
  `platform-ability.test.ts:123`, which is replaced by "asks the database once".

## Risks / Trade-offs

- **[The mount gate hides the panel from an agent who should have it]** → The gate is
  `is_console_agent()`, the same check `sdk-auth` already makes, so such an agent could not sign in to
  the SDK today anyway. Verify in a browser as an active and as an inactive agent.
- **[The new function drifts from `has_platform_permission`]** → P1 runs in the local suite. Both
  functions read the same three tables.
- **[A type-only check over-grants in the UI]** → The P4 guard. In any case the server refuses (D5).
- **[Stale rules in the UI]** → The 403 → refresh contract. The rules are display only.
- **[Conditions diverge from the server]** → Both import `call-rules.ts`, and P3 tests the implication.
- **[Bundle growth]** → The conditions add mongo matching to an already shipped ability. Re-measure;
  `@casl/ability/extra` is not imported.

## Migration Plan

Steps:
1. Types: `SubjectRows`, `InstanceOf`, `canOn`. No runtime change.
2. The resolver, keeping the per-key implementation.
3. The DB function and P1, applied locally. The resolver then switches to it, and the pilot test is
   replaced.
4. `call-rules.ts`. The routes and data modules re-export from it.
5. The console subjects, the condition table, and the P2, P3 and P4 checks.
6. `requireConsoleAction` in the 12 routes.
7. The UI: `canOn`, the mount gate, the refresh contract.

Deploy:
- The function migration is additive. Pushing it to `main` deploys it through the Supabase GitHub
  integration, so the push needs an explicit decision.
- Rollback: drop the function and revert the commits. No data is changed.

Adoption order after this change, one domain per change:
1. the rest of `manage_voice` (about 30 files);
2. `manage_billing` beyond Package (about 26);
3. `view_customer_data` (about 17; the masking stays in the database);
4. `manage_settings` (about 52; it may need key splits first, which is a database decision);
5. the small keys, each as its domain is touched.

These counts come from grep and are a lower bound. Organization RBAC (`has_org_permission`) is a
separate axis and is out of scope.

## Open Questions

- The production agents' roles. A September document says all of them were owners, which would make the
  missing-`manage_voice` defect latent today. The plan does not depend on it.
- Whether React `cache()` deduplicates inside Server Actions. It affects only RPC counts on those paths;
  D2 resolves once per request either way.
