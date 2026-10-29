# Tasks

## 1. Domain: the setup/management boundary

- [x] 1.1 Add `eventMode(snapshot)` to the event lifecycle model (`src/lib/data/event-lifecycle.ts`, D1/D7a, owner 2026-10-28): `mode.*` tags on its states, `setup | management | unavailable`, `unavailable` never folded into the other two. `POST_ACTIVATION_STAGES` is replaced in the routes by 3.1 and 3.2. Verify with unit tests covering every service state × event status: paid but not running (`awaiting_activation`) is management, a reset event (no live campaign) is setup, a closed event is management, an unreadable ledger and money that moved are unavailable; and a model test that every configuration carries exactly one mode tag.
  - Done: `event-lifecycle.test.ts` and `event-lifecycle.model.test.ts`, 297 passing; mapping `unavailable` to setup fails 4 of them.
- [x] 1.2 For a package campaign, change `activateCampaign` to set `active` once the ledger shows `collected`, without refusing an empty list. Retire `PACKAGE_NO_CONTACTS_ERROR` and its screens. **Status: implemented in `16413312`** (`requirePackageFunding`, the deleted `PACKAGE_NO_CONTACTS_ERROR` / `PACKAGE_SUPPORT_ERROR`, `activateAfterPayment` answering `started | failed`). **Re-verification still open:** re-run `campaigns.test.ts` and confirm it covers paid with 0 contacts → active, unpaid → refused, ledger unreadable → refused, and that `activateAfterPayment` sends the staff alert on a refusal; confirm no reference to the retired constants or `?activate=no_contacts` remains outside tests. Tick this box only after that re-run.
  - Re-verified 29.10.2026: `campaigns.test.ts` and `package-activation-job.test.ts`, 95 passing at that moment (`campaigns.test.ts` later lost 7 tests when 3.4 deleted `getCampaignStageForEvent`). Since D23 the first start is `activateCampaignAfterPayment` (system actor) and `activateCampaign` is staff revival only. Both run `requirePackageFunding`. Covered: paid with no guests → active on both paths. The first start has a new test, `starts a paid campaign without reading or filling the guest list`: it touches only `campaigns`, `events` and `payment_operations`. Adding a `guests` read to `requirePackageFunding` fails it. The revival path is covered by `activates a paid campaign that has no guests yet`. Every unpaid ledger state → refused, an unreadable ledger → `PACKAGE_PAYMENT_UNVERIFIED_ERROR`, and the system path refuses a ledger that is not `collected`. `activateAfterPayment` is now `startPaidPackageNow` (inline, `started | failed`, never throws) plus the pg-boss job. The job alerts staff once, on the final delivery (`runPackageActivationJob`: "a refusal on the final delivery alerts once"). A grep for `PACKAGE_NO_CONTACTS_ERROR`, `PACKAGE_SUPPORT_ERROR` and `no_contacts` over `src`, `worker` and `scripts` finds nothing.
- [x] 1.3 Change `setupBackTarget` so the package step returns `/setup?step=details`. Verify with a `setup-steps` test.
  - Done with 2.7 (`setup-steps.test.ts`, `setup/page.test.tsx`).
- Tasks 1.4 to 1.12 (the outreach-list admission safety nets, design D9) moved on 29.10.2026, on the owner's instruction, to the change `package-outreach-admission-safety` (its tasks 1.1 to 5.1; content unchanged, only the layout and the task and design numbers). None was done when it moved.

## 2. Database: close that retires unpaid setup

- [x] 2.1 Create the migration with `npx supabase migration new close_event_retiring_setup < /dev/null`. Write `close_event_retiring_setup(p_event, p_actor)` per design D7: header, invoker, `search_path ''`, `service_role`-only grant, verification block, rollback section. Verify the file contains no statement beyond the `events.close` permission rows (owner decision 2026-10-27, D7), the function, grants, comment and verification.
  - Done: `20261027211431_close_event_retiring_setup.sql`, applied by the owner; live check 2026-10-28: `close_event_retiring_setup(p_event, p_actor)`, `events.close` protected, held by the owner role of all 4 organizations.
