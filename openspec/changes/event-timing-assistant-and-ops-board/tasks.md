# Tasks

## Tracking

| Part | Groups | Status | Gate before the next part | Owner approval needed |
|---|---|---|---|---|
| 0. Preconditions and E2E harness | 1, 20 | not started | baselines recorded; harness smoke E2E green; API key created by the owner | install `@playwright/test`; create the API key |
| E. Activation after payment | 21 | not started | 21.7 and 21.8 green locally | push/deploy |
| F. Setup and management (merged) | 22–26 | not started | all Part F tests and E2E green locally | migration apply, push/deploy |
| Management page (D26) | 29 | not started | 29.2 green locally | push/deploy |
| G. Staff campaign page | 27–28 | not started | all Part G tests and E2E green locally | push/deploy |
| A. Timing layer | 2–6 | not started | all Part A tests and E2E green locally; dry-run report approved | migration apply, dry-run report, push/deploy |
| B. Event assistant | 7–10 | not started | the D16 eval passes (≥95%); Part B E2E green locally | packages install, migration apply, eval result, push/deploy |
| C. Staff board | 11–13 | not started | board tests and E2E green locally | migration apply, push/deploy |
| D. Package upgrade | 14–17 | not started | Parts A and F merged locally; all Part D tests and E2E green locally | migration apply, push/deploy, switch on |
| Final | 18–19, 30 | not started | every gate green; E2E coverage map complete | commit, push, deploy (each separately) |

**Execution order:** 0 → E → F → management page → G → A → B → C → D → Final. Task 25.3 (the vocabulary scan) lands before any new customer UI of A, B or D. Part B's E2E needs Part A's proposals; Part D needs A's schedule layer and F's shared admission function.

How to update it:
- Set Status to `in progress` / `done` when a group's last box is ticked.
- A box is ticked only when its stated verification has been run and passed, recorded in the commit message or in the PR body.
- Every report names each test's class (static / SQL-RPC / PostgREST / TS integration / Worker / E2E). A test is E2E only under D27's definition: a browser through the real routes, the worker and local Supabase, with only the providers faked.
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
- [ ] 1.4 Owner approves installing `@playwright/test` as a devDependency at the installed `playwright` version (1.64.1). Verify: `npm ls @playwright/test playwright` shows one matching version; `.npmrc include=dev` keeps it under `NODE_ENV=production`.

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
- [ ] 6.2 Run the dry-run read-only against production and save the report under `$TMPDIR/etab/replan-report.md`. Verify: the owner approves the report before 19.x.
- [ ] 6.3 Part A E2E (`e2e/timing.spec.ts`, D27):
  - the owner moves a step through the proposal card, confirms it, and the next-contact time shown equals the time the worker plans (read from `outreach_state.planned_at`);
  - a customer-chosen time on Shabbat shows the warning, is confirmed, and the fake WhatsApp receives the send at that time (test clock);
  - a gift send pressed twice reaches the fake WhatsApp once per guest;
  - a member without the timing permission sees no send or timing control;
  - the default thank-you after a Friday event lands on the first allowed slot;
  - the removed route `whatsapp-send` answers 404.

  Verify: green; fingerprint unchanged; each Part A scenario is in `e2e/COVERAGE.md`.

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
- [ ] 8.3 Admin settings section (behind `manage_settings`) for the assistant settings, and the package form field for the AI budget, which goes into `operationalFieldsSchema` and follows `src/app/(admin)/admin/packages/AGENTS.md`: CASL gates only, no quoted permission key. Verify: `npx vitest run "src/app/(admin)/admin/packages" src/lib/casl-pilot-static.test.ts` passes; component tests; an integration test that saving updates `app_settings` / `packages`; no value is hard-coded in `src/lib/assistant/` (grep for the model id and prices returns only defaults in the migration).

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
- [ ] 9.6 Mount on the management page (D26) when `eventMode` is `management` and the user has `reports.view`. Verify: page tests for setup, management, management with a pending refund (still mounted) and no permission.

## 10. Part B — evaluation gate

