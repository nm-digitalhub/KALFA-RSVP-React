# Design

Extracted from `separate-event-setup-from-management` (its Context bullets on admission, design D9, and the related risks, migration steps and open questions), on the owner's instruction, 29.10.2026. D1 to D4 below are that change's D9 (a) to (d). Their content is unchanged; only the layout, the decision labels and the code line anchors changed. The anchors were re-read on 29.10.2026 and updated where the code had moved.

## Context

See proposal.md (Why) for the motivation. The current state that shapes the approach:

- **Activation no longer fills the list.** Since `16413312`, `activateCampaign` no longer calls `fill_authorized_set` and no longer refuses an empty list. `requirePackageFunding` (`campaigns.ts`) checks only that the ledger shows `collected`. This is `separate-event-setup-from-management` design D4 and its task 1.2.
- **How a guest reaches the outreach list today.** The list is `campaign_authorized_contacts`, and `seedOutreachState` reads it on every worker arm tick (`handleArm`, `worker/main.ts:659`, the seed call at `:666`). A guest gets onto it in two ways:
  - **At terms approval:** `fill_authorized_set` admits the existing guests by order of addition, up to `contact_quota`. This happens in `agreements.ts:295`, actor `package_approval`, best effort and logged on failure.
  - **On every guest add:** `reconcileCampaignSetForContact(…, 'add')` (`contacts.ts:252`) calls `reconcile_authorized_set`, which admits up to the quota or answers `quota_full`. The callers are:
    - single add and edit (`guests-actions.ts:104`);
    - the bulk insert used by both imports (`guests.ts:913-928`, the call at `:920`);
    - CSV import (`import-actions.ts:315-321`);
    - WhatsApp import (`whatsapp/actions.ts:172-180`).
- **Gaps found (8.10):**
  - **Kill-switch dependency.** `reconcileCampaignSetForContact` and the bulk link loop are inert unless `RECONCILE_AUTHORIZED_SET_ENABLED === 'true'` (`reconcile-config.ts:18`).
    - PM2 does not set the switch. It comes from `.env.local` (`=true`), which `next start` and `worker/start.mjs:34` load.
    - Live audit rows (`add`, `repoint`, `delete`, in 9.2026) show the switch is effective.
    - Once the guests page is gated during setup (`separate-event-setup-from-management` D4, its task 3.4), guests are added after approval. This call is then their only way onto the list.
  - **Lost backup.** The activation-time fill was the second chance for a contact whose admission failed or was skipped. Since `16413312`, nothing fills after approval.
  - **A failed admission is not retried.** An RPC error is logged and swallowed (`contacts.ts:279`). The WhatsApp import swallows a failure without logging (`whatsapp/actions.ts:178`).
  - **A freed seat skips the queue.** A `reconcile_authorized_set` `delete` removes a not-yet-approached member and returns `removed` without admitting a waiting contact. The next guest *added* takes the seat ahead of earlier waiters.
  - **Beyond-quota guests are not visible per guest.** Only an aggregate "not included" count exists, on the results page (`manage-client.tsx:920-925`).
  - **No test asserts that the add paths call the reconcile.** The DB suites for both RPCs are skipped unless `OUTREACH_DB_IT=1` on a dedicated test DB.
- **What `fill_authorized_set` can and cannot repair.**
  - It admits only rows of `contacts` that a guest already points to (`g.contact_id = c.id`, `20261005041852_fill_authorized_set.sql:65-79`). It never creates a contact and never sets `guests.contact_id`.
  - Linking is done by `linkGuestContact` (`contacts.ts:130`, single add and edit), `buildContactsForEvent` (`contacts.ts:68`, both imports) and the bulk loop (`guests.ts:913`, only with the switch on).
  - Both functions open with `requireEventAccess` (a user session), so the worker cannot call them.
  - A guest whose link failed is invisible to every fill.
- **Order is not atomic across two calls.**
  - The newest migration that defines `reconcile_authorized_set` is `20261015094022_restore_reconcile_same_contact_noop.sql`. It commits a `delete` and returns `removed`, and any second call (a fill) is a new transaction.
  - A concurrent `add` in between locks the campaign row, sees the free seat and takes it. The `add` branch (lines 79-97 of that file) never checks for earlier waiting contacts.
  - Ordering by addition therefore has to happen inside the RPC, under the campaign row lock.
  - The audit `reason` vocabulary is closed: `add`, `repoint`, `delete`, `snapshot` (`campaign_authorized_set_audit_reason_check`, live).
