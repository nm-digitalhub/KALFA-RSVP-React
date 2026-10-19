# Design

## Context

The motivation is in proposal.md (Why); the required behavior is in
`specs/platform-action-authorization/spec.md`. This section records the current state, read from the code
on 19.10.2026.

**Gates today, all `manage_billing`:**
- the three pages: `src/app/(admin)/admin/packages/page.tsx:17`, `new/page.tsx:23` and `[id]/page.tsx:30`;
- all eight package data functions in `src/lib/data/admin/packages.ts`:
  - `listPackages` and `getPackage` (lines 60, 78);
  - `validateOutreachScheduleForPackage`, `getScheduleStepOptions` and `getSuggestedSchedule` (lines 195,
    235, 255);
  - `createPackage`, `updatePackage` and `deletePackage` (lines 284, 317, 341);
- `rewritePackageCopyAction` (`rewrite-action.ts:21`).

**The three Server Actions in `actions.ts` have no gate of their own.** They parse and validate the form
first, so a caller without the key still gets field errors back. Only after that does the data function
they call refuse.

**The two Supabase clients:**
- Writes and the list go through the user's session client (`createClient`), so the `packages` RLS policy
  applies too. That policy admits any staff member, and fixing it belongs to `staff-tables-permission-rls`.
- `validateOutreachScheduleForPackage` and `getScheduleStepOptions` use `createAdminClient`, which
  bypasses RLS. For them the DAL gate is the only check.

**Where else the flow names a key:**
- The sidebar item is `{ href: '/admin/packages', permission: 'manage_billing' }`. It is filtered in the
  client from `navGrants`, which `getAdminNavGrants` resolves (`nav-visibility.ts:33`, nine hand-listed
  keys).
- The dashboard card is shown when `getDashboardCounts` returns a packages count, and that count is gated
  on `view_billing` (`dashboard.ts:56,62`).

**What the installed CASL provides (read from `node_modules`, versions 7.0.2 and 7.0.1):**
- `@casl/ability` exports `createMongoAbility`, `AbilityBuilder` and the `MongoAbility` type.
- `@casl/react` exports `AbilityProvider`, `Can` and `useAbility`.
- `AbilityProvider`'s prop is **`value`**: that is what `dist/esm/index.mjs` and the `.d.ts` read. One
  README section shows `ability=` instead, so follow the types, not that example.