- [x] 2.2 Write the dry-run script (run inside one transaction and rolled back). It covers:
  - an unknown event → `not_found` (who may close is the application gate, D7);
  - `pending_approval` → closed and retired with an audit row;
  - declined → closed;
  - pending, review, succeeded real, succeeded test → blocked, nothing changed;
  - `active` → `blocked_paid`, nothing changed (R7 stays the backstop);
  - a bound benefit → released, the locked pricing round unchanged;
  - anon and authenticated cannot execute;
  - `events.close` is protected and cannot be granted to another role.

  Verify that the owner runs it and every check passes. I do not run it on the live DB.
  - Ran once on the live database on 2026-10-28 as migration `20261028003523`, and every check passed. Evidence: the push succeeded (a failed check aborts it), 2 staff accounts existed (so the run was not skipped), and no fixture row remained. The migration made no schema change. The owner then marked it reverted (`migration repair --status reverted`) and removed the file, because Supabase documents database tests as pgTAP files, not migrations.
  - The lasting check is `supabase/tests/database/close_event_retiring_setup_test.sql` (pgTAP, `plan(33)`), run locally with `npx supabase test db --local`. Passed locally 2026-10-28, 33/33, the delegation check included: it creates its own fixture organization, since a local database has none. With `org_role_permissions_protect_system` disabled, check 33 fails, so the test catches a removed trigger rather than any error.
- [x] 2.3 After the owner applies the migration (`db push --linked`), run `npm run types:gen` and `types:check`. Verify `types:check` passes and the function appears in `types.generated.ts`.
  - Done: types regenerated by the owner; `npm run typecheck` passes (2026-10-28).
- [x] 2.4 Switch `closeEvent` (`src/lib/data/events.ts`) to the RPC after `requireEventAccess(eventId, 'events', 'close')`, and map the results to safe Hebrew messages without "קמפיין". Remove its duplicate activity write. Verify with `closeEvent` unit tests for all five results, including that a user without `events.close` is refused.
  - Done: `events.test.ts` covers closed, already_closed, blocked_paid, blocked_money, not_found, an unknown answer and an RPC error, and a refusal before any RPC call.
- [x] 2.5 Verify that `campaign-status.test.ts` (R7 parity) passes unchanged.
- [x] 2.6 The event lifecycle model (D7a): `src/lib/data/event-lifecycle.ts`. Verify with `event-lifecycle.test.ts` (every campaign status × ledger combination against the migration) and `event-lifecycle.model.test.ts` (xstate/graph paths from every resolvable configuration).
- [x] 2.7 The close control (D5) for draft and active events on the event page and in `/setup`, rendered for `events.close`, offered by the model; the cancellation request form only when the service is paid or running, or to show an existing request; the package step's back to `/setup?step=details`; the details form for a confirmed event in setup, with its locks; after a close, the event page. Verify with `setup/page.test.tsx`, `setup-steps.test.ts` and `campaign-actions.test.ts`. The event page has no test file yet: covered by 3.1.

## 3. Routing

- [x] 3.1 Event page (`events/[id]/page.tsx`):
  - `setup`: the owner → redirect to `/setup`; another viewer → read-only card;
  - `management` → today's page without `SetupSteps`;
  - `unavailable` → rendered in place, no redirect;

  Verify with page tests per mode, and run `permission-separation.test.ts`.
  - Done 2026-10-28: the mode comes from `eventMode(resolveEventLifecycle(...))` before any other read; the owner is decided by `isEventOwner` (routing only). New `page.test.tsx`, 16 tests: every setup case redirects the owner, a non-owner gets the read-only card, management shows the service card and the details form, and an unreadable ledger, money that moved and invisible campaigns render in place. Making `unavailable` redirect fails 3 of them. `permission-separation.test.ts` passes.
- [x] 3.2 `/setup`: `management` → redirect to the event page, and allow `editingDetails` for a confirmed event in setup. Verify with page tests: paid → event page, closed → event page, confirmed and unpaid → details form reachable.
  - Done 2026-10-28: `/setup` computes `eventMode(resolveEventLifecycle(...))` right after the campaign read (the same reads as the event page; the close control uses the same snapshot) and redirects `management` to the event page. `POST_ACTIVATION_STAGES` (and its campaign-page redirect) and the `live` "service starting" branch are deleted. `setup/page.test.tsx`: paid (real and test money), scheduled, running, paused, finished, running with an unreadable ledger, and a closed event → the event page; setup states stay; confirmed and unpaid → `?step=details` shows the form. Removing the redirect, or pointing it at the campaign page, fails 7. Measured on the dev server with the local DB: paid-not-running, scheduled and active now land on the event page (before: stayed, stayed, campaign page), and the event page does not redirect back.
