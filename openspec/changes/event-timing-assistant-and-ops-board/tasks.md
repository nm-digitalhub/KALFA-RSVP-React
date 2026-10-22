# Tasks

## Tracking

| Part | Groups | Status | Gate before the next part | Owner approval needed |
|---|---|---|---|---|
| 0. Preconditions | 1 | not started | baselines recorded; API key created by the owner | create the API key |
| A. Timing layer | 2–6 | not started | all Part A tests green locally; dry-run report approved | migration apply, dry-run report, push/deploy |
| B. Event assistant | 7–10 | not started | the D16 eval passes (≥95%) | packages install, migration apply, eval result, push/deploy |
| C. Staff board | 11–13 | not started | board tests green locally | migration apply, push/deploy |
| Final | 14–15 | not started | every gate green | commit, push, deploy (each separately) |

How to update it:
- Set Status to `in progress` / `done` when a group's last box is ticked.
- A box is ticked only when its stated verification has been run and passed, recorded in the commit message or in the PR body.
- Gates follow the project rules:
  - migrations only with `npx supabase migration new <name>`;
  - every DB run is against local Supabase only (127.0.0.1:54322 / 54321, `OUTREACH_DB_IT=1`, test-db-guard);
  - a push to `main` deploys migrations to production.

## 1. Preconditions and baselines

- [ ] 1.1 Record the baseline on the current `HEAD`, saved under `$TMPDIR/etab/baseline.txt` with the exit codes: `npm run lint`, `npx tsc --noEmit`, `NODE_ENV=test npx vitest run`, `npm run build`.
- [ ] 1.2 Re-verify on the live catalog (read-only) the facts the design rests on, saved as `$TMPDIR/etab/precheck.json`:
  - no writer of `outreach_state.next_run_at` in `src/`/`worker/` (grep);
  - the role grants of `campaigns.*`;
  - `permission_definitions` has no `('campaigns','schedule')`;
  - `platform_permission_definitions` has no `tasks.manage`;
  - the `supabase_realtime` publication list.
- [ ] 1.3 Owner creates an API key in the Claude Console under the owner's API organization and stores it as `KALFA_ANTHROPIC_API_KEY` in the server env. Verify: the env-validation probe (task 8.2) reports `ok` without printing the value.

## 2. Part A — schema (one migration, local only)

- [ ] 2.1 Create the migration with `npx supabase migration new timing_layer_foundation`. Verify: the file exists and has the CLI timestamp; no other migration file was created or edited.
- [ ] 2.2 In it, add:
  - `contact_interactions.initiator` (`kalfa`|`customer`, not null, backfill rule from D1) and `proposal_id`;
  - `campaigns.schedule_version`, `thankyou_state`, `thankyou_state_reason` (backfilled from `thankyou_sent_at` / `thankyou_auto_enabled`);
  - the `campaign_schedule_overrides` table;
  - the `timing_proposals` table (RLS on; select for `can_access_event(event,'campaigns','view')`; no client insert/update/delete).
  
  Verify: a pgTAP test file checks columns, constraints, RLS enabled and the privileges for `authenticated` and `anon`, including MAINTAIN, which pgTAP's `table_privs_are` does not cover.
- [ ] 2.3 Add the shape CHECK for `campaigns.outreach_schedule` through an immutable validator (array of `{days_before int ≥0, channel in enum, message_key text}`, days descending, no duplicates). Verify: pgTAP rejects a malformed and a mis-ordered schedule and accepts every live package schedule shape (copied from the read-only probe).
- [ ] 2.4 Add `claim_manual_send(campaign, contact, event, message_key)` and the partial unique indexes for `gift`, `event_day_pay`, `thankyou`. Re-point `claim_thankyou_recipient` to it. Verify: pgTAP shows that two claims of the same key return `claimed` then `already_claimed`, and that different keys are independent.
- [ ] 2.5 Add the `apply_timing_proposal(id)` SQL function per D3. It locks, re-checks status, expiry, `base_schedule_version` and `can_access_event(…,'campaigns','schedule')`, applies once and returns a code. Verify with pgTAP:
  - applied once, second call `already_applied`;
  - expired refused;
  - stale version refused;
  - caller without permission refused.
