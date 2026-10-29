# Proposal

## Why

For a fixed-price package, a guest reaches the outreach list only when the guest is added. Commit `16413312` removed the activation-time fill that used to back this up. After the change `separate-event-setup-from-management` puts guests after payment (its design D4), the guest-add call becomes the only way onto the list.

That call depends on a kill switch (`RECONCILE_AUTHORIZED_SET_ENABLED`) and swallows its own failures. A seat freed by a removal can be taken out of order, and the owner cannot see per guest who is beyond the quota.

This change was extracted, on the owner's instruction (29.10.2026), from `separate-event-setup-from-management`: its tasks 1.4 to 1.12, its design D9, and its admission requirements. The admission work then has its own scope, migration and verification.

## What Changes

The guest-add calls stay the primary path. This change adds the safety nets that replace the removed activation-time fill, for campaigns with a `contact_quota`. A campaign without one keeps today's behavior.

- **Order of addition is kept atomically (migration).** A new migration replaces `reconcile_authorized_set`, with the same signature and results, and adds one shared internal admission function that `fill_authorized_set` uses as well.
  - An add, an adding repoint and a removal that frees a seat admit the first waiting guest by order of addition.
  - This happens inside the same transaction, under the campaign row lock, so it holds even against a concurrent add.
  - The audit vocabulary is unchanged.
- **A missed admission is repaired.** On each arm tick, the worker:
  - re-links guests whose contact link failed;
  - tops up every running package list.

  Neither step depends on `RECONCILE_AUTHORIZED_SET_ENABLED`.
- **The guards do not depend on the switch for a package.** These run whether or not the switch is on:
  - the set-member guard in `pruneOrphanContact`;
  - the `no_live_guest` skip in the outreach engine;
  - the `delete` and `repoint` reconcile calls from guest delete and phone change.

  So a deleted guest's contact never leaves the list silently through a cascade, and never receives outreach.
- **Visible failures.** The WhatsApp import logs a failed admission, as the CSV import does, with no personal data.
- **Per-guest outreach status.** For a running package, the guests page shows each guest's outreach status. It tells "beyond the quota" apart from:
  - a missing phone;
  - a missing contact link;
  - a request not to be contacted;
  - a pending admission.
- **Tests and verification:**
  - add-path regression tests;
  - worker tests;
  - a dry-run script for the migration;
  - the DB integration suites, extended and run by the owner on the dedicated test database.

## Capabilities

### New Capabilities
- `package-outreach-admission`: how the guests of an event with a running package reach its outreach list. It covers:
  - admission when a guest is added;
  - the quota enforced at that point;
  - the order of addition;
  - recovery from a missed admission;
  - the per-guest outreach status the owner sees.

  Its requirements move here unchanged from the `event-setup` delta of `separate-event-setup-from-management`.

### Modified Capabilities
None. `openspec/specs/` has no existing capabilities. The `event-setup` delta that held these requirements is an unarchived change, and it is updated in that change, not modified here.

## Dependency

`separate-event-setup-from-management` must not be considered release-ready until this change is implemented and verified. Its routing gates the guests page during setup (its task 3.4), which leaves the guest-add call as the only path onto the outreach list. The nets in this change are what make that safe.

That change records the gate in its own tasks.

## Non-goals

- **Removing `RECONCILE_AUTHORIZED_SET_ENABLED`.** The switch stays for the pay-per-result paths. Whether it should stop gating admission at add time for package campaigns too is the owner's open decision.
- **Changing which scheduled messages a late guest receives.** Task 1.1 records the existing behavior. Changing it is a separate decision.
- **The pay-per-result branch of `reconcile_authorized_set`.** It is unchanged.
- **Setup routing, the setup shell, the purchase-starts-service rule (D4) and customer vocabulary.** These stay in `separate-event-setup-from-management`.

## Impact

- **Database:** one migration.
  - It replaces `reconcile_authorized_set` and adds a shared internal admission function used by it and by `fill_authorized_set`.
  - Signature, results, grants and the audit `reason` vocabulary stay the same.
  - The owner applies it (`db push --linked`). `types.generated.ts` is then regenerated through the normal command.
- **Domain:**
  - `src/lib/data/contacts.ts`: `reconcileCampaignSetForContact` and `pruneOrphanContact` are not switch-gated for a package, and a new request-free link repair is added.
  - `src/lib/data/outreach-engine.ts`: the `no_live_guest` skip is not switch-gated for a package.
  - `src/lib/data/guests.ts`: the delete and phone-change reconcile calls.
  - `src/lib/data/authorized-fill.ts`: `fillAuthorizedSet`, used by the top-up.
- **Worker:** `worker/main.ts` (`handleArm`) runs the link repair and the top-up before `seedOutreachState`.
- **Customer routes:**
  - `guests/import/whatsapp/actions.ts`: logs a failed admission.
  - `guests/page.tsx`: the per-guest outreach status.
- **Tests:**
  - guest-add admission tests for the single add, bulk insert, CSV import and WhatsApp import (a new `whatsapp/actions.test.ts`);
  - worker link-repair and top-up tests;
  - switch-off guard tests in `reconcile.test.ts`, `contacts.test.ts` and the outreach-engine tests;
  - guests-page status tests;
  - a dry-run script for the migration;
  - `reconcile.integration.test.ts` and `fill-authorized-set.integration.test.ts`, which are skipped unless `OUTREACH_DB_IT=1` on a dedicated test database, extended.
- **Operations:**
  - The owner runs the dry-run script and the DB integration suites, applies the migration and deploys.
  - Build and the full test suite run only when the owner says so.