- The `@casl/react` bundle has **no `'use client'` directive** and uses React context. Next.js documents
  that context is not supported in Server Components and must be provided from a Client Component
  (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`, "Context
  providers").

**Constraint from Next.js docs:** Server Functions are reachable by direct POST, so authorization must be
re-verified inside each one (`07-mutating-data.md:32`, `02-guides/data-security.md:339`).

## Goals / Non-Goals

**Goals:**
- One declaration per package action that both the server gate and every UI control read.
- Enforcement through the existing audited path: the `has_platform_permission` RPC, memoized per render
  pass, and the redirect to `/access-denied`.
- Evidence for the decision gate: the duplication removed, the code added, and the bundle size added.

**Non-Goals:**
- Row-level conditions (CASL `conditions`). The pilot is claim-based: an action on a subject, no
  attribute rules.
- A new RPC that returns all of a caller's keys in one round trip. It would be a database change; it is
  recorded for the decision gate.
- The shared readers the package pages also call, `getVoximplantConfig` and `getChannelCatalog`. They
  are not package actions and run only after the page gate.

## Decisions

### D1. The map is a typed constant; the ability is derived from it
`src/lib/auth/platform-actions.ts` is an isomorphic module: no `server-only`, no server imports. It holds
one `as const` object, subject → action → permission key:

```ts
export const PLATFORM_ACTIONS = {
  Package: { read: 'manage_billing', create: 'manage_billing', update: 'manage_billing', delete: 'manage_billing' },
} as const;
```

The action and subject types and `PlatformAbility = MongoAbility<[Action, Subject]>` are derived from
this object and from CASL's own types, never written by hand. The same module exports
`buildPlatformAbility(held: ReadonlySet<string>)`, a pure function. It runs `AbilityBuilder` with
`createMongoAbility`, and adds `can(action, subject)` for each entry whose key is in `held`.

A key absent from `held` produces no rule, so the action is denied: the code fails closed. A test checks
every key in the map against the catalogue seeded in `supabase/migrations`, so a typo fails CI rather
than silently hiding a control.

*Alternative: a plain constant map and a helper, without CASL.* It removes the same duplication on the
server. It does not give the client a shared decision function or `<Can>`, and it leaves no path to
attribute rules. That is exactly the comparison the decision gate has to make, so the pilot records it
and does not presume it.

### D2. Per-request ability from existing RPCs; no new database code
The server-only `src/lib/auth/platform-ability.ts` exports `getPlatformAbility`, wrapped in React
`cache()`. It asks `hasPlatformPermission` for each distinct key in the map. The layout already asks
`manage_billing` for the sidebar, and the cache shares that RPC, so the pilot adds no round trip. The
answers go into `buildPlatformAbility`.

*Rejected: a `current_platform_permissions()` RPC.* It is cheaper as the map grows, but it is a database
change, and the pilot is meant to change none.

### D3. The server gate delegates to `requirePlatformPermission`
The same module exports `requirePlatformAction(action, subject)`. It resolves the key from the map and
returns `requirePlatformPermission(key)`. For a reader that serves either form, it also exports
`requireAnyPlatformAction(pairs)`:
- if every pair resolves to the same key, it makes one `requirePlatformPermission` call;
- otherwise it checks `hasPlatformPermission` for each key, and redirects to `/access-denied` when none
  passes.

The server and the client therefore decide from the same map, and enforcement stays on the existing
audited path, with one redirect implementation.

The tests prove that `buildPlatformAbility(held).can(a, s)` equals `held.has(PLATFORM_ACTIONS[s][a])` for
every subset. That is the equivalence between the UI decision and the server decision.

*Rejected: server checks through `ability.cannot()` plus a redirect.* It would be a second refusal path
next to the DAL's, and a bug in rule building would become an enforcement bug, not only a display one.

### D4. The binding of every entry point
| Entry point | Pair |
|---|---|
| `/admin/packages`, `listPackages` | `read Package` |
| `/admin/packages/[id]`, `getPackage` | `read Package` |
| `/admin/packages/new`, `createPackage`, `createPackageAction`, `getSuggestedSchedule` (new page only) | `create Package` |
| `updatePackage`, `updatePackageAction` | `update Package` |
| `deletePackage`, `deletePackageAction` | `delete Package` |
| `getScheduleStepOptions`, `validateOutreachScheduleForPackage`, `rewritePackageCopyAction` (they serve both forms) | any of `create`, `update Package` |

Each Server Action calls its gate on the first line, outside any `try`, so the redirect propagates as it
does today. This closes the gap where validation ran before the check.

### D5. The UI reads the same map
- **The layout.** `layout.tsx` resolves `getPlatformAbility()` and passes `ability.rules` to `AdminShell`.
  The rules are plain JSON and are the viewer's own grants, the same information `navGrants` already
  sends.
- **The provider.** A new `'use client'` wrapper, `src/components/platform-ability-provider.tsx`, rebuilds
  the ability with `createMongoAbility(rules)` (memoized on the rules) and renders
  `<AbilityProvider value={ability}>`. `AdminShell` wraps its children in it.
- **Client components** use `useAbility()` or `<Can>`:
  - the sidebar: a `NavItem` may carry `can: [action, subject]` in place of `permission`, and the
    packages item moves to `can: ['read', 'Package']`;
  - the delete control (`delete Package`);
  - the form's save button (`update Package` on the edit page).
- **Server components cannot read context.** They call `getPlatformAbility()` and check `ability.can`
  instead:
  - the list page's "חבילה חדשה" link (`create Package`);
  - the dashboard packages count. `getDashboardCounts` gates it on `read Package` in place of
    `view_billing`, which is the intended change listed in the proposal.
- **The sidebar key list.** `NAV_PERMISSION_KEYS` keeps `manage_billing`, because other items still use
  it. The coverage test learns that an item names either `permission` or `can`.

### D6. Proof
- **`platform-actions.test.ts`:**
  - every key exists in the seeded catalogue;
  - parity for every subset of the map's keys plus `view_billing`;
  - a JSON round trip of the rules gives the same decisions.
- **Refusal tests**, extending the existing package suites with the DAL mocked to refuse:
  - each Server Action called directly redirects to `/access-denied`, returns no `FormState`, and never
    reaches a data function;
  - each data function refuses before `createClient` or `createAdminClient` is called.
- **A static test** over the pilot's files:
  - no string literal equal to a catalogue key;
  - no direct `requirePlatformPermission(` or `hasPlatformPermission(` call;
  - every gate goes through `requirePlatformAction` or `requireAnyPlatformAction`.
- **The coverage tests:**
  - `admin-data-layer-coverage.test.ts` adds the two gates to its gate list and resolves the pin of
    `packages.ts` through `PLATFORM_ACTIONS`;
  - `admin-nav-coverage.test.ts` accepts `can`.
- **The project gates:** focused tests, the full suite, `npm run lint`, `npm run typecheck` and
  `npm run build`.

## Risks / Trade-offs

- **Two authorization paths live side by side until the decision gate.**
  → The static test keeps the pilot's files on the new path only, and the rest of the app is untouched.
- **`@casl/ability` 7.0.2 was published on 15.10.2026, four days before this plan.**
  → The lockfile already pins it. Read its release notes before apply, and fall back to 7.0.1 (6.7.2026)
  if anything in them touches the APIs in D1.
- **The README contradicts the types on `AbilityProvider`'s prop.**
  → Follow the shipped `.d.ts` (`value`). The provider test renders `<Can>` through the wrapper, so a wrong
  prop fails loudly with "AbilityContext is not provided".
- **A typo in the map hides a control from everyone, silently.**
  → The catalogue test fails CI on an unknown key.
- **The bundle grows on every admin page.**
  → The evaluation measures the `next build` route sizes before and after.
- **The dashboard card disappears for `view_billing`-only viewers.**
  → It is intended and listed. The `auditor` role has no members today, and the card's target already
  refuses such a viewer.

## Migration Plan

There is no database change and no data change. The owner deploys as usual. Rollback is reverting the
pilot's commits. Nothing persistent depends on it.

The last task writes `evaluation.md` in this change's folder: the duplication removed, the code added, the
bundle size added, and what migrating the remaining flows would take. The owner decides from it whether
CASL is adopted more widely, in a separate change.