- [ ] 2.6 Add the `permission_definitions` row `('campaigns','schedule')` and seed it to the org owner role of every org. Extend the new-org seeding path to do the same. Verify:
  - pgTAP: `has_org_permission` is true for the org owner and false for member/admin/viewer;
  - `can_access_event` is true for the event owner;
  - the team roles screen lists the permission (integration test reading `getPermissionCatalog`).
- [ ] 2.7 Point the console views that read `next_run_at` to `planned_at` under the same column name. Verify: a pgTAP column-type assertion on each view passes, and the existing console integration tests pass unchanged.
- [ ] 2.8 Apply locally (`supabase migration up --local`, through the CLI wrapper) and run the pgTAP suite. Verify: all new tests pass; `supabase db diff --local` shows nothing unexpected; no residue.

## 3. Part A — pure timing functions

- [ ] 3.1 `effectiveSchedule(snapshot, overrides)` and its validation (no new step, same channel, order kept, sent steps untouched), in `src/lib/outreach/`. Verify: unit tests for move, skip, add-refused, reorder-refused and sent-step-refused.
- [ ] 3.2 Per-channel planning policy (D4). `ensureCurrentStep` uses the call-hours policy for `call` steps. Bump `SEND_TIMING_ALGORITHM_VERSION`. Verify: unit tests showing that a call step outside call hours is planned at the first call-hours slot, and that WhatsApp steps are unchanged.
- [ ] 3.3 `defaultThankyouSendAt` goes through `resolveSendSlot`, and the matching SQL default in the date-sync trigger is updated in the 2.x migration. Verify: unit tests for a Friday event (→ Sunday 10:00), an event the evening before a holiday, and a regular weekday. The pgTAP trigger test matches the TS result for the same dates.
- [ ] 3.4 Customer-time warnings: night, Shabbat, holiday, and past (refused). Verify: unit tests per warning code with fixed dates around Shabbat and Rosh Hashana.
- [ ] 3.5 Next-contact projection (D9): current step from `planned_at`, later steps projected. Verify: a unit test where a guest mid-schedule gets the stored time for the current step and the computed times for the next two.

## 4. Part A — data layer and authorization

- [ ] 4.1 Proposal create functions for `schedule_change`, `thankyou_time` and `manual_send`, gated by `requireEventAccess(eventId,'campaigns','schedule')`. Each writes the preview (times, affected count excluding already-claimed guests, warnings). Verify: integration tests through TS against local Supabase:
  - owner allowed;
  - org member without the permission refused;
  - member after the grant allowed;
  - preview counts match the seeded guests.
- [ ] 4.2 Apply path: one server function used by both screen and assistant. It calls `apply_timing_proposal` and then performs the send or schedule change. Verify: integration test that a double apply sends once; that a stale proposal is refused; and that a revoked permission between create and apply is refused.
- [ ] 4.3 Manual sends use `claim_manual_send` per guest and record `initiator='customer'` + `proposal_id`. Verify: integration test that gift twice reaches each guest once, and that the `contact_interactions` rows carry initiator and proposal id.
- [ ] 4.4 Thank-you state machine in `auto-thankyou.ts` and the manual thank-you. Verify: integration tests:
  - edit refused while `sending`;
  - manual thank-you sets `sent`;
  - closing the service sets `will_not_send` with its reason.