- **Delete and phone change with the switch off.**
  - **Guest delete:** the reconcile call is a no-op, and `pruneOrphanContact` runs (`guests.ts:639-642`) without its set-member guard (`contacts.ts:222`). A contact with no history is deleted, and its `campaign_authorized_contacts` and `outreach_state` rows go with it through `ON DELETE CASCADE` (live FKs). No audit row is written, and no waiting contact is admitted to the freed seat.
  - **A contact with history** is kept and stays on the list. The engine's `no_live_guest` skip is also switch-gated (`outreach-engine.ts:703-709`), so outreach can continue to the phone of a deleted guest.
  - **Phone change:** `linkGuestContact` relinks the guest and prunes the previous contact (`contacts.ts:173`), with the same two outcomes. The new contact is not admitted.
- **Measured in production, 29.10.2026 (read-only query).**
  - 4 package campaigns are in `approved`, `scheduled`, `active` or `paused`. Together they have 1 guest, and that guest is on the list.
  - 0 eligible contacts are off the list, and 0 guests with a phone are unlinked.
  - So no missed admission has been observed. But the sample is one guest, so the nets rest on the structural gaps above, not on measured failures.
- **Which scheduled messages a guest admitted late receives (task 1.1, read from the code on 29.10.2026, not measured on a run).**
  - On the next arm tick, `seedOutreachState` (`outreach-engine.ts:76`) gives the new list member an `outreach_state` row. Its cursor starts at step 0 (`current_step_index default 0`, `202606290032_outreach_state.sql:18`).
  - `ensureCurrentStep` (`outreach-engine.ts:780`) then walks one step at a time, and `evaluateStep` (`send-window.ts`) decides each step:
    - a step whose NEXT step is already due is skipped (`superseded_by_later_touchpoint`);
    - an overdue step whose legal slot falls on a later Israel day is skipped (`missed_touchpoint`);
    - an overdue step still legal on its own day is sent at once; a future step is deferred to its slot.
  - So a late guest receives the steps whose time has not passed, plus at most the latest overdue step if it is still the same day. Earlier steps, the invitation included, are not sent.
  - Example on the production package's schedule (invite 10 days before, reminders 6 and 3 days before, a call 2 days before, a final message 1 day before): a guest added 4 days before the event receives only the 3-day reminder, the call and the final message. That guest never receives the invitation.
  - The unit tests of both skips are in `send-window.test.ts` ("SKIPS superseded_by_later_touchpoint …", "SKIPS missed_touchpoint …"). Changing this behavior is outside this change (Non-goals, and Open Questions below).

## Goals / Non-Goals

**Goals:**
- One definition of eligibility and rank by order of addition, shared by both RPCs.
- Admission by order of addition that is atomic against a concurrent add.
- Package admission and its guards that do not depend on `RECONCILE_AUTHORIZED_SET_ENABLED`.

**Non-Goals (design level):**
- No change to the pay-per-result branch of `reconcile_authorized_set`, its signature, its results, its grants or the audit `reason` vocabulary.
- No new table, and no change to the outreach engine's scheduling of a late guest. Task 1.1 records it.

## Decisions

The guest-add calls stay the primary path. What follows makes the list correct, in order of addition, even when one of them did not run, without asking for guests before payment. It applies to campaigns with a `contact_quota`. A campaign without one keeps today's behavior.

### D1. Order of addition inside the RPC (migration) (was D9 a)
A new migration replaces `reconcile_authorized_set`, with the same signature and return values:
- **`add`, and a `repoint` whose old contact was not on the list:** when the campaign has a quota, admit eligible non-members by smallest `guests.seq`, up to the quota, in the same transaction and under the existing `for update` lock, instead of inserting `p_contact` directly. Return `added` if `p_contact` is on the list afterwards, `quota_full` otherwise.
- **`delete` that removes a member (`removed`):** in the same transaction, admit the first waiting eligible contact by `seq`.
- **One definition of eligibility and rank.** Both RPCs call one shared internal SQL function, with the rules `fill_authorized_set` already uses:
  - a contact ranks by the smallest `seq` among its guests;
  - `removal_requested` contacts are excluded;
  - the contact must be referenced by a live guest.
- **Audit rows use the existing vocabulary:** `in` / `add` for an admission caused by an add, and `in` / `delete` for the admission that fills a freed seat. The `out` / `delete` row for the removed member stays. No constraint change.
- **Migration file:**
  - header, `security definer` and `search_path` as today;
  - grants unchanged;
  - a verification block, and a dry-run script in the style of `20261008040027`;
  - a manual rollback that re-creates the current definition.

