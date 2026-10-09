# Tasks

## 1. Domain: the setup/management boundary

- [ ] 1.1 Add `eventMode(stage)` to `src/lib/data/setup-steps.ts` and replace `POST_ACTIVATION_STAGES`. Verify with unit tests covering every `CampaignStage`: `awaiting_activation` is management, and a reset event (only a cancelled campaign) is `setup` at the package step.
- [ ] 1.2 For a package campaign, change `activateCampaign` to set `active` once the ledger shows `collected`, without refusing an empty list. Retire `PACKAGE_NO_CONTACTS_ERROR` and its screens. **Status: implemented in `16413312`** (`requirePackageFunding`, the deleted `PACKAGE_NO_CONTACTS_ERROR` / `PACKAGE_SUPPORT_ERROR`, `activateAfterPayment` answering `started | failed`). **Re-verification still open:** re-run `campaigns.test.ts` and confirm it covers paid with 0 contacts → active, unpaid → refused, ledger unreadable → refused, and that `activateAfterPayment` sends the staff alert on a refusal; confirm no reference to the retired constants or `?activate=no_contacts` remains outside tests. Tick this box only after that re-run.
- [ ] 1.3 Change `setupBackTarget` so the package step returns `/setup?step=details`. Verify with a `setup-steps` test.
- [ ] 1.4 Add a regression test that each guest-add path calls the reconcile with `add` for a running package: single add (`guests-actions.ts`), the bulk insert (`guests.ts`), CSV import and WhatsApp import (a new `whatsapp/actions.test.ts`); and that `quota_full` leaves the guest added. Record in design.md which scheduled messages a late guest receives. Verify that the tests pass.
- [ ] 1.5 Worker link repair and top-up (design D9 b): add a request-free link-repair function (admin client, the pure `deriveContacts`, only guests with a valid phone and a null `contact_id`, never clears a link); in `handleArm` (`worker/main.ts`), for each running campaign with a quota, call it and then `fillAuthorizedSet(event_id, campaign_id, 'arm_topup')` before `seedOutreachState`; log and continue on failure. Verify with worker tests: an unlinked guest is linked and admitted on the next tick with the switch off; a campaign without a quota is untouched; a failing step does not stop the tick.
- [ ] 1.6 Order of addition inside the RPC (design D9 a): create a migration with `npx supabase migration new reconcile_admit_by_order < /dev/null` that adds one shared internal admission function (eligibility and smallest-`seq` rank as `fill_authorized_set` defines them) and replaces `reconcile_authorized_set` (same signature and results): with a quota, `add` and an adding `repoint` admit by `seq` up to the quota and answer `added` only if `p_contact` is on the list; a `delete` that removes a member admits the first waiting contact in the same transaction; audit rows use the existing `reason` values. `fill_authorized_set` calls the shared function. Include the verification block and the manual rollback. Verify that the file contains only these functions, their grants and the verification.
- [ ] 1.7 Dry-run script for 1.6 (one transaction, rolled back) covering: add within quota → `added`; add with an earlier waiter and no room after a removal → the waiter is admitted and the new contact gets `quota_full`; a removal with waiters → the first by `seq` is admitted, with `out`/`delete` and `in`/`delete` audit rows; an exposed member removed → `pinned_kept`, nobody admitted; a campaign without a quota → unchanged behavior; two sessions (a removal and a concurrent add) → the earlier waiter wins. Verify that the owner runs it and every check passes. I do not run it on the live DB.
- [ ] 1.8 Guards not gated by the switch for a package (design D9 c): for a campaign with a quota, the set-member guard in `pruneOrphanContact`, the `no_live_guest` skip in `outreach-engine.ts`, and the `delete` / `repoint` reconcile calls from guest delete and phone change run whether or not `RECONCILE_AUTHORIZED_SET_ENABLED` is on. Verify with `reconcile.test.ts` / `contacts.test.ts` / outreach-engine tests: switch off + package → guard applies and reconcile is called; switch off + pay-per-result → today's behavior.
- [ ] 1.9 WhatsApp import: log a failed admission (`whatsapp/actions.ts`) the way the CSV import does, with no personal data. Verify with the test from 1.4.
- [ ] 1.10 Guests page per-guest outreach status (design D9 d table): no phone, link missing, asked not to be contacted, on the list, beyond the quota, pending admission; no marker without a running package; computed from one read of the event's list and contacts. Verify with a page test per status, and that "beyond the quota" appears only when the list is full.
- [ ] 1.11 DB integration: extend `reconcile.integration.test.ts` and `fill-authorized-set.integration.test.ts` with order of addition, the freed seat, a concurrent add and the shared admission function. Verify that the owner runs both suites with `OUTREACH_DB_IT=1` on the dedicated test DB (never the linked project) and that none is skipped.
- [ ] 1.12 After the owner applies 1.6 (`db push --linked`), run `npm run types:gen` and `types:check`. Verify `types:check` passes.

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

- Commit locally in reviewable steps (domain, DB, routing, shell, vocabulary). Stage explicit paths only.
- Archive the change with `/opsx:archive` after the owner accepts the runtime pass.
