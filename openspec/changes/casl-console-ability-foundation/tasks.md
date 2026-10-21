# Tasks

Ground rules:
- Start only after `pilot-casl-package-permissions` tasks 6.1 and 6.2 are done.
- Integration files run one at a time:
  `SUPABASE_DB_PORT=54322 bash scripts/integration/run-local.sh <file>`
- A push of a migration to `main` deploys it (Supabase GitHub integration), so it needs a separate
  decision.

## 1. Types and resolver (no runtime change)

- [ ] 1.1 `src/lib/casl.ts`: add `SubjectRows`, `InstanceOf` and the widened tuple (design D4), plus
  `canOn` with the row copy. Verify:
  - `npx tsc --noEmit` passes;
  - a type test shows `can('read','Package')` still compiles and `subject()` checks compile;
  - `src/lib/casl.test.ts` and `src/lib/casl-pilot-static.test.ts` are green unchanged.
- [ ] 1.2 `resolveHeldPlatformKeys(source)` in `platform-ability.ts`, `getHeldPlatformKeys` (cookie,
  `cache()`) in `dal.ts`, and `callerHeldPlatformKeys(supabase)` in `console-agent.ts`. All still
  resolve per key. `getPlatformAbility` uses the resolver, and `buildPlatformAbility` stays pure. Fix the
  stale comment at `dal.ts:90-99`. Verify: every pilot suite listed in design D8 is green unchanged.

## 2. One key resolution

- [ ] 2.1 Write the key-parity test first, in a new `src/lib/auth/platform-keys.local-it.test.ts`:
  - one fixture user per platform role, created inside the transaction, plus a non-staff user;
  - per catalogue key, `has_platform_permission(k)` versus membership in the new function;
  - `console_me.permissions` for fixture agents;
  - anon 42501 over local PostgREST.

  Verify: red, because the function is missing.
- [ ] 2.2 `npx supabase migration new current_platform_permission_keys`, with the body of design D1.
  Verify: applied locally; 2.1 green; the fingerprint unchanged; the harden and permissions local-it
  suites green.
- [ ] 2.3 Switch the resolvers, `getAdminNavGrants` (`nav-visibility.ts`) and `requireAnyPlatformAction`
  to the single RPC. Replace `platform-ability.test.ts:123` with "asks the database once". Verify: a
  counting mock shows 1 key RPC per admin layout render; the pilot suites are green.

## 3. Shared console constants

- [ ] 3.1 Create `src/lib/console/call-rules.ts` with `LIVE_CUSTOMER_CALL_KINDS`, `CONSULTABLE_KINDS`
  (derived, excludes `widget`), `TERMINAL_STATUSES` and `MANUAL_DIAL_MAX_LIVE_CALLS`.
  `console-calls.ts:137` and `call-attempts.ts:40-47` re-export them. Delete the copies in
  `call-bar.tsx:66-71` and `ai-handoff-section.tsx:37`. Verify: the route tests are green; a static test
  finds no second definition of these constants.

## 4. Console subjects and conditions

- [ ] 4.1 Add `ConsoleCall`, `ConsoleDial`, `AiCall`, `EventGuest` and `Campaign` to `PLATFORM_ACTIONS`
  (design D3), and `PLATFORM_ACTION_CONDITIONS` from `call-rules.ts`. The builder emits conditional
  rules. Verify: the P2 action parity in `casl.test.ts` is green, with the JSON round trip;
  `admin-nav-coverage` is green.
- [ ] 4.2 Write the P3 implication table test (kind × status × terminal) and the P4 static checks:
  - no type-only check on `ConsoleCall` or `AiCall`;
  - no `manage` and no `all`;
  - no duplicated constant.

  Verify: green, and each check fails when it is mutated once (record the mutation).

## 5. Server gate for the Bearer API

- [ ] 5.1 `requireConsoleAction(ctx, action, subject)` in `console-agent.ts`, delegating to
  `callerHasPlatformPermission`. Replace the literal in the 12 routes:
  - `console-calls/[id]/{transfer, consult, consult/cancel, consult/complete, conference,
    conference/remove}`;
  - `console-calls/dial-intent`;
  - `calls/[callAttemptId]/{end, monitor, agent-command}`;
  - `events/[eventId]/outreach-call`;
  - `campaigns/[id]/status`.

  Verify:
  - every route test is green unchanged;
  - a static test finds no key literal in these routes, and the order
    `requireConsoleAgent → requireConsoleAction → request.json()`;
  - a new test sends forged client rules and expects 403.

## 6. Console UI

- [ ] 6.1 `call-bar.tsx` and `ai-handoff-section.tsx` / `softphone-panel.tsx:1042`: use `canOn` AND the
  flag. A 403 from these fetches calls `router.refresh()` once. Verify, in component tests:
  - an agent without `manage_voice` sees none of the six controls;
  - an agent with the key sees them only for a connected, consultable or non-terminal call.
- [ ] 6.2 `admin/layout.tsx`: the mount gate requires `rpc('is_console_agent')`. Verify:
  - a layout test shows that an inactive agent gets `enabled: false` and no `sdk-auth` request;
  - an active agent is unchanged.

## 7. Verification

- [ ] 7.1 Run everything:
  - the focused suites;
  - `npm run test`, `npm run lint`, `npx tsc --noEmit` and `npm run build`;
  - the local-it files one at a time (2.1, permissions, console-views, console-findings, console-rest);
  - the pilot's bundle measurement.

  Record the counts, the RPC count and the bundle delta in `verification.md` in this change, with one
  section per layer (unit/mock, local SQL, PostgREST, CI).
- [ ] 7.2 Browser check by the owner, as an active agent with `manage_voice`, an active agent without it,
  and an inactive agent:
  - controls per call state;
  - no panel for the inactive agent;
  - revoke a key while the page is open: 403, then refresh, then the control is gone.

  Record the results in `verification.md`.

## Workflow follow-up

- The owner decides on pushing the migration (2.2). A push to `main` deploys it.
- After the console, propose the next domain as a separate change, in the adoption order of
  design.md.
