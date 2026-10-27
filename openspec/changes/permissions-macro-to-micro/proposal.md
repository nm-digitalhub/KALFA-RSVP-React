# Proposal

## Why

KALFA decides what platform staff may do through three sources side by side: platform keys, a platform-owner
shortcut and console-agent membership. Nothing maps them from macro (who is asking) to micro (which gate enforces
which key), and where they meet they fail. This change covers the staff, owner and console axes, the event RSVP run
state where they meet, and the shared macro → micro map of every axis. Its two siblings cover the other axes:
`harden-public-access-surface` (no session) and `organization-action-map` (customers and organizations). The
failures below were measured on 2026-10-26 against the code and the live database (SELECT only).

- **Console membership is used as permission.** `requireConsoleAgent` answers 403 "אין הרשאה" to staff who are not
  console agents, and `is_console_agent()` grants work data in 4 RLS policies, the 5 event-scoped console views and
  `console_campaigns`. In 7 of the 19 Bearer routes membership is the only check. Two of them, `agents/call-history` and `agents/callbacks`, return
  callers' phone numbers from the whole line. That breaks harden D2, which shows a phone only to holders of
  `view_customer_data`.
- **Staff run-state changes leave no reliable audit.** Web pause and close write nothing: the live database has 4
  closed campaigns and 0 close rows. The console route audits after the change and swallows a failure. Console
  revival never logged: `logActivity` needs a cookie. `cancel_campaign` writes its row in the same transaction, but
  into `activity_log`, with an optional actor, no channel and no key re-check. `activity_log` is not evidence: any
  signed-in user can insert any action under their own id, and its rows are deleted with the event.
- **The cancellation flow moves money and then fails.** A `manage_billing` holder who resolves a cancellation
  refunds and emails first. Only then does the flow reach `closeCampaign`, which needs `campaigns.runstate`. The live
  billing clerk holds the first key without the second.
- **The owner is a shortcut, not a role.**
  - `requirePlatformOwner` gates 16 files, and `is_platform_owner()` gates 13 policies and 2 functions, all outside
    the key map.
  - `roles.manage` gates nothing.
  - Role writes run through the service role, and the role audit names the actor on 5 of its 35 rows.
- **Keys and gates disagree:**
  - only 2 of the 17 platform keys are in CASL; the rest are string literals in about 150 files;
  - 4 admin entry points check one key while the data they reach needs another;
  - the campaign page shows staff buttons by `manage_billing`, while the server enforces `campaigns.runstate`;
  - the permission-matrix analyzer recognizes no CASL gate, and it scans neither the Bearer routes nor `api/mcp`.

The owner set the direction on 2026-10-26:
- permissions are mapped macro → micro;
- console membership is an operational attribute, not a permission;
- every permission a change touches is defined in CASL;
- every change retires what it supersedes.

## What Changes

- **One map, macro → micro, for every axis.**
  - The chain runs: identity axis → role → key → CASL `subject.action` → gate.
  - A gate is a page, Server Action, Route Handler, data function, RLS policy, SECDEF function, view, column grant or
    Realtime channel policy.
  - The analyzer learns the CASL, Bearer and MCP gates and generates `docs/project/02a-permissions-map.md`. This
    change owns that file; the siblings supply its sessionless and organization sections.
- **Console membership becomes an operational precondition only.**
  - It stays only for what a seat at the console needs: 6 routes, the agent's own rows and live call, and the
    agents' shared console (directory, presence, queues and chat).
  - Everywhere else a CASL action on a platform key decides, on the cookie, Bearer and MCP paths alike.
  - **BREAKING** for access: staff who hold a key but are not enrolled gain those routes. Enrolled agents without
    the key lose console data they reach today, including the live billing clerk. Each such change is an owner
    decision.
- **The event is the subject.**
  - An event has at most one non-cancelled campaign (`campaigns_event_noncancelled_uidx`), which is its RSVP service.
  - Today's `Campaign` subject becomes `Event` actions.
  - The DB keys and the storage names do not change.
- **The RSVP service's run state is the first domain on the target model.**
  - One staff actor ("holds the event's RSVP run-state action", any transport) replaces `admin` and `console`.
  - One RPC, `campaign_runstate`, changes the state and writes the staff audit row in the same transaction.
  - `cancel_campaign` gets the same audit contract.
  - The UI offers exactly what the server allows.
  - The cancellation flow checks every authority before money moves.