- [x] 3.3 Package payment page: in `setup` mode render inside `SetupShell`. Verify with payment page tests: shell present, paid → event page.
  - Done 29.10.2026 (after 4.1, which it needs).
    - **Mode.** The page computes the mode from the same lifecycle model, using the URL campaign and the page's own single ledger read. That campaign is the event's live one: at most one campaign per event is not cancelled, and a cancelled one reads as `finished`. `management` (paid in real or test money, running, paused, a closed event, a cancelled campaign) redirects to the event page. `unavailable` (an unreadable ledger, money that moved) stays and shows its screen.
    - **Shell.** In setup the page renders inside `SetupShell`, with the steps (the payment current), no back (`setupBackTarget` gives none for pay), and the close for a viewer holding `events.close`, offered by the model. `getEvent` supplies the fields the steps read; `requireOwnedEvent` remains the gate.
  - Tests: `payment/page.test.tsx` passes 30.
    - New: the shell is present once, above the payment; the close is allowed, blocked by money in flight, or absent without the permission; paid, test money, running and paused all go to the event page; a closed event and a cancelled campaign go to the event page; money that moved does not redirect.
    - The three tests that expected the paid screen now expect the redirect.
    - Measured 29.10.2026 on the dev server against the local DB:
      - in setup (pending CardCom payment): the setup title, one step list (`ol` count 1), the payment details, the card form and the close;
      - paid-not-running and running: a meta refresh to the event page.
    - Removing the redirect fails 6 tests.
  - For the owner: `PackagePaymentView`'s `paid` case (the success screen, its `activation` notes and the test-money note) can no longer be reached from the page. A collected ledger is always management. The component and its own tests are kept: the task does not say to delete them, and that decision is the owner's.
- [x] 3.6 Campaign results page: for an owner in `setup` mode, redirect to `/setup`. Verify with a page test that it is unreachable by URL before payment.
  - Done 29.10.2026. The owner path calls `redirectOwnerInSetup(event)` after `requireEventAccess(…, 'campaigns', 'view')` and before the campaign read. The mode is the event's (its live campaign), not the campaign in the URL. The `manage_billing` branch never asks, so staff open a customer's campaign at any stage.
  - New `page.test.tsx` (3 tests): an owner in setup is redirected with no campaign read, the order is gate → mode → campaign, and staff are not asked. Removing the call fails 2 of them. `admin-view.test.ts` passes unchanged.
  - Measured 29.10.2026 on the dev server against the local DB.
    - **As staff (the test user holds a `platform_staff` row):** in setup the page renders, as designed.
    - **As the same owner with the staff row removed:** in setup there is a meta refresh to `/setup`; while running, the page renders.
    - The staff row was then restored, identical to the original.
- [x] 3.7 Landing after payment: change the purchase route and `cardcom-open-fields-form.tsx` to redirect to the event page, and remove "מעבר לניהול הקמפיין" from the success screen. Verify with the purchase route tests and the form test.
  - Done 29.10.2026.
    - The purchase route (`paid`, `already_paid`, and `paid` whose inline start failed) and the CardCom form (in-page and on a return) redirect to `/app/events/[id]` with no query. Error paths stay on the payment page.
    - `?paid=1&activate=failed` is gone: no page read it. Whether the service started is shown by the event page from the server.
    - The success screen keeps "הוספת מוזמנים" only. The stale comment about a "start now" button is corrected.
  - Tests:
    - `route.test.ts` (31): the outcome table now checks the path, and the landing has an empty query.
    - `cardcom-open-fields-form.test.tsx` (81).
    - `package-payment-view.test.tsx`: no link to the service's own page.
    - The payment folder: 133 passing in total.
  - Open, owned by 5.1/5.2: after a failed inline start, the event page shows the stage `awaiting_activation` as "ממתין להפעלה". That conflicts with "the customer never sees activation" (D4) and is fixed by the customer stage-label map (D8).