### D2. Worker top-up with link repair (was D9 b)
In `handleArm` (`worker/main.ts`), before `seedOutreachState`, for each running campaign with a quota:
1. **Repair links.** A new request-free function (admin client, no `requireEventAccess`):
   - reads the event's guests that have a valid phone and a null `contact_id`;
   - normalizes them with the existing pure `deriveContacts`;
   - upserts the contact and sets `guests.contact_id`.

   It never clears an existing link.
2. **Top up.** Call `fillAuthorizedSet(event_id, campaign_id, 'arm_topup')`.

Neither step reads `RECONCILE_AUTHORIZED_SET_ENABLED`, so package admission does not depend on the switch. A failure is logged and the tick continues. Latency is one arm tick.

### D3. Guards that must not depend on the switch (was D9 c)
For a campaign with a quota:
- the set-member guard in `pruneOrphanContact` and the `no_live_guest` skip in the outreach engine run whether or not the switch is on;
- so a deleted guest's contact is never silently cascaded off the list without audit, and never receives outreach;
- guest delete and phone change call the reconcile (`delete` / `repoint`) for such a campaign regardless of the switch.

### D4. Visible failures and per-guest status (was D9 d)
The WhatsApp import logs a failed admission as the CSV import does. The guests page shows each guest's outreach status for a running package, computed from one read of the event's list and contacts (no per-row query):

| Status | Condition | Shown |
|---|---|---|
| No phone | no valid phone | "אין טלפון" (not a quota matter) |
| Link missing | valid phone, `contact_id` null | "בטיפול" (a fault; the top-up repairs it) |
| Asked not to be contacted | `contacts.removal_requested` | its own label |
| On the list | contact in `campaign_authorized_contacts` | no marker |
| Beyond the quota | eligible, not on the list, list full | "מעבר למכסת החבילה" |
| Pending admission | eligible, not on the list, list has room | "בטיפול" (a missed admission; the top-up repairs it) |

No running package (no quota, or a status outside `approved` / `scheduled` / `active` / `paused`): no marker. Guests that share a phone share one seat and one status.

The switch itself is kept for the pay-per-result paths. Removing it entirely is a separate decision (Open Questions).

**Alternatives:**
- **Restore the activation-time fill.** Rejected: activation runs once, at purchase, when the list is normally empty. It would not help guests added later.
- **Refill from the application after `removed` (a second call).** Rejected: not atomic. A concurrent add can take the seat between the two transactions (Context).
- **Remove `RECONCILE_AUTHORIZED_SET_ENABLED` for quota campaigns only.** Partly adopted through D2 and D3. Removing it for admission at add time is an open question.
- **Let the worker call `buildContactsForEvent`.** Not possible: it requires a user session (`requireEventAccess`).

## Risks / Trade-offs

- **[The top-up admits a contact up to one tick late]** → The guest-add call admits at once in the normal case. The top-up only repairs a miss.
- **[The top-up runs on every tick for every running campaign]** → One link query and one RPC per active campaign with a quota per tick, the same order of cost as `seedOutreachState` already has there.
- **[Replacing a live RPC that billing-adjacent paths call]** → Same signature and return values, and the pay-per-result branch is unchanged. Before `db push`, the dry-run script exercises every branch, including a concurrent add after a removal.
- **[An `add` may now admit an earlier waiting contact instead of the one just added]** → Intended: order of addition. The call answers `quota_full` for the new guest, which then shows "מעבר למכסת החבילה".
- **[The DB suites stay skipped in normal runs]** → The owner runs them with `OUTREACH_DB_IT=1` on the dedicated test DB as part of task 4.3.

## Migration Plan

1. Merge the code and the migration file. Nothing runs automatically.
2. The owner runs the dry-run script (one request, rolled back), then `npx supabase db push --linked`, then `npm run types:gen`. I verify `types:check`.
3. The owner runs `reconcile.integration.test.ts` and `fill-authorized-set.integration.test.ts` with `OUTREACH_DB_IT=1` on the dedicated test DB, never the linked project.
4. The owner deploys the app and the worker.
5. **Rollback:** revert the app commit. Then re-create the previous `reconcile_authorized_set` from the rollback section of its migration, and drop the shared admission function. Records written by admissions stay as history.

## Open Questions

- Whether `RECONCILE_AUTHORIZED_SET_ENABLED` should stop gating admission at add time for package campaigns too. D2 and D3 already remove the dependency for the top-up and the guards. The owner's call.
- The Hebrew wording of the per-guest statuses in D4.
- Whether a guest admitted late should receive an invitation first. Today such a guest receives only the steps still due (Context: "Which scheduled messages a guest admitted late receives"), so a guest added after the invitation day never gets the invitation. Changing it is a separate decision.