- [ ] 10.1 The 40-question Hebrew evaluation set (status, guest lookups, timing, Shabbat, refusals, other-event and injection attempts) with expected tool calls and facts, under `src/lib/assistant/eval/`. Verify: the runner prints a per-case pass/fail table on a mocked provider.
- [ ] 10.2 Run the evaluation against `claude-haiku-5-5` with the real key, on a local seeded event (no production data), and record cost from the ledger. Verify: a result file under `$TMPDIR/etab/eval-haiku.md`; if <95%, run 10.3.
- [ ] 10.3 (only if 10.2 < 95%) Run against `claude-sonnet-5-5` and apply D16's rule. Verify: a result file; the owner approves the model setting and any budget change.
- [ ] 10.4 Part B E2E (`e2e/assistant.spec.ts`, fake Anthropic with scripted tool calls):
  - a status question answered with figures that match the page;
  - a timing request produces a proposal card; approve applies the Part A proposal once; deny applies nothing;
  - a question about another event is refused;
  - the 80% and 100% budget notices appear once each, and a reply is refused at 100%;
  - an unpaid event shows no assistant.

  Verify: green; the cost ledger rows settle ≤ their reserve; coverage map updated.

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
- [ ] 12.4 Live refresh on `board_changed` with Broadcast Replay on re-join, reusing the pattern of `src/lib/realtime/permission-changes.ts`. Verify: unit test of the subscriber; E2E in 13.2.

## 13. Owner summary

- [ ] 13.1 Summary card on the management page (D26): stage, attending/declined/pending, next contact, needs-attention items (thank-you will not send, failed deliveries). Uses `getEventStats` + 4.7 + thank-you state. Verify: component tests per state; E2E in 13.2.
- [ ] 13.2 Part C E2E (`e2e/board.spec.ts`):
  - a staff member with `view_events` sees the event in its stage column; customer-data columns are absent without `view_customer_data`;
  - a guest answer through the fake WhatsApp webhook updates the open board without reload;
  - a task is created, assigned and closed; read-only without `tasks.manage`;
  - the owner's summary shows the same next-contact time as the assistant's answer for the same event.

  Verify: green; coverage map updated.

## 14. Part D — schema (local only)

- [ ] 14.1 `npx supabase migration new package_upgrade`. In it add:
  - `campaign_package_changes` (D22 columns; states; one-open partial unique index; RLS on, owner select via `can_access_event(event_id,'campaigns','view')`, staff select via `has_platform_permission('view_billing')`; no client insert/update/delete);
  - `payment_operations.package_change_id` with the kind ⇔ link CHECK;
  - `app_settings.package_upgrade_valid_days` (default 7) and `package_upgrade_enabled` (default false).
  
  Verify with pgTAP:
  - privileges for `authenticated` and `anon`, including MAINTAIN;
  - a second open upgrade of the same campaign is refused by the index;
  - a `package_upgrade` operation without a link, and a link on another kind, are refused;
  - an owner cannot select another event's rows.
- [ ] 14.2 Upgrade paths: `package_upgrade_paths` (PK, self-path CHECK, cascading FKs, RLS select for `manage_billing`, no client writes) and `set_package_upgrade_paths`. Verify with pgTAP:
  - a cheaper target, a smaller quota or a missing channel is refused with the target and reason;
  - a self path is refused;
  - the set is replaced atomically (a refused target leaves the old set);
  - a staff member without `manage_billing` cannot select or call;
  - deleting a package with no campaigns removes its paths;
  - privileges for `authenticated` and `anon`, including MAINTAIN.
- [ ] 14.3 `offer_package_upgrade` and `approve_package_upgrade` (D22). `offer_package_upgrade` also requires a path and refuses a target without one. Verify with pgTAP, one test per spec scenario:
  - closed/cancelled campaign, payment in review, second open upgrade refused;
  - smaller quota and removed channel refused as downgrades;
  - amount: no benefit 1,500 − 1,000 = 500; partial refund → 600; benefit option 1,300 − 800 = 500; no option 1,500 − 800 = 700;
  - approval stores the amount, the user and the agreement version;
  - with no collected money: new round at the full price, package fields switched, status `pending_approval`, no upgrade operation.
- [ ] 14.4 `apply_package_upgrade` and `expire_package_upgrades` (D22). Verify with pgTAP:
  - apply twice → applied once (one new round, one `campaign_quota_changes` row);
  - apply without a succeeded linked operation refused;
  - waiting contacts admitted up to the new quota (100 seated + 20 waiting, quota 150 → 120 seated);
  - expiry after `valid_days` and never past the event date;
  - a declined or expired upgrade leaves template, quota, channels, schedule and the current round unchanged;
  - a succeeded upgrade operation leaves `coupon_assignments` and `coupon_assignment_options` unchanged (the live consume trigger is a no-op on an already consumed benefit), and the new round carries the same `coupon_assignment_id` when its option priced the upgrade.