- **All 17 platform keys enter `PLATFORM_ACTIONS`, domain by domain.** One key source
  (`current_platform_permission_keys`) feeds them, and a global static ban on key literals closes the step.
- **The owner axis retires into keys.**
  - Role and staff management gate on `roles.manage` and `manage_staff`, behind a database guard against
    self-escalation.
  - Each owner-only domain gets its own key.
  - The `is_platform_owner` policies and functions convert to keys.
- **Database hygiene, no access change:**
  - the console and owner policy calls move to initplan form;
  - 3 platform functions get `search_path=''`;
  - `is_staff` and `is_platform_owner` are retired.
- **Retired or superseded:**
  - the `console` and `admin` actor kinds, `requireConsoleAgent`, `requirePlatformOwner` / `isPlatformOwner` and
    `approveCampaign` (dead);
  - harden-console-agent-permissions D3;
  - casl-console-ability-foundation's gate order (`requireConsoleAgent → requireConsoleAction`).

  Every remaining task of casl-console-ability-foundation is folded into this change by id. That change does not
  proceed on its own.

## Capabilities

### New Capabilities
- `authorization-model`: the macro → micro permission map and its rules for the staff, owner and console axes:
  - which identity axes exist;
  - every staff gate decides through a CASL action on one key, on every transport;
  - console membership is an operational precondition, never an authorization answer;
  - keys that grant authority over permissions stay with the owner role;
  - the map is enforced by tooling.
- `event-rsvp-run-state`: who may pause, revive, close and cancel an event's RSVP service (stored as its campaign),
  through which single transition. It also covers the atomic audit contract, the console API's contract and how the
  UI matches the server.

### Modified Capabilities
- None: `openspec/specs/` is empty. Related in-flight changes are not archived:
  - casl-console-ability-foundation: `platform-permission-resolution`, `console-action-authorization`;
  - harden-console-agent-permissions: `console-access-control`;
  - pilot-casl-package-permissions: `platform-action-authorization`;
  - the siblings: `public-access-surface` (harden-public-access-surface) and `organization-authorization`
    (organization-action-map).

  Design D0 records which of their requirements this change keeps, absorbs or supersedes.

## Impact

- **Code:**
  - `src/lib/casl.ts` and `src/lib/auth/{platform-ability,console-agent,dal}.ts`;
  - the 19 Bearer routes under `src/app/api/{agents,calls,console-calls,events,campaigns}`; `api/mcp` is mapped
    but not changed;
  - `src/lib/data/{campaign-transition,campaigns,event-cancellation}.ts`, the campaign manage page and the console
    components;
  - `src/lib/data/admin/platform-roles.ts`, the roles pages, the `requirePlatformOwner` call sites (16 files) and the
    key-literal call sites (about 150 files);
  - `canCreateEvent` in `src/lib/data/events.ts`, and the owner-agent permission list with all its consumers (the
    WhatsApp owner agent, the report path, the MCP route, the runner and the smoke script);
  - `scripts/permission-matrix/*` and `.github/workflows/ci.yml`.
- **Database:**
  - new functions: `campaign_runstate`, `current_platform_permission_keys`, the role and staff write RPCs;
  - `cancel_campaign` recreated;
  - new owner-domain keys, and new columns `support_access_log.via`, `.action` and `.details`;
  - rewrites: 4 console policies, the 5 event-scoped console views and `console_campaigns`, the `is_platform_owner`
    policies, 2 ops functions, the staff exemption in `events_before_insert`, and the role audit and last-owner
    triggers;
  - initplan and `search_path` fixes; `is_staff` and `is_platform_owner` dropped.

  Every migration is its own push. A push to main deploys it (Supabase GitHub integration), and each needs owner
  approval.
- **Clients:** the Android console app (separate repo) keeps every status code and body. Its data layer narrows,
  though. By its docs it reads the console views and Realtime with the agent's own token, so an agent without
  `manage_voice` keeps only its own call and the shared console (C-O1, C-O9a).
- **Docs:**
  - `docs/project/02a-permissions-map.md` is new and owned here. It supersedes `02-auth-and-authorization.md` §6A
    and §6B; §7 is superseded by organization-action-map.
  - The app-team references are updated where behavior changes (tasks 3.7, 5.3 and 6.7).
