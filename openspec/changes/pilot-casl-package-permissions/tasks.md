# Tasks

Ground rules for every group:
- No database change, no deploy, no change to any flow outside packages.
- Tests are written first and must fail for the stated reason before the code that satisfies them.
- Each group ends with its focused tests green plus `npm run typecheck`.
- `npm run lint`, `npm run build` and the full suite run in group 6.

## 1. The action map and the ability (isomorphic)

- [x] 1.1 Read the `@casl/ability` 7.0.2 and `@casl/react` 7.0.1 release notes and confirm the APIs in
  design D1/D5 are unchanged from what `node_modules/@casl/*/dist/types` shows: `createMongoAbility`,
  `AbilityBuilder`, `MongoAbility`, and `AbilityProvider({ value })`. Verify: findings recorded at the
  top of `evaluation.md`; if anything differs, stop and report before 1.2.
- [x] 1.2 Write `src/lib/casl.test.ts` first:
  - every key in `PLATFORM_ACTIONS` is a key of the generated catalogue
    (`isPlatformPermissionKey` from `src/lib/auth/platform-permission-keys.generated.ts`);
  - for every subset of the map's keys plus `view_billing`, `buildPlatformAbility(held).can(a, s) ===
    held.has(PLATFORM_ACTIONS[s][a])`;
  - `JSON.parse(JSON.stringify(ability.rules))` rebuilt with `createMongoAbility` gives identical
    decisions;
  - every `Package` action is bound to `manage_billing`, which pins "no access change".

  Verify: the suite fails because the module does not exist.
- [x] 1.3 Rewrite `src/lib/casl.ts` (added in `2c7c723c`) per design D1, as the one module and not a
  second one next to it:
  - the `as const` map, its values typed by the generated `PlatformPermissionKey`;
  - types derived from the map and from CASL's generics, with no hand-written unions;
  - the pure `buildPlatformAbility`, with no owner rule and no subject inferred from a key's name.

  Verify: 1.2 green; `rg "lib/casl"` shows no other permission module.

## 2. The server gate

- [x] 2.1 Write `src/lib/auth/platform-ability.test.ts` first, with `@/lib/auth/dal` mocked:
  - `requirePlatformAction` calls `requirePlatformPermission` with the mapped key;
  - `requireAnyPlatformAction` makes one call when its pairs share a key, passes when any key passes,
    and redirects to `/access-denied` when none does;
  - `getPlatformAbility` asks `hasPlatformPermission` once per distinct key and builds the matching
    ability.

  Verify: red because the module does not exist.
- [x] 2.2 Create the server-only `src/lib/auth/platform-ability.ts` per design D2/D3: a `cache()`-wrapped
  `getPlatformAbility`, `requirePlatformAction` and `requireAnyPlatformAction`. Verify: 2.1 green.

## 3. The package data functions and Server Actions

- [ ] 3.1 Extend `src/lib/data/admin/packages.test.ts` first. For each of the eight functions, with the
  gate refusing, assert the refusal propagates and neither `createClient` nor `createAdminClient` was
  called. For the allowed path, assert the gate was called with the pair in design D4. Verify: red on
  the pair assertions.
- [ ] 3.2 In `src/lib/data/admin/packages.ts`, replace each `requirePlatformPermission('manage_billing')`
  with the D4 pair, and update the module comment to name the map. Verify: 3.1 green; existing
  package tests green.
- [ ] 3.3 Extend `src/app/(admin)/admin/packages/actions.test.ts` and `rewrite-action.test.ts` first.
  Each Server Action, called directly with the gate refusing:
  - lets the `/access-denied` redirect propagate;
  - returns no `FormState`, including no field errors for invalid input;
  - never calls a data function.

  Verify: red, because today `actions.ts` parses before any check.
- [ ] 3.4 Add the D4 gate as the first statement of `createPackageAction`, `updatePackageAction` and
  `deletePackageAction`, outside any `try`, and switch `rewritePackageCopyAction` to
  `requireAnyPlatformAction`. Verify: 3.3 green; existing action tests green.

## 4. The pages, the dashboard and the sidebar

- [ ] 4.1 Switch the three page gates to the D4 pairs. Render the list page's "חבילה חדשה" link only
  when `getPlatformAbility()` allows `create Package`. Verify: page tests cover allowed vs refused for
  the link, and `npm run typecheck` passes.
- [ ] 4.2 Write `src/components/platform-ability-provider.test.tsx` first: `<Can I="delete"
  a="Package">` rendered through the wrapper shows its child for rules that allow it and hides it
  otherwise. Then create the `'use client'` wrapper per design D5, with `createMongoAbility(rules)`
  memoized on the rules and `<AbilityProvider value={ability}>`. Verify: test green.
- [ ] 4.3 Pass `getPlatformAbility().rules` from `src/app/(admin)/admin/layout.tsx` into `AdminShell`.
  Wrap the children in the provider. Add the `can` field to `NavItem`, filter on it with `useAbility()`,
  and move the packages item to `can: ['read', 'Package']`. Update `admin-nav-coverage.test.ts` so an
  item names `permission` or `can`, and so a `can` pair must exist in `PLATFORM_ACTIONS`. Verify: the
  nav coverage suite green; a nav test shows the item for allowing rules and hides it otherwise.
- [ ] 4.4 Gate the delete control (`delete Package`) and the edit page's save button (`update Package`)
  with `<Can>` or `useAbility()`. Verify: the `package-form` and delete-form tests cover shown vs hidden.
  3.3 still proves the actions refuse whatever is hidden.
- [ ] 4.5 In `src/lib/data/admin/dashboard.ts`, gate the packages count on `read Package` through
  `getPlatformAbility()` instead of `hasPlatformPermission('view_billing')`, and update the module
  comment. Verify: the dashboard test shows the count for `manage_billing`, and `null` for a viewer who
  holds `view_billing` only. That is the listed behavior change.

## 5. The guards that keep the duplication gone

- [ ] 5.1 Write `src/lib/casl-pilot-static.test.ts`. Over the pilot's files it asserts:
  - no string literal equal to any catalogue key;
  - no direct `requirePlatformPermission(` or `hasPlatformPermission(` call;
  - every gate goes through `requirePlatformAction` or `requireAnyPlatformAction`.

  The pilot's files are `packages.ts`, everything under `src/app/(admin)/admin/packages/`, and the
  packages lines of the dashboard and the sidebar. Verify: green now; a temporary reintroduced literal
  turns it red, then is reverted.
- [ ] 5.2 Update `src/lib/auth/admin-data-layer-coverage.test.ts`: add the two gates to its accepted
  gates, and resolve the `packages.ts` pin through `PLATFORM_ACTIONS` instead of the literal. Verify: the
  suite is green, and a package function stripped of its gate turns it red.

## 6. Integration and the decision gate

- [ ] 6.1 Run the relevant focused suites, then the full suite, `npm run lint`, `npm run typecheck` and
  `npm run build`. Verify: all green. Record the `next build` route sizes of `/admin`, `/admin/packages`,
  `/admin/packages/new` and `/admin/packages/[id]` against a build of the parent commit.
- [ ] 6.2 Write `openspec/changes/pilot-casl-package-permissions/evaluation.md` with:
  - the places that named a key before and after, with line references;
  - the lines added and removed;
  - the bundle delta from 6.1;
  - what CASL gave beyond a plain map (D1 alternative);
  - the work and the order needed to move the remaining flows.

  Verify: every number in it traces to a command output or a file reference.

## Workflow follow-up

- The owner reviews `evaluation.md` and decides whether a wider migration gets its own change.
- The owner deploys and checks the package pages as `owner` and as the billing clerk.
- Archive this change after that review.