- [ ] 14.5 Upgrade benefits, schema and SQL (D22 "Upgrade benefits"), in the same migration:
  - `offers.purpose` with its CHECK;
  - `coupon_assignments.purpose` + `for_campaign_id`, frozen by `coupon_assignments_freeze`;
  - the upgrade branch in `create_staff_coupon_assignment`;
  - the second branch of `payment_operations_consume_benefit`;
  - `held_by_upgrade` in `void_staff_coupon_assignment`;
  - the `purpose = 'purchase'` filter in `bind_coupon_assignment`, `change_campaign_package`, `supersede_campaign_pricing`, `replace_sales_coupon_assignment`, `release_coupon_assignment`, `payment_operations_open_guard`.
  
  Verify with pgTAP, one test per spec scenario of the five upgrade-benefit requirements:
  - an upgrade benefit is never bound at purchase;
  - another event's service and an unlisted target are refused;
  - 20% of 500 → 400;
  - a fixed 300 on 300 is skipped;
  - two benefits → the lower final, the other stays assigned;
  - consumed only when the upgrade operation succeeds;
  - a decline keeps it bound;
  - expiry releases it;
  - void while held → `held_by_upgrade`;
  - an upgrade offer with `allow_agent = true` is refused.
- [ ] 14.6 In the same migration, re-create `close_event_retiring_setup` (task 23.1) so a close is refused while a `campaign_package_changes` row is `approved` or its payment is pending or in review, and an `offered` row is cancelled and its held upgrade benefit released in the same transaction (D24, event-closure spec). Verify with pgTAP: each case, plus every 23.2 case still passing.
- [ ] 14.7 Apply locally through the CLI wrapper and run the pgTAP suite. Verify: all pass; `supabase db diff --local` shows nothing unexpected; no residue.

## 15. Part D — payment state and payment path

- [ ] 15.1 `deriveStatus` returns `upgradeInFlight` and no longer lets an in-flight `package_upgrade` override `status`. Replace the test "an upgrade in flight beats the settled state" with its opposite. Verify: unit tests for pending, review, failed and succeeded upgrades over a collected purchase; `campaignStage` for a running service is unchanged with an upgrade pending.
- [ ] 15.2 The CardCom purchase path accepts `kind = 'package_upgrade'` with the stored `amount_due` and the link; the receipt line is "שדרוג חבילה: <from> → <to>"; the saved card is offered when stored. Verify: unit tests with a mocked provider; the amount is read from the row, never from the request; a second click while pending is refused by the existing index.
- [ ] 15.3 Targets and package admin:
  - the target list and every target read go through `listPackageOffers` / `getPackageOffer`;
  - the browser sends only the id;
  - the payment start re-reads the target and cancels with `target_withdrawn` when it is no longer offered;
  - `deletePackage` maps 23503 to the campaign-or-upgrade message, and the folder's `AGENTS.md` is updated.
  
  Verify:
  - unit tests: an inactive, quota-less or switch-off target is not listed and is refused;
  - an integration test through TS against local Supabase: deactivating the target after approval cancels the upgrade at payment start and releases the benefit;
  - `actions.test.ts` in `/admin/packages` covers the new delete message;
  - `src/lib/auth/permissions.local-it.test.ts` deletes a package referenced only by an upgrade and gets the message.
- [ ] 15.4 Settlement of a succeeded `package_upgrade` calls `apply_package_upgrade`; a decline sets `declined` (retry allowed until expiry); review holds the row. A settled upgrade whose change is not applied is listed by the orphan sweeper. Verify: integration tests through TS against local Supabase (mocked provider): success applies once even when the settlement repeats; decline and review keep the current package.

## 16. Part D — schedule, quota and audit

- [ ] 16.1 On apply, rebuild the effective schedule over the new snapshot (D2): keep overrides of steps that exist, close the rest with reason `package_upgrade`, bump `schedule_version`, re-plan. A new step already past is recorded `outreach.step_skipped` / `added_after_due`. Verify: integration tests: a sent 14-day step is not re-sent; a moved 7-day step keeps its time; a new 21-day step with the event 10 days away is skipped and recorded.
- [ ] 16.2 The campaign AI budget becomes the new package's budget (Part B column), usage counting within it. Verify: pgTAP that apply copies the budget and the used amount is unchanged.
- [ ] 16.3 `logActivity` for every upgrade transition with change id, initiator and amounts. Verify: integration test asserting action names and meta keys, and that meta holds no card or personal fields.

- [ ] 16.4 TS readers: `coupon-benefits.ts` and `agent-benefits.ts` exclude `purpose = 'upgrade'`; the upgrade price function applies the upgrade benefit with `computeOfferOption`. Verify: unit tests of the price function (percent, fixed, floor, two benefits); integration tests through TS against local Supabase that a purchase never sees an upgrade benefit and that the sales agent never offers one.

## 17. Part D — screens

