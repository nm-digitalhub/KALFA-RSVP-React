# Proposal

## Why

The agent console layer admits callers on one predicate, `is_console_agent()`: platform staff with an
active `console_agents` row. On 21.10.2026 a security audit read the live catalog (read-only). Five
reviewers then checked every claim, and the claims were verified by execution on the local database. The
verified table of 73 findings is in design.md, Appendix A. The results that drive this change:

- **The data views ignore the console scope.** Only `console_events` limits itself to events with AI
  calls or a campaign. `console_event_guests`, `console_rsvp_results`, `console_campaign_targets`,
  `console_call_analysis` and `console_campaigns` filter on `is_console_agent()` alone. Executed: an
  active agent reads the guests and RSVP answers of an event that has neither. In production, 2 of 10
  events are outside the scope, and no console work references them (0 calls, 0 call-feed rows, 0 call
  analyses).
- **Agents need the work data.** Guest names, RSVP state, notes and call results are what an agent calls
  and records, so hiding them would stop the work. The phone number is the only contact identifier in
  the views, and it is already masked without `view_customer_data`. For agents dialling happens through
  server routes; the phone is display-only.
- **Secrets are readable at row level by every agent.** `console_agent_secrets` grants `authenticated`
  `SELECT (user_id)`, and its policy is `is_console_agent()`, so every agent lists every agent that has a
  secret. No client can read `vox_password`: its only reader is the server path that returns a hash. The
  grant exists for one reason: the security-invoker view `console_agents_roster` computes `provisioned`
  from it, and the in-repo softphone uses that flag for dial, transfer, consult and conference. Executed:
  narrowing the policy to the caller's own row breaks the flag for colleagues, and revoking the grant
  breaks the roster with `42501`.
- **`console_agent_shift` is over-granted.** `authenticated` holds every table privilege on it
  (`arwdDxtm`), including `TRUNCATE` and `MAINTAIN`. Both were executed successfully in SQL; neither is
  offered by PostgREST. The update policy checks ownership only. Executed: an inactive agent's
  `UPDATE` without `WHERE` changes its own row in raw SQL. Through PostgREST it cannot: a filterless
  `PATCH` is refused (`21000`), and every PostgREST update carries `WHERE` and `RETURNING`, so the
  `SELECT` policy hides the row.
- **The console object set is wider than "console_*".** It is eight views (with the roster) and eleven
  tables, plus `agent_status`, `call_dispatch_status` and `human_agent_call_legs`, which are gated by
  `is_console_agent()`.
- `console_call_pii` and `console_agent_commands` are closed (RLS on, no grant, no policy). Executed:
  every persona gets `42501` on every operation.

Production has 2 agents, both active staff.

## What Changes

- Limit every console data view to events in console scope through one definer helper,
  `console_event_in_scope(uuid)`. Work data inside the scope is unchanged.
- Keep the columns an agent works with visible to every active agent; keep the phone behind
  `view_customer_data`, as today.
- Compute the roster's `provisioned` through a definer helper, `console_agent_provisioned(uuid)`, and
  then close `console_agent_secrets` to every client. Executed in a rolled-back simulation: the roster is
  identical for every agent, and the table answers `42501`.
- Rebuild the `console_agent_shift` grants to `SELECT` plus column `INSERT`/`UPDATE` (`agent_id`,
  `active`, `updated_at`). Add `is_console_agent()` to its update policy. Executed: the PostgREST upsert
  shape still works on both the insert and the conflict path, while `TRUNCATE`, `MAINTAIN` and the
  inactive-agent update are closed.
- Pin the full client privilege map of all console objects with an inventory test, and set
  `search_path = ''` on `is_console_agent()` (executed: answers unchanged).
- Keep the owner-rights view design: `security_invoker` would empty the console, because agents are not
  event owners.
- No breaking change for agents: every recorded workflow keeps its data.

## Capabilities

### New Capabilities
- `console-access-control`: which client sessions reach the agent console layer, which work data and
  contact identifiers each one sees, how console secrets and server-only tables are protected, and the
  exact client privilege map, all enforced by the database and proven by local integration tests.

### Modified Capabilities
<!-- none: openspec/specs holds no capability yet -->

## Impact

- **Database:** future migrations, local first, pushed by the owner.
  - Two new `SECURITY DEFINER` helpers.
  - Redefinition of `console_agents_roster` and of the data views' row filter.
  - The `console_agent_secrets` policy dropped and its client grants revoked.
  - The `console_agent_shift` grants rebuilt and its update policy changed.
  - `search_path` set on `is_console_agent()`.
  - No data change.
- **Clients:**
  - (a) The Android agent console, `nm-digitalhub/KALFA-ELEVENLABS`, which is outside this repository.
    It reads the console views, `console_call_feed`, `agent_status`, `call_dispatch_status` and
    `human_agent_call_legs` with the agent's JWT (`docs/agent-console-api-contract.md`,
    `docs/voice-agent/app-integration-reference.md`).
  - (b) The in-repo web softphone, which uses the user session:
    - `src/components/console/*`;
    - `src/lib/realtime/console-channels.ts`;
    - `src/app/(admin)/admin/layout.tsx`;
    - `src/app/(admin)/admin/voice/console/page.tsx`.
    - `layout.tsx` now gates the softphone on `is_console_agent()`.
  - (c) The `requireConsoleAgent` API routes under `src/app/api/{agents,calls,console-calls,campaigns}`.
  - The service-role paths are not affected by RLS or grant changes:
    - queues and presence (`src/lib/data/console-queues.ts`, `console-agent-calendar-presence.ts`);
    - provisioning (`src/app/(admin)/admin/roles/actions.ts` → `src/lib/data/admin/platform-roles.ts`
      → `src/lib/data/console-agent-provisioning.ts`);
    - `src/lib/data/console-sdk-auth.ts`;
    - the worker cron.
- **Tests:**
  - `src/lib/auth/console-views.local-it.test.ts` (21 cases) and
    `src/lib/auth/console-findings.local-it.test.ts` (20 cases, including the simulations) are added by
    this change. Both are untracked until committed.
  - `src/lib/supabase/console-view-grants.test.ts` is the existing static guard.
- Out of scope: where Voximplant credentials are stored, the calling flow, customer-table RLS, and any
  deploy.