- [ ] 4.5 Audit (D10): `logActivity` on every proposal transition and customer send, meta without PII. Verify: integration test asserting action names and meta keys, plus a test that meta has no phone/name/text fields.
- [ ] 4.6 Record automatic skips in the worker (`outreach.contact_skipped` with reason code), and add the reader `getContactSkips` (gate `contacts.view`). Verify: a worker unit test with a do-not-call-listed contact writes one row; a reader integration test respects the gate.
- [ ] 4.7 `getNextContacts(eventId)` (gate `campaigns.view`). Verify: an integration test with seeded `outreach_state` returns the stored time for the current step and "no further contact" with the reason for a stopped guest.
- [ ] 4.8 Every `timing_v2_enabled` branch is covered. Verify: tests run with the switch on and off; off reproduces today's behaviour except the route removal.

## 5. Part A — customer UI

- [ ] 5.1 Campaign page controls (gift, event-day, thank-you, schedule) create proposals and show a confirm card with times, count and warnings. Each renders only when `canAccessEvent(…,'campaigns','schedule')` is true. Verify: component tests for both visibility states, and a local E2E (Next local + Supabase local) where the owner skips a step and sees the new times.
- [ ] 5.2 Thank-you state shown in Hebrew, including "will not be sent" with its reason. The confirm copy matches the recipients ("למי שאישר הגעה"). Verify: component test per state; copy test.
- [ ] 5.3 Per-guest next contact and skip reason on the guest page. Verify: component test with a stopped guest and a skipped guest.
- [ ] 5.4 Delete `src/app/api/campaigns/[id]/whatsapp-send/` and its mention in `allowed-origin.ts`. Verify: `grep -rn "whatsapp-send" src` returns only unrelated docs comments, and a request to the old path returns 404 in the local E2E.

## 6. Part A — planner re-plan safety

- [ ] 6.1 Write the dry-run script (read-only) that prints, for every active contact on production, the old planned time vs the new one from the bumped algorithm. Verify: it runs locally on seeded data with expected output; it contains no write statements (grep for insert/update/delete/rpc).
- [ ] 6.2 Run the dry-run read-only against production and save the report under `$TMPDIR/etab/replan-report.md`. Verify: the owner approves the report before 15.x.

## 7. Part B — schema (local only)

- [ ] 7.1 `npx supabase migration new assistant_foundation`. In it add:
  - `packages.ai_budget_agorot` (default 1000) and `campaigns.ai_budget_agorot`, copied in `create_package_campaign` / `change_campaign_package`;
  - `assistant_conversations`, `assistant_messages` (RLS: own rows select; no client writes);
  - `assistant_usage_ledger`;
  - the `app_settings` columns of D16/D21;
  - the reserve/settle/release SQL functions with the campaign row lock.
  
  Verify with pgTAP:
  - the budget copy happens at create and change;
  - two concurrent reserves exceeding the budget → exactly one succeeds (two connections);
  - settle ≤ reserve is enforced;
  - RLS denies another user's conversation.
- [ ] 7.2 Daily purge job (pg-boss) deleting conversations 90 days after the event date. Verify: an integration test with a seeded old event deletes only its conversations.

## 8. Part B — packages, configuration and admin settings

- [ ] 8.1 Install exactly `@ai-sdk/anthropic@4.0.85` and `@ai-sdk/react@4.0.152`, bump `ai` to `7.0.148`, and remove the direct `@anthropic-ai/sdk` line. Run as `NODE_ENV=development npm install …` (`.npmrc` keeps devDependencies). Verify:
  - `npm ls ai @ai-sdk/react @ai-sdk/anthropic` shows one `ai@7.0.148`;
  - devDependencies still installed (`ls node_modules/.bin/vitest`);
  - lint, tsc and vitest still match the 1.1 baseline.
- [ ] 8.2 `KALFA_ANTHROPIC_API_KEY` in `.env.example` and `ENV_KEY_SPECS`, with a `GET /v1/models` probe. Verify: `env-validation.test.ts` passes (1:1 with `.env.example`); the probe returns `ok` on the server without printing the key.
- [ ] 8.3 Admin settings section (behind `manage_settings`) for the assistant settings, and the package form field for the AI budget. Verify: component tests; an integration test that saving updates `app_settings` / `packages`; no value is hard-coded in `src/lib/assistant/` (grep for the model id and prices returns only defaults in the migration).