- [ ] 17.0 Upgrade paths in `/admin/packages`, the CASL pilot folder, following its `AGENTS.md`:
  - the form gets the "אפשר לשדרג ל" section (`upgrade_targets_json`), saved through `set_package_upgrade_paths`;
  - per-target refusals appear next to the target;
  - the list gets "אפשר לשדרג ל" / "שדרוג מ" badges and invalid paths with their reason (`upgradePathsReport`);
  - `upgradeTargetsFor` lives in `src/lib/data/package-offers.ts`.

  Verify:
  - `npx vitest run "src/app/(admin)/admin/packages" src/lib/casl-pilot-static.test.ts`, with the form, action and list tests extended;
  - unit tests of `upgradeTargetsFor` for each reason code, no transitivity, and a target withdrawn from the catalogue;
  - the folder's `AGENTS.md` documents the new field contract.

- [ ] 17.1 Owner: in "החבילה שלך" on the management page (D26) for a paid service, and in the setup payment step for an approved, unpaid one (D24), "upgrade package" with the target list from `upgradeTargetsFor`, each labelled "שדרוג" with this owner's amount (a target package stays a regular package in the new-purchase list), the approval card (current vs new package, quota, channels, remaining schedule, exact amount, agreement, the "benefit does not apply" notice), the payment step and the upgrade state. Gate: `requireOwnedEvent`. Verify: component tests per state; a local E2E (Next local + Supabase local, mocked provider): offer → approve → pay → the service shows the new package and quota.
- [ ] 17.2 Staff: "offer upgrade" on the staff campaign page `/admin/campaigns/[campaignId]` (Part G) behind `manage_billing`; the history list (offers, approvals, payments, applications, failures) behind `view_billing`; the board shows "upgrade awaiting payment". Verify: component tests; an integration test that staff without `manage_billing` are refused and that staff cannot approve or pay.
- [ ] 17.3 Benefit screens:
  - `/admin/offers` gets the purpose choice (agent fields hidden for upgrade);
  - `/admin/assignments/new` gets the event-service step and the per-target preview;
  - the list and detail label the purpose;
  - `VOID_REFUSALS` and `BLOCK_REASON_TEXT` get `held_by_upgrade`.
  
  Verify:
  - the colocated `actions.test.ts` and page tests of both folders, extended;
  - the run commands in both `AGENTS.md` files pass;
  - both `AGENTS.md` files are updated with the new purpose rules.
- [ ] 17.4 Every Part D surface renders only when `package_upgrade_enabled` is on. Verify: tests with the switch on and off; off shows no upgrade control and changes no payment behaviour.
- [ ] 17.5 Part D E2E (`e2e/upgrade.spec.ts`, fake CardCom):
  - staff offer an upgrade; the owner sees it on the management page, approves, pays the difference; the quota grows and a waiting guest is admitted; past sends are not repeated;
  - a declined upgrade payment leaves the current package running;
  - an approved, unpaid owner upgrades from the setup payment step and approves the terms again at the full price;
  - an upgrade benefit lowers the difference and is marked used only after the payment succeeds;
  - closing an event with an offered upgrade cancels it and frees its benefit.

  Verify: green; coverage map updated.

## 20. E2E harness (D27)

