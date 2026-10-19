# Proposal

## Why

The permission one admin flow needs is typed by hand as a free-text key in up to five places: the
sidebar item (`src/components/admin-shell.tsx`), the sidebar key list
(`src/lib/data/admin/nav-visibility.ts:33`), the page gate, every data function, and the dashboard card
condition. `requirePlatformPermission(key: string)` accepts any string (`src/lib/auth/dal.ts:196`), so
nothing ties the copies together. The audit of all 68 admin entries on 19.10.2026 found 30 gaps, most of
them drift between those copies. The package flow has one of its own: the dashboard "חבילות" card is
shown under `view_billing` (`src/lib/data/admin/dashboard.ts:56`), but it links to `/admin/packages`, which
requires `manage_billing` (`src/app/(admin)/admin/packages/page.tsx:17`).

`@casl/ability` 7.0.2 and `@casl/react` 7.0.1 are already in `package.json` and installed, and no code
uses them. Before deciding on any wider migration, this change proves on ONE flow, admin package
management, that a single action map read by both the UI and the server removes the duplication
without changing who may do what.

## What Changes

- **One shared action map.**
  - Package actions are declared once as CASL action/subject pairs: `read`, `create`, `update` and
    `delete` on `Package`. Viewing and editing are separate entries.
  - Each entry is bound to exactly one existing key from `platform_permission_definitions`. Today all
    four bind to `manage_billing`.
  - No new keys and no database change.
- **The database stays the authority.**
  - The ability is built per request from the caller's own permissions, read through the existing
    `has_platform_permission` RPC and memoized per render pass like every DAL check.
  - CASL holds no role list.
- **Server enforcement stays binding.**
  - A server-only gate resolves the key through the map and delegates to `requirePlatformPermission`:
    the same RPC, the same redirect to `/access-denied`.
  - The gate is used by every package data function, by every package Server Action, and by the three
    package pages.
  - Each Server Action calls the gate on its first line, before it parses input. Today `actions.ts`
    has no gate of its own and parses the form before any check.
  - No `'manage_billing'` literal remains in the flow.
- **The UI mirrors the same map, for display only.**
  - The admin layout hands the ability's serializable rules to a client `AbilityProvider`.
  - The sidebar "חבילות" item, the dashboard card, and the "חבילה חדשה" link and delete control in
    the package pages read `<Can>` or `useAbility()`.
  - Hiding a control never replaces the server check.
- **One intended behavior change, listed.**
  - The dashboard "חבילות" card follows `read Package` instead of `view_billing`.
  - A viewer who holds `view_billing` without `manage_billing` stops seeing a card whose target refuses
    them. Today that is the `auditor` role, which has no members.
  - Every other decision is unchanged, and the tests prove it.
- **Proof.**
  - Parity tests: for every subset of the flow's keys, the new decision equals the old one.
  - Refusal tests: each Server Action and data function, called directly, refuses before touching a
    database client.
  - A static test proves no permission-key literal is left in the flow's files.
  - The two existing coverage tests learn the new gate.
- **Decision gate.**
  - The change ends with a written evaluation: duplication removed, complexity and bundle size added,
    and what the migration of the remaining flows would take.
  - Until the owner decides, every other flow stays on `requirePlatformPermission` exactly as it is.

## Capabilities

### New Capabilities
- `platform-action-authorization`: admin actions are authorized through one shared action map bound
  to database permission keys. The map is enforced on the server and mirrored, for display only, in
  the client.

### Modified Capabilities
<!-- none: openspec/specs holds no capability yet -->

## Impact

- **New code:**
  - an isomorphic action map and ability builder in `src/lib/casl.ts` (the file added in `2c7c723c`,
    rewritten; no second module), keyed by the generated `PlatformPermissionKey`;
  - a server-only ability resolver and gate;
  - a `'use client'` provider wrapper, because `@casl/react` ships no `'use client'` directive and is
    built on React context, which Server Components cannot use.
- **Modified code:**
  - `src/lib/data/admin/packages.ts`;
  - `src/app/(admin)/admin/packages/` (`page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `actions.ts`,
    `rewrite-action.ts`, `[id]/delete-package-form.tsx`);
  - `src/app/(admin)/admin/page.tsx` and `src/lib/data/admin/dashboard.ts`;
  - `src/components/admin-shell.tsx` and `src/app/(admin)/admin/layout.tsx`.
- **Tests:**
  - `src/components/admin-nav-coverage.test.ts` and `src/lib/auth/admin-data-layer-coverage.test.ts`;
  - the package tests;
  - new parity, refusal and static tests.
- **Dependencies:**
  - `@casl/ability` 7.0.2 and `@casl/react` 7.0.1 are already declared, as part of the uncommitted
    `package.json` change. 7.0.2 was published on 15.10.2026.
  - Nothing new is installed.
- **Out of scope:**
  - the `packages` RLS policy, which admits any staff member (`staff-tables-permission-rls`, Group B);
  - new permission keys, or splitting view from edit in the database, which is a product decision
    made in `/admin/roles`;
  - every other admin flow;
  - the public reads of active packages;
  - removing `requirePlatformPermission`.
- **Risk:** two authorization paths exist side by side until the decision gate. The pilot's files use
  only the new one, and the static test keeps them from mixing.
