# Tasks

Extracted from `separate-event-setup-from-management` tasks 1.4 to 1.12, on the owner's instruction, 29.10.2026. Each task keeps its original content; only its layout and its task and design numbers changed, and "(was 1.x)" names its number there. Design references point to this change's D1 to D4, which were that change's D9 (a) to (d). None of these tasks was done when it was moved. The project's Definition of Done (CLAUDE.md) applies to every task.

## 1. Guest-add paths and visible failures

- [ ] 1.1 (was 1.4) Add a regression test that each guest-add path calls the reconcile with `add` for a running package:
  - single add (`guests-actions.ts`);
  - the bulk insert (`guests.ts`);
  - CSV import;
  - WhatsApp import (a new `whatsapp/actions.test.ts`).

  Also test that `quota_full` leaves the guest added. Record in design.md which scheduled messages a late guest receives. Verify that the tests pass.
- [ ] 1.2 (was 1.9) WhatsApp import: log a failed admission (`whatsapp/actions.ts`) the way the CSV import does, with no personal data. Verify with the test from 1.1.

## 2. Guards independent of the switch

- [ ] 2.1 (was 1.8) Guards not gated by the switch for a package (design D3). For a campaign with a quota, these run whether or not `RECONCILE_AUTHORIZED_SET_ENABLED` is on:
  - the set-member guard in `pruneOrphanContact`;
  - the `no_live_guest` skip in `outreach-engine.ts`;
  - the `delete` / `repoint` reconcile calls from guest delete and phone change.

  Verify with `reconcile.test.ts` / `contacts.test.ts` / outreach-engine tests:
  - switch off + package → the guard applies and the reconcile is called;
  - switch off + pay-per-result → today's behavior.

## 3. Worker link repair and top-up

- [ ] 3.1 (was 1.5) Worker link repair and top-up (design D2):
  - Add a request-free link-repair function: admin client, the pure `deriveContacts`, only guests with a valid phone and a null `contact_id`, and it never clears a link.
  - In `handleArm` (`worker/main.ts`), for each running campaign with a quota, call it and then `fillAuthorizedSet(event_id, campaign_id, 'arm_topup')` before `seedOutreachState`.
  - Log and continue on failure.

  Verify with worker tests:
  - an unlinked guest is linked and admitted on the next tick with the switch off;
  - a campaign without a quota is untouched;
  - a failing step does not stop the tick.

## 4. Order of addition inside the RPC

- [ ] 4.1 (was 1.6) Order of addition inside the RPC (design D1). Create a migration with `npx supabase migration new reconcile_admit_by_order < /dev/null` that:
  - adds one shared internal admission function, with eligibility and smallest-`seq` rank as `fill_authorized_set` defines them;
  - replaces `reconcile_authorized_set`, with the same signature and results:
    - with a quota, `add` and an adding `repoint` admit by `seq` up to the quota, and answer `added` only if `p_contact` is on the list;
    - a `delete` that removes a member admits the first waiting contact in the same transaction;
    - audit rows use the existing `reason` values;
  - makes `fill_authorized_set` call the shared function.

  Include the verification block and the manual rollback. Verify that the file contains only these functions, their grants and the verification.
- [ ] 4.2 (was 1.7) Dry-run script for 4.1 (one transaction, rolled back) covering:
  - add within quota → `added`;
  - add with an earlier waiter and no room after a removal → the waiter is admitted and the new contact gets `quota_full`;
  - a removal with waiters → the first by `seq` is admitted, with `out`/`delete` and `in`/`delete` audit rows;
  - an exposed member removed → `pinned_kept`, nobody admitted;
  - a campaign without a quota → unchanged behavior;
  - two sessions (a removal and a concurrent add) → the earlier waiter wins.

  Verify that the owner runs it and every check passes. I do not run it on the live DB.
- [ ] 4.3 (was 1.11) DB integration: extend `reconcile.integration.test.ts` and `fill-authorized-set.integration.test.ts` with order of addition, the freed seat, a concurrent add and the shared admission function. Verify that the owner runs both suites with `OUTREACH_DB_IT=1` on the dedicated test DB (never the linked project) and that none is skipped.
- [ ] 4.4 (was 1.12) After the owner applies 4.1 (`db push --linked`), run `npm run types:gen` and `types:check`. Verify `types:check` passes.

## 5. Per-guest outreach status

- [ ] 5.1 (was 1.10) Guests page per-guest outreach status (the design D4 table):
  - no phone;
  - link missing;
  - asked not to be contacted;
  - on the list;
  - beyond the quota;
  - pending admission.

  No marker without a running package. Computed from one read of the event's list and contacts. Verify with a page test per status, and that "beyond the quota" appears only when the list is full.

## 6. Integration verification

These are the source change's 6.1 and 6.2, scoped to this change.

- [ ] 6.1 Run focused vitest for every touched module, plus `npx tsc --noEmit`, `npm run lint` and `openspec validate package-outreach-admission-safety`. Verify that all pass.
- [ ] 6.2 Run `npm run build` and the full vitest suite only when the owner says so. Verify that both pass, and fix any red test whatever its cause.

## Workflow follow-up

- Commit locally in reviewable steps (guards and add paths, worker, migration, guests page). Stage explicit paths only.
- `separate-event-setup-from-management` is not release-ready until this change is implemented and verified. Its task 6.4 tracks that gate.
- Archive this change with `/opsx:archive` after the owner accepts it.
