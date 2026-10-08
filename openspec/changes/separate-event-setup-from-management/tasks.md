# Tasks

## 1. Domain: the setup/management boundary

- [ ] 1.1 Add `eventMode(stage)` to `src/lib/data/setup-steps.ts` and replace `POST_ACTIVATION_STAGES`. Verify with unit tests covering every `CampaignStage`: `awaiting_activation` is management, and a reset event (only a cancelled campaign) is `setup` at the package step.
- [ ] 1.2 For a package campaign, change `activateCampaign` to set `active` once the ledger shows `collected`, without refusing an empty list. Retire `PACKAGE_NO_CONTACTS_ERROR` and its screens. Verify with campaigns tests: paid with 0 contacts → active; unpaid → refused; ledger unreadable → refused with staff alert.
- [ ] 1.4 Add a regression test that each guest-add path (single, CSV, WhatsApp import) calls the reconcile with `add` for a running package, and that `quota_full` leaves the guest added. Record in design.md which scheduled messages a late guest receives. Verify that the tests pass.
- [ ] 1.3 Change `setupBackTarget` so the package step returns `/setup?step=details`. Verify with a `setup-steps` test.

## 2. Database: close that retires unpaid setup

- [ ] 2.1 Create the migration with `npx supabase migration new close_event_retiring_setup < /dev/null`. Write `close_event_retiring_setup(p_event, p_owner)` per design D7: header, invoker, `search_path ''`, `service_role`-only grant, verification block, rollback section. Verify the file contains no statement beyond the function, grants, comment and verification.
- [ ] 2.2 Write the dry-run script (run inside one transaction and rolled back). It covers:
  - not owned → `not_found`;
  - `pending_approval` → closed and retired with an audit row;
  - declined → closed;
  - pending, review, succeeded real, succeeded test → blocked, nothing changed;
  - `active` → R7 raises;
  - anon and authenticated cannot execute.

  Verify that the owner runs it and every check passes. I do not run it on the live DB.
- [ ] 2.3 After the owner applies the migration (`db push --linked`), run `npm run types:gen` and `types:check`. Verify `types:check` passes and the function appears in `types.generated.ts`.
- [ ] 2.4 Switch `closeEvent` (`src/lib/data/events.ts`) to the RPC after `requireOwnedEvent`, and map the results to safe Hebrew messages without "קמפיין". Remove its duplicate activity write. Verify with `closeEvent` unit tests for all five results, including that a non-owner is refused.
- [ ] 2.5 Verify that `campaign-status.test.ts` (R7 parity) passes unchanged.

## 3. Routing

- [ ] 3.1 Event page (`events/[id]/page.tsx`):
  - owner in `setup` → redirect to `/setup`;
  - `readonly_setup` → read-only card;
  - `management` → today's page without `SetupSteps`;

  Verify with page tests per mode, and run `permission-separation.test.ts`.
- [ ] 3.2 `/setup`: `management` → redirect to the event page, and allow `editingDetails` for a confirmed event in setup. Verify with page tests: paid → event page, closed → event page, confirmed and unpaid → details form reachable.
- [ ] 3.3 Package payment page: in `setup` mode render inside `SetupShell`. Verify with payment page tests: shell present, paid → event page.
- [ ] 3.6 Campaign results page: for an owner in `setup` mode, redirect to `/setup`. Verify with a page test that it is unreachable by URL before payment.
- [ ] 3.7 Landing after payment: change the purchase route and `cardcom-open-fields-form.tsx` to redirect to the event page, and remove "מעבר לניהול הקמפיין" from the success screen. Verify with the purchase route tests and the form test.
- [ ] 3.8 Unreadable ledger: the event page, `/setup` and the payment page treat `packagePaymentOf` returning `null` the same way, by showing a notice in place with no redirect. Verify with a test where the ledger read fails on each route, and assert that no redirect happens.
- [ ] 3.4 Guests and statistics pages: redirect an owner in `setup` mode to `/setup`. Verify with a page test for each.
- [ ] 3.5 Verify that the `/app` routing test, and the login and verify redirect tests, still pass unchanged (no code change expected).

## 4. Setup shell and flat content

- [ ] 4.1 Create `SetupShell` (header, one stepper, close control with confirmation, one content surface) and use it in `/setup` and the payment page. Verify with a render test: exactly one stepper and one close control.
- [ ] 4.2 Delete `setup-steps.tsx` (the event-page card) and its usages. Verify that `tsc --noEmit` passes and no import remains.
- [ ] 4.3 Flatten `PackageTermsStep`, the package payment view panels and the confirm step into sections inside the surface. Verify with component tests asserting no bordered container nested inside the step surface, and keep `package-terms-step.test.tsx` green.
- [ ] 4.4 Follow the `building-rtl-ui` skill for RTL, focus and mobile width. Verify with eslint and `tsc --noEmit` on touched files.

## 5. Customer vocabulary

- [ ] 5.1 Draft the replacement wording with `hebrew-content-writer`: step labels, a customer stage-label map, `metadata` titles, buttons and notices. Verify that the draft is listed in the diff for the owner's review.
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

## Workflow follow-up

- Commit locally in reviewable steps (domain, DB, routing, shell, vocabulary). Stage explicit paths only. Keep the unrelated `package-choice-form` change out of these commits.
- Archive the change with `/opsx:archive` after the owner accepts the runtime pass.