- [x] 3.8 Unreadable ledger: the event page, `/setup` and the payment page treat `packagePaymentOf` returning `null` the same way, by showing a notice in place with no redirect. Verify with a test where the ledger read fails on each route, and assert that no redirect happens.
  - Done 2026-10-28: `/setup` in `unavailable` shows the notice in place of the step (also for a past event and on `?step=details`, where the details form stays under it), with no payment link and no redirect; the wording comes from `unavailableNoticeOf` in `event-lifecycle.ts`, shared with the event page. No-redirect asserted on all three routes: the event page (existing), `/setup` (new) and the payment page (new). Measured with SELECT on `payment_operations` revoked locally: `/setup` shows the notice and no "המשך לתשלום החבילה" (before: the payment link). The comment in `package-paid.ts` that called `null` "not funded" is corrected.
- [x] 3.4 Guests and statistics pages: redirect an owner in `setup` mode to `/setup`. Verify with a page test for each.
  - Done 29.10.2026. A new `src/lib/data/event-mode.ts` (`server-only`) holds two functions:
    - `readEventMode` probes `campaigns.view` with the fail-closed `canAccessEvent` before `getCampaignForEvent`, so a viewer with `guests.view` or `reports.view` but without `campaigns.view` reads `unavailable` instead of a 404. It then reads the ledger and the lifecycle model.
    - `redirectOwnerInSetup` redirects only an owner (`isEventOwner`) in `setup`. It runs after each page's own gate and before any list or statistics read.
  - The guests page takes its first-run stage badge from the same read. `getCampaignStageForEvent` therefore had no caller left and is deleted with its tests; its visibility rule is now covered by `event-mode.test.ts`.
  - Tests: `event-mode.test.ts` (19, against the real model) covers every mode case, the owner, a non-owner, `unavailable`, paid, and no ownership read outside `setup`. `guests/page.test.tsx` (5) and `stats/page.test.tsx` (2) are new; removing the gate call fails all 7. `campaigns.test.ts` 83 passing.
  - Not gated: the sub-pages `guests/new`, `guests/import` and `guests/[guestId]`. The only links to them are on the guests page and the results page, both gated, so they are reachable only by a typed URL. The add actions themselves do not check the mode. That is the owner's decision.
  - Measured 29.10.2026 on the dev server against the local DB, signed in as the local test owner:
    - an event in setup (approved, payment pending): the guests and statistics pages answer 200 with a meta refresh to `/setup`, the streamed redirect, since `guests/` has a `loading.tsx`;
    - paid-not-running and running: both pages render with no redirect.
- [x] 3.5 Verify that the `/app` routing test, and the login and verify redirect tests, still pass unchanged (no code change expected).
  - Done 29.10.2026: `app/page.test.ts`, `auth/actions.test.ts`, `auth/confirm/actions.test.ts` and `auth/confirm/page.test.ts` pass, 47 tests. Neither those files nor their routes changed.

## 4. Setup shell and flat content