## 9. Part B — assistant

- [ ] 9.1 Knowledge documents in `src/lib/assistant/knowledge/*.md` (SKILL.md format):
  - KALFA vs customer sends;
  - Shabbat and holidays;
  - what the package allows;
  - proposals;
  - limits.
  
  Verify: a unit test checks frontmatter (description ≤ 60 chars, trigger first), size, and that every topic the `policy` tool names exists.
- [ ] 9.2 Tools (D13) as AI SDK `tool()` wrappers over the existing gated reads, with strict input, stripped output and the tool set computed from `canAccessEvent` probes. Verify: unit tests that each tool calls its read and strips fields (no phone/e-mail); an integration test that a user without `guests.view` gets no guest-name tool.
- [ ] 9.3 Route `POST /api/events/[id]/assistant`:
  - `streamText`;
  - `toolApproval` for `apply_proposal`;
  - history loaded from the database and checked with `validateUIMessages`;
  - `stopWhen(6)`, `maxOutputTokens` 1024, 60s abort;
  - rate limit, daily cap, switch and monthly cap.
  
  Verify: route tests with a mocked provider:
  - a forged approval for a non-existent or foreign proposal is refused;
  - the gates refuse an unpaid event, a viewer without `reports.view` and the switch off;
  - context bounds hold (20 messages, 4,000-char tool output).
- [ ] 9.4 Budget: reserve before `streamText`, settle in `onFinish` from `totalUsage` (cache read/write), release on error, notices at 80/100%. Verify:
  - unit tests of the price function against the official prices in D16;
  - an integration test where the budget runs out mid-conversation and the next question gets the quota message without a model call.
- [ ] 9.5 Client: `useChat` with `DefaultChatTransport` and `prepareSendMessagesRequest` (last message only); proposal card with approve/deny (`addToolApprovalResponse`); usage share and notices; RTL Hebrew; incomplete-answer marker. Verify: component tests; local E2E (Next local + Supabase local, mocked provider): ask → proposal card → approve → schedule version +1 and audit row.
- [ ] 9.6 Mount on the event page only when `packagePaymentOf` is `collected` and the user has `reports.view`. Verify: component/page tests for unpaid, paid and no-permission.

## 10. Part B — evaluation gate

- [ ] 10.1 The 40-question Hebrew evaluation set (status, guest lookups, timing, Shabbat, refusals, other-event and injection attempts) with expected tool calls and facts, under `src/lib/assistant/eval/`. Verify: the runner prints a per-case pass/fail table on a mocked provider.
- [ ] 10.2 Run the evaluation against `claude-haiku-5-5` with the real key, on a local seeded event (no production data), and record cost from the ledger. Verify: a result file under `$TMPDIR/etab/eval-haiku.md`; if <95%, run 10.3.
- [ ] 10.3 (only if 10.2 < 95%) Run against `claude-sonnet-5-5` and apply D16's rule. Verify: a result file; the owner approves the model setting and any budget change.

## 11. Part C — schema (local only)

- [ ] 11.1 `npx supabase migration new staff_event_board`:
  - `event_tasks`, `event_task_notes` (append-only: no update/delete grant);
  - `platform_permission_definitions` row `tasks.manage`;
  - RLS per D19 (per-operation rule of `staff-tables-permission-rls`);
  - the `board_changed` triggers;
  - the `realtime.messages` policy for topic `staff-board` (`has_platform_permission('view_events')`).
  
  Verify with pgTAP:
  - staff without `tasks.manage` cannot insert/update;
  - notes cannot be updated or deleted;
  - a customer cannot select tasks;
  - privileges (incl. MAINTAIN) as intended.
