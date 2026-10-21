# Proposal

## Why

The Package pilot (`pilot-casl-package-permissions`) proved one typed action map, `PLATFORM_ACTIONS`
(`src/lib/casl.ts:12-19`). It maps subject → action → one database key, and the same rules serve the
server gate and the UI. It cannot yet carry a domain whose permissions depend on more than one key:

- **Key resolution does not scale.** `getPlatformAbility` makes one `has_platform_permission` RPC per
  distinct key (`src/lib/auth/platform-ability.ts:21-40`). The admin layout already makes 11 permission
  RPCs per render, counted from the code. A second definition of "the keys I hold" also exists, in the
  `console_me.permissions` view column, which the Android app reads.
- **It is bound to the cookie session.** The console API authenticates with a Bearer token
  (`requireConsoleAgent`, `src/lib/auth/console-agent.ts:59`). Its 12 route gates hard-code the key:
  10 × `'manage_voice'` and `campaigns/[id]/status:70` `'campaigns.runstate'`, plus
  `events/[eventId]/outreach-call:65`.
- **No conditions and no instance checks.** The rule tuple is string-only (`casl.ts:25`), so
  `subject()` checks do not typecheck. A type-only `can()` on a conditional subject returns `true` even
  when every real row would be refused (executed on 7.0.2).
- **Real console defects follow from this:**
  - The softphone shows consult and conference (`call-bar.tsx:339`), and monitor, takeover and close
    (`softphone-panel.tsx:1042`), on feature flags alone. The routes refuse without `manage_voice`.
  - Operational constants are copied by hand between server and client (`call-bar.tsx:66-71`,
    `ai-handoff-section.tsx:37`, "KEEP IN SYNC").

Fixing the shape now (one key source, an ability independent of the auth source, conditions from shared
constants, instance checks) prevents every later domain migration from rebuilding the same plumbing.
There are at least 366 hard-coded key decisions in 142 files.

## What Changes

- **One source of held keys:**
  - New `public.current_platform_permission_keys()` returns the caller's catalogue keys as `text[]`.
    It uses the same owner rule as `has_platform_permission`, restricted to catalogue keys.
  - A key-parity test pins it to `has_platform_permission` and to `console_me.permissions`.
  - `getPlatformAbility` and the admin nav grants use it: 1 key RPC instead of N.
  - This supersedes pilot design D2 ("no new database code").
- **Held-key resolver independent of the auth source:**
  - `resolveHeldPlatformKeys(source)` for the cookie session (DAL, `cache()`d) and for the Bearer
    `ctx.supabase`. `buildPlatformAbility(held, ctx)` stays pure and isomorphic.
  - New `requireConsoleAction(ctx, action, subject)` for Bearer routes. It runs after
    `requireConsoleAgent`, delegates to the same key, and returns 403 JSON.
- **Typed subjects with rows, and conditions in one place:**
  - `SubjectRows` gives the row shape per subject. The tuple is widened so `subject()` checks compile;
    `Package` stays claim-only and unchanged.
  - New `PLATFORM_ACTION_CONDITIONS` table, keyed by the same (subject, action) pairs. Its values come
    from a new isomorphic constants module, `src/lib/console/call-rules.ts`, which the routes and the UI
    both import. The hand copies are deleted.
  - New wrapper `canOn(ability, action, subjectType, row)`, plus a static guard: no type-only `can()` on
    a conditional subject.
- **Console subjects on existing keys:**
  - `ConsoleCall{consult, conference, transfer}`, `ConsoleDial{dial}` and `AiCall{monitor, command, end}`
    → `manage_voice`;
  - `Campaign{runstate}` → `campaigns.runstate`;
  - `EventGuest{start_outreach}` → `manage_voice`.

  The 12 route literals are replaced by `requireConsoleAction`.
- **Console UI:**
  - the call-bar and AI-handoff controls show only when `canOn(...)` AND the feature flag allow;
  - a 403 from a console route triggers `router.refresh()`, which reloads the rules.
- **Reserved names:** no subject or action is named `manage` or `all`, because CASL treats them as
  wildcards.
- **Not changed:**
  - no RLS, GRANT or view (owned by `harden-console-agent-permissions`);
  - no new key and no role matrix change;
  - no `permittedFieldsOf`, `rulesToCondition` / `rulesToAST`, `packRules`, JWT claims or Realtime on
    the RBAC tables;
  - no Android change;
  - no other admin domain;
  - no server decision through `ability.can`.

## Capabilities

### New Capabilities
- `platform-permission-resolution`: how a caller's platform keys are resolved, the same way for every
  auth source; how the ability is built from them; how a client learns that its rules are stale.
- `console-action-authorization`: console actions as typed subjects and actions on existing keys; the
  server gate for the Bearer console API; UI conditions that imply the server's operational checks; the
  softphone eligibility gate; the list of console decisions that stay outside CASL.

### Modified Capabilities
- None in `openspec/specs/`. `platform-action-authorization` lives in the pilot change, which is not
  archived. This change keeps all of its requirements; see design D0.

## Impact

- **Already fixed outside this change:** the softphone used to mount on `console_me.vox_username`, which
  an inactive agent also has. `admin/layout.tsx` now requires `is_console_agent()`, and
  `layout.test.tsx` covers it. It needed no CASL.

- **Code:**
  - `src/lib/casl.ts` (extended, Package entries unchanged);
  - `src/lib/auth/platform-ability.ts`, `src/lib/auth/dal.ts`, `src/lib/auth/console-agent.ts`;
  - `src/lib/data/admin/nav-visibility.ts`;
  - new `src/lib/console/call-rules.ts`;
  - `src/lib/data/console-calls.ts` and `src/lib/data/call-attempts.ts` (re-export the constants;
    their API is unchanged);
  - `src/components/console/call-bar.tsx`, `ai-handoff-section.tsx` and `softphone-panel.tsx`;
  - 12 route files under `src/app/api/{console-calls,calls,campaigns,events}`.
- **Database:** one migration with the function only, `SECURITY DEFINER` with `search_path=''`,
  EXECUTE for `authenticated` only. No table, policy or grant change.
- **Tests:**
  - new key parity (local integration), action parity, condition-implication table and static guards;
  - every pilot and harden suite stays green;
  - `platform-ability.test.ts:123` ("asks the database once per distinct key of the map") is replaced
    on purpose by a single-RPC assertion.
- **Dependency:** the pilot must close first (its tasks 6.1 and 6.2 are open). This change builds on
  its map and tests.
- **Android:** none. The app reads `console_me.permissions`, and the parity test pins that column to the
  new function without changing it.