- [x] 4.1 Create `SetupShell` (header, one stepper, close control with confirmation, one content surface) and use it in `/setup` and the payment page. Verify with a render test: exactly one stepper and one close control.
  - Done 29.10.2026: `events/[id]/setup-shell.tsx`, a server component. It has the header (title, "חזרה לאירוע", the event's name), the stepper in its own frame, one content surface around the step, and `EventStatusActions` (with its confirmation) when the page passes a close.
    - `/setup` and the payment page render inside it. The `/setup` branches (unavailable, past event, the steps) lost their own frames.
    - `setup-shell.test.tsx` (4): one stepper, one close control, none without the permission, the content inside the one surface after the stepper, one `h1`.
    - `setup/page.test.tsx` passes 41, including a new check that the page renders one stepper, one close control and two frames.
    - The header link "חזרה לאירוע" is kept as it was. For the owner it leads to the event page, which sends them back to `/setup`.
- [x] 4.2 Delete `setup-steps.tsx` (the event-page card) and its usages. Verify that `tsc --noEmit` passes and no import remains.
- [x] 4.3 Flatten `PackageTermsStep`, the package payment view panels and the confirm step into sections inside the surface. Verify with component tests asserting no bordered container nested inside the step surface, and keep `package-terms-step.test.tsx` green.
  - Done 29.10.2026. Each of these blocks became a `<section>` with an `h3` and a top divider (`border-t`), with no frame of its own:
    - "עיקרי התנאים";
    - the approval boxes (the fieldset);
    - "פרטי התשלום" and "פרטי כרטיס אשראי".

    The confirm step had no frame; only its warning notice has one, and that is a notice, not a panel.
  - The check is a new helper, `src/test/framed-panels.ts`. It flags a section, div, fieldset, form or list with a full border and rounded corners; a notice `p` and a divider do not count. It is used in:
    - `package-terms-step.test.tsx`;
    - `approve-package-terms-form.test.tsx`;
    - `package-payment-view.test.tsx` (both providers);
    - `setup-confirm-form.test.tsx`.
  - 43 tests pass. Putting back the original frames fails 4 of them.
  - The `paid` success screen (a green frame) was left as it is. It can no longer be reached from the page (see 3.3).
- [ ] 4.4 Follow the `building-rtl-ui` skill for RTL, focus and mobile width. Verify with eslint and `tsc --noEmit` on touched files.
  - Done 29.10.2026: eslint on the 29 touched `src` files exited 0, and `npx tsc --noEmit` on the project exited 0.
  - Code review against the skill:
    - no physical-direction classes in the shell or the flattened steps (`ml-`/`mr-`/`pl-`/`pr-`/`left`/`right`);
    - links and controls keep the global focus outline (`outline-ring/50` in `globals.css`);
    - the shell keeps `/setup`'s `max-w-2xl` column, and its header row wraps through `gap-4`;
    - no new UI primitive.
  - Still open, and so not ticked: a visual check in the browser at phone width, in both themes, which the skill requires. The local session cookie in the browser helper has expired.

## 5. Customer vocabulary

- [x] 5.1 Draft the replacement wording with `hebrew-content-writer`: step labels, a customer stage-label map, `metadata` titles, buttons and notices. Verify that the draft is listed in the diff for the owner's review.
  - Done 29.10.2026: `vocabulary-draft.md` in this change. It is new in the diff and covers every non-comment occurrence in `src/app/(customer)/**`, the shared label maps and the server errors that reach the owner, as current text → proposed text with file and line. It also proposes a customer stage map in which `awaiting_activation` reads "השירות מופעל". That is a proposal for the open item from 3.7; the item stays open until 5.2 applies it. Section 5 lists the staff-only strings that stay, for 5.3's allowlist. Task 5.2 waits for the owner's review of this draft.
- [ ] 5.2 Replace "קמפיין" in the customer route files (17 today, some in comments only) and in owner-facing error strings in `campaigns.ts`, `agreements.ts` and the activation path. Staff strings stay. Verify that the existing tests for those messages are updated, not weakened.
- [ ] 5.3 Add the vocabulary scan test over `src/app/(customer)/**/*.tsx` (comments stripped, allowlist with a reason per entry). Verify that it fails on a planted "קמפיין" and passes on the tree.

## 6. Integration verification

- [ ] 6.1 Run focused vitest for every touched module, plus `npx tsc --noEmit`, `npm run lint` and `openspec validate separate-event-setup-from-management`. Verify that all pass.
- [ ] 6.2 Run `npm run build` and the full vitest suite only when the owner says so. Verify that both pass, and fix any red test whatever its cause.
- [ ] 6.3 Owner runtime pass after deploy:
  - new signup → email verify → create event → every setup step → test payment → management page;
  - on a second event, close during setup;
  - close the legacy event with `3e531968`.

  Verify that each lands on the expected screen with no "קמפיין" text.
- [ ] 6.4 Release gate: this change is not release-ready until `package-outreach-admission-safety` is implemented and verified, because the guests-page gate (3.4) leaves the guest-add call as the only path onto the outreach list. Three tasks make that path the only one together: 3.1 (`ffbfcb5e`, already on `origin/main`) sends the owner in setup away from the event page, which held the "ניהול מוזמנים" link; 3.6 gates the results page, which links to `guests/new` and `guests/import`; and 3.4 closes the guests URL itself. Measured read-only on 29.10.2026, 3.1 is not live yet: production (`kalfa-beta` under PM2) runs the build from `.next/BUILD_ID` of 28.10.2026 02:06, and `ffbfcb5e` was committed at 04:48 the same day. The next deploy of `main` would ship 3.1 even without 3.4. Verify that `openspec status --change package-outreach-admission-safety` shows every task done and that its verification (its tasks 6.1 and 6.2) passed.

## Workflow follow-up

- Commit locally in reviewable steps (domain, DB, routing, shell, vocabulary). Stage explicit paths only.
- Archive the change with `/opsx:archive` after the owner accepts the runtime pass.