- [ ] 11.2 Register the two tables in the staff-table key map if `staff-tables-permission-rls` has landed; otherwise add a test that fails when the map exists without them. Verify: the coverage test passes.
- [ ] 11.3 Live-signal test: a real Realtime join for staff with `view_events` receives `board_changed` after a guest update; a customer join to `staff-board` is refused. Verify: an integration test against local Realtime (same harness as `permission-signal.local-it.test.ts`), 0 residue.

## 12. Part C — board

- [ ] 12.1 Server read for board rows (stage via `campaignStage`/`packagePaymentOf`, counts, progress, next contact from 4.7, problems, open tasks). Verify: integration test with seeded events in every stage; customer-data fields absent for a viewer without `view_customer_data`.
- [ ] 12.2 `/admin/board` page:
  - groups by stage; filters (stage, dates, has problems, assignee); sorting (event date, next contact);
  - test events only behind a filter;
  - navigation item with `view_events`.
  
  Verify: page/component tests; the gate redirects a staff member without `view_events`.
- [ ] 12.3 Task UI: create, edit, assign, due date, status, append-only notes, overdue marker. Read-only without `tasks.manage`. Verify: component tests; integration test that a direct change without the permission is refused.
- [ ] 12.4 Live refresh on `board_changed` with Broadcast Replay on re-join, reusing the pattern of `src/lib/realtime/permission-changes.ts`. Verify: unit test of the subscriber; local E2E shows a guest answer updating the open board.

## 13. Owner summary

- [ ] 13.1 Summary card on the event management page: stage, attending/declined/pending, next contact, needs-attention items (thank-you will not send, failed deliveries). Uses `getEventStats` + 4.7 + thank-you state. Verify: component tests per state; local E2E shows the same next-contact time as the assistant's answer for the same event.

## 14. Final verification and documentation

- [ ] 14.1 Fresh gates: `npm run lint`, `npx tsc --noEmit`, `NODE_ENV=test npx vitest run`, `npm run build`, all integration suites through `bash -ic 'bash scripts/integration/run-local.sh …'`, and the pgTAP suite. Verify: all green; the results are recorded with exit codes; each test is classified (static / SQL-RPC / PostgREST / TS integration / Worker / E2E).
- [ ] 14.2 Update documentation that describes timing, permissions and admin surfaces (`docs/project/02-auth-and-authorization.md` and the admin/settings docs touched by this change). Verify: the `update-documentation` checklist is run and every changed behavior is reflected.
- [ ] 14.3 `openspec validate event-timing-assistant-and-ops-board` passes, and every task box above is ticked with its verification recorded.

## 15. Commit, push, deploy (each a separate owner approval)

- [ ] 15.1 Commit per part (A, B, C) with explicit `git add <files>`. Before each commit, run `git status --short`, `git diff --stat`, `git diff --name-only` and `git ls-files --others --exclude-standard`, and confirm no unexpected files (`.env*`, `.agents/`, plans, unrelated migrations). Verify: each commit's file list matches its part.
- [ ] 15.2 Before push: read-only production probes (precheck 1.2 again), `get_advisors` comparison, and the approved dry-run report (6.2). Verify: no new advisor findings caused by this change.
- [ ] 15.3 Push to `main` only after explicit owner approval (applies the migrations to production). Verify: migration versions present in production (read-only query), triggers/policies present.
- [ ] 15.4 Deploy app, worker and owner-agent together after explicit approval. Switches stay off. Verify: services healthy, `timing_v2_enabled` and `assistant_enabled` false.
- [ ] 15.5 Turn on `timing_v2_enabled`, then `assistant_enabled`, each after explicit approval. Verify: the first real proposal is applied and audited; the first assistant answer settles a ledger row ≤ its reserve.

## Workflow follow-up

- Archive this change only on explicit request (`openspec archive event-timing-assistant-and-ops-board`), never automatically.
- When `separate-event-setup-from-management` lands, move the assistant and summary mount to its management page (D21 row).