- [ ] 20.1 `scripts/e2e/run-local.sh`: creates or refreshes the git worktree `$TMPDIR/kalfa-e2e` at `HEAD`, links `node_modules`, writes `.env.test.local` there from `supabase status -o env` and fixed test values, builds with `NEXT_DIST_DIR=.next-e2e` and `NODE_ENV=test`, builds the worker bundle, starts `next start -p 3999`, `node dist/worker.cjs` (working directory: the worktree) and the fake-provider server, each under `env -i` with an allowlist, then runs `npx playwright test` and stops everything. Verify:
  - `.env.local` does not exist in the worktree, and `.env.test.local` there is ignored by git;
  - the built browser bundle contains `127.0.0.1:54321` and not the production Supabase host (grep in `.next-e2e/static`);
  - `NEXT_PUBLIC_GA_ID` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` are unset in the build;
  - the preflight exits non-zero, before starting anything, for each planted fault: a non-local `API_URL`, a DB port other than 54322, `OUTREACH_DB_IT` unset, a container whose project label is not `beta`, a non-loopback provider origin;
  - `worker/start.mjs` is never invoked (the script's process list).
- [ ] 20.2 One origin override per provider, read in one place each: the CardCom `mutator.ts` and `OPEN_FIELDS_ORIGIN` (`src/lib/cardcom/open-fields.ts:28`), the WhatsApp client, the Voximplant client, the Anthropic provider's `baseURL`, the Slack sender. A value that is not a loopback URL throws at startup; an unset value keeps today's provider URL. Verify: unit tests per client (unset, loopback, non-loopback); a test that `.env.example` defines none of these variables.
- [ ] 20.3 The fake-provider server in `e2e/fakes/` (CardCom LowProfile create, GetLpResult, webhook sender and an Open Fields page posting the same window messages; WhatsApp send and status webhooks; Voximplant StartScenarios and result callback; Anthropic Messages with scripted replies; Slack recorder). Request and response shapes are typed from the repo's own provider types. Verify: contract tests of each fake against those types; a record of every call is readable by the specs.
- [ ] 20.4 E2E fixtures: users and events created through the app or `FixtureScope`, removed in `afterAll`; the run fails if the table fingerprint changes (the integration runner's check). Verify: a spec that creates and removes a user, an event and a paid service leaves the fingerprint unchanged.
- [ ] 20.5 Smoke E2E (`e2e/smoke.spec.ts`): signup, e-mail verification through the local mail catcher, first event created. Verify: green twice in a row; fingerprint unchanged.
- [ ] 20.6 `e2e/COVERAGE.md` maps every scenario of every spec in this change to an E2E spec and test name, or to a lower-level test with the reason (pure function, SQL-only, provider-only). `e2e/coverage-map.test.ts` parses the specs and fails on an unmapped scenario or a mapping to a missing test. Verify: the test fails on a planted unmapped scenario and passes on the tree.

## 21. Part E — activation after payment (D23)

- [ ] 21.1 Actor kind `system` in `CampaignActor` and its branch in `transitionCampaignStatus`: event read with the service-role client, the same event guards, no ownership check. Verify: unit tests (guards applied; `requireUser` and `requireOwnedEvent` not called); `campaigns.test.ts` green.
- [ ] 21.2 `activatePaidPackage(campaignId)` in `src/lib/payments/activate-paid-package.ts`: `approved → active` only, inside the guarded update; completion that checks before it writes (`thankyou_send_at` if null, one `campaign.activated` row through an admin insert); results `started`, `already_active`, `not_applicable`. Verify with a local integration test: paid approved → active, one activity row, thank-you set; called twice → one row; paused → unchanged and `not_applicable`; a crash simulated after the status write → the next call completes; past event → refused; unpaid → refused.
- [ ] 21.3 `QUEUES.packageActivation`, `PackageActivationJob` (`{ campaignId, operationId }`), `PACKAGE_ACTIVATION_RETRY` (`retryLimit: 4`) in `src/lib/queue/queues.ts`; the worker registers it with `{ includeMetadata: true }` and alerts Slack only when `isFinalDelivery`. Verify: worker tests for a success, a failure before the last delivery (no alert, rethrow) and on the last (one alert); `queues.test.ts` green.
- [ ] 21.4 Enqueue with `deterministicJobId('package-activation:' + operationId)` from `afterPaid` (`cardcom-settle.ts`) and after the SUMIT route's success; both browser routes call `activatePaidPackage` inline instead of `activateAfterPayment`. Delete `activate-after-payment.ts` and its test once no caller remains. Verify: route tests; `grep -rn activateAfterPayment src` returns nothing; an enqueue failure leaves the payment recorded and is logged.
- [ ] 21.5 Second pass of `runPaymentOrphanSweep`: `approved` campaigns whose ledger shows `collected` for more than 10 minutes are re-sent with the same job id; a job in state `failed` is retried with `boss.retry`; one alert per campaign per day. Verify: unit tests for each branch; a local integration test against pg-boss in local Supabase.
- [ ] 21.6 Remove `ActivateNowForm` and the setup `live` step's button; a paid, not yet active service shows "השירות מופעל" to the owner. Verify: component and page tests; no "הפעלת הקמפיין" string in `src/app/(customer)`.
- [ ] 21.7 `cardcom-webhook-activation.local-it.test.ts`: case A becomes a plain `it` (webhook alone → active, one activation, thank-you set) with the worker job executed against local Supabase; a repeated webhook adds nothing. Verify: 4/4 green through `scripts/integration/run-local.sh`; fingerprint unchanged.
- [ ] 21.8 Part E E2E (`e2e/activation.spec.ts`): the owner pays through the fake CardCom, the page is closed before the browser's settle call, the fake sends the webhook; within a worker tick the service is active; reopening the event lands on the management page; a second webhook changes nothing; staff pause it and a late job does not restart it. Verify: green; coverage map updated.

## 22. Part F — mode and admission (D24; from `separate-event-setup-from-management` 1.x)

- [ ] 22.1 `eventMode(stage, viewer)` replaces `POST_ACTIVATION_STAGES`, and the mode's funded rule reads the settled history (collected the price, not returned below it) whatever is in flight. Verify: unit tests for every `CampaignStage`, `unavailable` on an unreadable ledger, a pending refund and a pending upgrade charge on a paid campaign (still `management`), a reset event (`not_set`).
- [ ] 22.2 `setupBackTarget`: the package step returns `/setup?step=details`. Verify: `setup-steps.test.ts` updated (the pin at lines 180-182 flips).
- [ ] 22.3 Regression tests that each guest-add path (single, bulk, CSV, WhatsApp) calls the reconcile with `add` for a running package, and that `quota_full` leaves the guest added; the WhatsApp import logs a failed admission without personal data (today `whatsapp/actions.ts:178-180` only rethrows). Verify: the new tests pass, including a new `whatsapp/actions.test.ts`.
- [ ] 22.4 Record in design D24 which scheduled messages a late guest receives, from a local integration test of `ensureCurrentStep`. Verify: the test and the sentence agree.
- [ ] 22.5 Worker link repair and top-up in `handleArm` (request-free link repair, then `fillAuthorizedSet(…, 'arm_topup')` before `seedOutreachState`), for campaigns with a quota, independent of the switch. Verify: worker tests: an unlinked guest is linked and admitted on the next tick with the switch off; a campaign without a quota is untouched; a failing step does not stop the tick.
- [ ] 22.6 Migration with `npx supabase migration new reconcile_admit_by_order`: one shared internal admission function (eligibility and smallest-`seq` rank as `fill_authorized_set` defines them); `reconcile_authorized_set` replaced with the same signature and results, keeping the live same-contact `repoint` no-op; `fill_authorized_set` calls the shared function; verification block and manual rollback. Verify: the file contains only these functions, grants and the verification; local apply through the CLI.
- [ ] 22.7 Local integration and pgTAP: order of addition, a freed seat filled by the first waiter, a concurrent add after a removal (two connections), an approached guest's seat kept, a campaign without a quota unchanged. Verify: green through `scripts/integration/run-local.sh` and the pgTAP suite; none skipped.
- [ ] 22.8 For a campaign with a quota, the prune guard (`contacts.ts:222`), the reconcile early return (`contacts.ts:258`), the bulk link (`guests.ts:913`) and the engine's `no_live_guest` skip (`outreach-engine.ts:703`) run whether or not `RECONCILE_AUTHORIZED_SET_ENABLED` is on. Verify: tests with the switch off for a quota and a no-quota campaign; `reconcile.test.ts:189` updated to the quota case.
- [ ] 22.9 Per-guest outreach status on the guests page (the six statuses of the separate change's D9 (d)), computed from one read. Verify: a page test per status; "beyond the quota" only when the list is full.

## 23. Part F — closing during setup (D24; from the separate change 2.x)

- [ ] 23.1 Migration with `npx supabase migration new close_event_retiring_setup`: the function as in D24 (invoker, `search_path ''`, service_role only, owner checked in the body, explicit `succeeded` check, `cancel_campaign` for unpaid campaigns, R7 still guarding, one `event.closed` row with `retiredCampaignId` and `statusBefore`). Verify: the file contains only the function, grants, comment and verification.
- [ ] 23.2 pgTAP and a local integration test: not owned → `not_found`; `pending_approval` → closed and retired with one audit row; declined → closed; pending, review, succeeded real and succeeded test → blocked with nothing changed; `active` → R7 raises; anon and authenticated cannot execute. Verify: green locally.
- [ ] 23.3 `closeEvent` calls the RPC after `requireOwnedEvent`, maps each result to a Hebrew message without "קמפיין", and stops writing its own activity row (`events.ts:552`). Verify: unit tests for every result, a non-owner refused.
- [ ] 23.4 `campaign-status.test.ts` (R7 parity) passes unchanged.

## 24. Part F — routing (D24; from the separate change 3.x)

- [ ] 24.1 Event page: owner in `setup` → `/setup`; `readonly_setup` → read-only card; `management` → the management page (29.1) without `SetupSteps`; `unavailable` → notice, no redirect. Verify: page tests per mode; `permission-separation.test.ts` green.
- [ ] 24.2 `/setup` and the payment page: `management` → event page; `editingDetails` allowed for a confirmed event in setup; closed → event page. Verify: page tests.
- [ ] 24.3 Results, guests and statistics pages: owner in `setup` → `/setup`. Verify: a page test each.
- [ ] 24.4 After payment: the SUMIT route, the CardCom form (`cardcom-open-fields-form.tsx:189, 207, 279`) and the CardCom settle route land on the event page; "מעבר לניהול הקמפיין" removed. Verify: route and form tests.
- [ ] 24.5 An unreadable ledger renders the notice in place on the event page, `/setup` and the payment page. Verify: a test per route with a failing ledger read, asserting no redirect.
- [ ] 24.6 Package change before payment in the setup payment step (an approved, unpaid campaign), next to the `pending_approval` re-choice, through D22's "before any payment" path once Part D exists; until then the step keeps today's behaviour. Verify: page tests with Part D's switch off and on.
- [ ] 24.7 `/app`, login and verify redirect tests pass unchanged.

## 25. Part F — setup shell and customer vocabulary (D24; from the separate change 4.x, 5.x)

- [ ] 25.1 `SetupShell` (header, one stepper, close control with confirmation, one surface) used by `/setup` and the payment page; `setup-steps.tsx` deleted; terms, payment and confirm content flattened. Verify: render tests (exactly one stepper, one close control, no bordered container inside the surface); `package-terms-step.test.tsx` green; `tsc --noEmit` clean.
- [ ] 25.2 Draft the replacement wording (step labels, a customer stage-label map, titles, buttons, notices, owner-facing errors in `campaigns.ts`, `agreements.ts`, `package-purchase-errors.ts`, `events.ts`). Verify: the draft is in the diff for the owner's review.
- [ ] 25.3 The vocabulary scan test over `src/app/(customer)/**/*.tsx` (comments stripped, allowlist with a reason per entry). Lands before any new customer UI of Parts A, B and D. Verify: fails on a planted "קמפיין", passes on the tree after 25.4.
- [ ] 25.4 Replace "קמפיין" in the 16 customer route files and the owner-facing errors. Staff strings stay. Verify: the message tests are updated, not weakened; 25.3 passes.

## 26. Part F — E2E (D27)

- [ ] 26.1 `e2e/setup.spec.ts`: signup → e-mail verification → create event → details → package → terms → pay (fake CardCom) → lands on the management page; no visited customer page contains "קמפיין" (DOM text scan); the step list appears once on every setup screen and never on the management page.
- [ ] 26.2 Return visits: mid-setup sign-in lands on the current step; after payment on the management page; the results, guests and statistics URLs during setup lead to setup; `/setup` after payment leads to the event page.
- [ ] 26.3 Closing: a draft event and an event with a declined payment close from the setup shell; a paid event's close is refused with the support message; an org member cannot close.
- [ ] 26.4 Guests after purchase: single add, CSV import and WhatsApp import within the quota are on the list in order of addition; a guest beyond the quota shows "מעבר למכסת החבילה"; removing an unapproached guest admits the first waiter; the fake WhatsApp receives sends only for listed guests.
- [ ] 26.5 An org member sees the read-only "בהקמה" card and is not redirected.

  Verify for 26.1–26.5: green; fingerprint unchanged; every event-setup and event-closure scenario mapped in `e2e/COVERAGE.md` (the unreadable-ledger scenario maps to 24.5, the concurrency scenario to 22.7).

## 27. Part G — staff campaign page (D25)

- [ ] 27.1 `withCurrentPrice` in `campaigns.ts`, used by `getCampaign` and `getCampaignForAdminView`. Verify: a regression test that the admin reader returns the price; a paid campaign's staff stage reads paid.
- [ ] 27.2 Move the shared components to `src/components/campaign-board/`, the derivations to `src/lib/campaigns/board-state.ts`, and add `readPanel`. A pure move. Verify: `board-state.test.ts` table (status × payment × reached × past), including "a paid approved campaign is not cancellable"; the customer page tests green with re-pointed imports.
- [ ] 27.3 `/admin/campaigns/[campaignId]` page, `staff-actions-panel.tsx` and `actions.ts` (pause, close, cancel, reschedule, thank-you, restart), `getCampaignPaymentsForAdminView` through `auditedCampaignAccess`, and the `staff` actor narrowed to `from: ['paused']` with event guards, gated by `campaigns.runstate`. Verify: `board.test.ts` and `actions.test.ts` per R7 §5.7; `admin-data-layer-coverage.test.ts` with the new reader in `AUDIT_REQUIRED`; the new actions file passes the `ENDPOINT_FILES` scan.
- [ ] 27.4 Point the five staff link sources to the new route; the customer page redirects a staff viewer without event access to it, before any data read, for one release. Verify: `permission-separation.test.ts` asserts the admin href; `review-card.test.tsx` fixture updated; a page test of the redirect.
- [ ] 27.5 Strip every staff branch from the customer page, `manage-client.tsx` and `campaign-actions.ts`; the payments audience comes from the route. Verify: the rewritten `campaign-page.test.ts` (no `@/lib/data/admin/` import, one transitional `hasPlatformPermission`); `campaign-payments-view.test.ts` customer-only.

## 28. Part G — E2E (D27)

- [ ] 28.1 `e2e/staff-campaign.spec.ts`:
  - a billing clerk opens a paid service from `/admin/campaigns`, sees it as paid, and sees no pause, close, cancel or restart;
  - a staff member with both permissions pauses it; the owner's page shows paused; the staff member restarts it;
  - an approved, unpaid service shows no staff start control;
  - a staff member opening the old customer URL lands on the staff page;
  - the owner's page shows no staff control;
  - a staff thank-you change appears on the owner's page.

  Verify: green; fingerprint unchanged; every staff-campaign-page scenario mapped.

## 29. Owner management page (D26)

- [ ] 29.1 The management page layout: summary card slot (13.1), "החבילה שלך" (package name, "X מתוך Y", channels, upgrade entry slot for 17.1), assistant slot (9.6), link to the results page. Verify: page tests for each slot's presence and order, and with each later part's switch off (the slot is empty, nothing breaks).
- [ ] 29.2 E2E (`e2e/management.spec.ts`): after payment the owner sees "החבילה שלך" with the package name and "0 מתוך N"; after adding two guests "2 מתוך N"; the results link opens the results page. Verify: green; coverage map updated.

## 18. Final verification and documentation

- [ ] 18.1 Fresh gates: `npm run lint`, `npx tsc --noEmit`, `NODE_ENV=test npx vitest run`, `npm run build`, all integration suites through `bash -ic 'bash scripts/integration/run-local.sh …'`, the pgTAP suite, and the full E2E suite through `scripts/e2e/run-local.sh`. Verify: all green; the results are recorded with exit codes; each test is classified (static / SQL-RPC / PostgREST / TS integration / Worker / E2E).
- [ ] 18.2 Update documentation that describes timing, permissions and admin surfaces (`docs/project/02-auth-and-authorization.md` and the admin/settings docs touched by this change). Verify: the `update-documentation` checklist is run and every changed behavior is reflected.
- [ ] 18.3 `openspec validate event-timing-assistant-and-ops-board` passes, and every task box above is ticked with its verification recorded.

## 19. Commit, push, deploy (each a separate owner approval)

- [ ] 19.1 Commit per part (E, F, management page, G, A, B, C, D, E2E harness) with explicit `git add <files>`. Before each commit, run `git status --short`, `git diff --stat`, `git diff --name-only` and `git ls-files --others --exclude-standard`, and confirm no unexpected files (`.env*`, `.agents/`, plans, unrelated migrations). Verify: each commit's file list matches its part.
- [ ] 19.2 Before push: read-only production probes (precheck 1.2 again), `get_advisors` comparison, and the approved dry-run report (6.2). Verify: no new advisor findings caused by this change.
- [ ] 19.3 Push to `main` only after explicit owner approval (applies the migrations to production). Verify: migration versions present in production (read-only query), triggers/policies present.
- [ ] 19.4 Deploy app, worker and owner-agent together after explicit approval, and restart each so it runs the new build (the worker kept an older bundle on 22.10). Switches stay off. Verify: services healthy, `timing_v2_enabled`, `assistant_enabled` and `package_upgrade_enabled` false.
- [ ] 19.5 Turn on `timing_v2_enabled`, then `assistant_enabled`, then `package_upgrade_enabled`, each after explicit approval. Verify: the first real proposal is applied and audited; the first assistant answer settles a ledger row ≤ its reserve.

## Workflow follow-up

- Archive this change only on explicit request (`openspec archive event-timing-assistant-and-ops-board`), never automatically.
- `separate-event-setup-from-management` is merged here as Part F. Archive it only on the owner's approval (30.3).

## 30. Final E2E and hand-over

- [ ] 30.1 Run the full E2E suite twice in a row through `scripts/e2e/run-local.sh`; `e2e/coverage-map.test.ts` passes (every scenario of every spec in this change is mapped). Verify: exit codes and the pass counts recorded; fingerprint unchanged; nothing classified E2E outside D27's definition.
- [ ] 30.2 Owner-run pass after deploy, with the real providers: CardCom test terminal purchase with the tab closed before return (the service starts), a real WhatsApp send to the owner's own number, a close during setup on a second event. Verify: the owner confirms each result; read-only production queries show one activation row and the close audit row.
- [ ] 30.3 With the owner's approval, archive `separate-event-setup-from-management` as superseded. Verify: `openspec list` no longer shows it as active.
