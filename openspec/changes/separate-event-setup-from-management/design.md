# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

- **The stage model already exists.** `campaignStage` (`src/lib/data/event-labels.ts`) and `computeSetupSteps` (`src/lib/data/setup-steps.ts`) derive the stage on the server from the event, the live campaign and the payment ledger (`packagePaymentOf`). `isFunded` means a confirmed hold for pay-per-result, or `collected` in the ledger for a package. This change reuses that model and does not add a second one.
- **Routing today:**
  - `/app` redirects to the single event (`src/app/(customer)/app/page.tsx`);
  - login and email verification redirect to `/app` (`src/app/auth/actions.ts`, `src/app/auth/confirm/actions.ts`);
  - a new event redirects to its event page (`events/actions.ts:157`);
  - `/setup` redirects to the campaign page only after activation (`POST_ACTIVATION_STAGES`);
  - the event page renders `SetupSteps` (a second stepper), `EventStatusActions` (close), `CancellationRequestForm` and `EditEventForm` (for a non-draft event).
- **Activation no longer needs contacts (task 1.2, implemented in `16413312`).** Before that commit, `activateCampaign` filled the outreach list (`fill_authorized_set`) and refused when it filled to zero (`PACKAGE_NO_CONTACTS_ERROR`). Now `requirePackageFunding` (`campaigns.ts`) checks only that the ledger shows `collected`, and `PACKAGE_NO_CONTACTS_ERROR` / `PACKAGE_SUPPORT_ERROR` are deleted. Its re-verification is still open (task 1.2).
- **How a guest reaches the outreach list today** (`campaign_authorized_contacts`, read by `seedOutreachState` on every worker arm tick, `worker/main.ts:588`):
  - at terms approval, `fill_authorized_set` admits the existing guests by order of addition up to `contact_quota` (`agreements.ts:463`, best-effort, logged on failure);
  - on every guest add, `reconcileCampaignSetForContact(…, 'add')` (`contacts.ts:252`) calls `reconcile_authorized_set`, which admits up to the quota or answers `quota_full`. Callers: single add and edit (`guests-actions.ts:104-112`), the bulk insert used by both imports (`guests.ts:913-928`), CSV import (`import-actions.ts:305-317`) and WhatsApp import (`whatsapp/actions.ts:170-180`).
- **Gaps found (8.10):**
  - **Kill-switch dependency.** `reconcileCampaignSetForContact` and the bulk link loop are inert unless `RECONCILE_AUTHORIZED_SET_ENABLED === 'true'` (`reconcile-config.ts:17`). PM2 does not set it; it comes from `.env.local` (`=true`), which `next start` and `worker/start.mjs:34` load. Live audit rows (`add`, `repoint`, `delete` in 9.2026) show it is effective. With the gate on the guests page (D4), guests are added after approval, so this call is their only way onto the list.
  - **Lost backup.** The activation-time fill was the second chance for a contact whose admission failed or was skipped. Since `16413312` nothing fills after approval.
  - **A failed admission is not retried.** An RPC error is logged and swallowed (`contacts.ts:279-283`); the WhatsApp import swallows a failure without logging (`whatsapp/actions.ts:178-180`).
  - **A freed seat skips the queue.** `reconcile_authorized_set` `delete` removes a not-yet-approached member and returns `removed` without admitting a waiting contact; the next guest *added* takes the seat ahead of earlier waiters.
  - **Beyond-quota guests are not visible per guest.** Only an aggregate "not included" count exists on the results page (`manage-client.tsx:1029`).
  - **No test asserts the add paths call the reconcile**, and the DB suites for both RPCs are skipped unless `OUTREACH_DB_IT=1` on a dedicated test DB.
- **What `fill_authorized_set` can and cannot repair.** It admits only rows of `contacts` that a guest already points to (`g.contact_id = c.id`, `20261005041852_fill_authorized_set.sql:65-79`). It never creates a contact and never sets `guests.contact_id`. Linking is done by `linkGuestContact` (`contacts.ts:130`, single add/edit), `buildContactsForEvent` (`contacts.ts:68`, both imports) and the bulk loop (`guests.ts:913`, only with the switch on). Both functions open with `requireEventAccess` (a user session), so the worker cannot call them. A guest whose link failed is invisible to every fill.
- **Order is not atomic across two calls.** `reconcile_authorized_set` (live definition) commits a `delete` and returns `removed`; any second call (a fill) is a new transaction. A concurrent `add` in between locks the campaign row, sees the free seat and takes it: the `add` branch never checks for earlier waiting contacts (lines 70-80). Ordering by addition therefore has to happen inside the RPC, under the campaign row lock. The audit `reason` vocabulary is closed: `add`, `repoint`, `delete`, `snapshot` (`campaign_authorized_set_audit_reason_check`, live).
- **Delete and phone change with the switch off.**
  - Guest delete: the reconcile call is a no-op and `pruneOrphanContact` runs (`guests.ts:639-642`) without its set-member guard (`contacts.ts:222`). A contact with no history is deleted, and `campaign_authorized_contacts` and `outreach_state` rows go with it through `ON DELETE CASCADE` (live FKs): no audit row, and no waiting contact is admitted to the freed seat.
  - A contact with history is kept and stays on the list; the engine's `no_live_guest` skip is also switch-gated (`outreach-engine.ts:706`), so outreach can continue to the phone of a deleted guest.
  - Phone change: `linkGuestContact` relinks the guest and prunes the previous contact (`contacts.ts:178-180`) under the same two outcomes; the new contact is not admitted.
- **Close rules today:**
  - `closeEvent` (`events.ts`) updates the status with the service-role client;
  - trigger R7 (`events_guard_update`, last in `20260930191529`) refuses while any campaign is `draft`, `pending_approval`, `approved`, `scheduled`, `active` or `paused`;
  - the TS mirror is `OPERATIONAL_CAMPAIGN_STATUSES`, pinned by `campaign-status.test.ts`;
  - `cancel_campaign(p_campaign, p_actor)` (`20261008040027`) already holds the "no real money" gate and writes the audit row.
- **Payment screen kinds** (`packagePaymentScreen`): `form`, `in_progress`, `review`, `paid`, and `unavailable` with reasons `ledger`, `bad_state`, `past`, `not_active` and `disabled`.
- **Approval records** are `signed_agreements` rows (`recordPackageApproval`). The ledger (`payment_operations`) is append-only.

## Goals / Non-Goals

**Goals:**
- One server-side decision, "setup or management", used by every customer route of the event.
- One setup shell (stepper and content) shared by `/setup` and the payment route.
- One database function for close-with-retire, reusing `cancel_campaign`'s gate rather than copying it.

**Non-Goals (design level):**
- No change to `campaignStage`'s existing values. The R7 status list, `cancel_campaign`'s gate and the payment routes' money logic are also unchanged.
- No new table and no row deletion.

## Decisions

### D1. The boundary is `isFunded`, exposed as `eventMode()`
Add `eventMode(stage)` in `setup-steps.ts`, returning `'setup' | 'management' | 'readonly_setup'`:

| Stage | Mode |
|---|---|
| `not_set`, `awaiting_signature`, `awaiting_payment` | `setup` |
| `awaiting_activation`, `active`, `paused`, `closed` | `management` |
| `cancelled` | never reached: `liveCampaignOf` skips cancelled rows, so a reset event reads `not_set` |

`POST_ACTIVATION_STAGES` is replaced by this mode. With D4, a paid package no longer stays in `awaiting_activation`; the row stays in the table for the pay-per-result model and for an activation that failed for a technical reason (shown to staff, not as a customer state).

The viewer decides between `setup` and `readonly_setup`. The owner gets `setup`. A non-owner with `campaigns.view` gets `readonly_setup`. A viewer without `campaigns.view` gets neither and keeps the current permission-limited card.

**Alternative:** a new stored column `events.setup_completed_at`. Rejected: it duplicates what the ledger already says and can drift from it.

### D2. Routing
- **`/app/events/[id]`:** compute the mode with the same reads the page already makes. On `setup` (owner), `redirect('/app/events/[id]/setup')`. On `readonly_setup`, render a read-only card (event header, "בהקמה", current step name). On `management`, render today's management page, minus `SetupSteps`.
- **`/setup`:** on `management`, `redirect('/app/events/[id]`)`. A closed event keeps today's redirect.
- **Payment route:** for a package campaign in `setup` mode, render inside the setup shell (D3). In `management` mode it redirects to the event page.
- **Campaign results page (`campaign/[campaignId]/page.tsx`):** for an owner in `setup` mode it redirects to `/setup`. Today it has no stage gate and is reachable by URL before payment.
- **Landing after payment:** the purchase route (`api/campaigns/[id]/purchase/route.ts:109-118`) and `cardcom-open-fields-form.tsx:170` redirect to the event page, which is now management, instead of `payment?paid=1`.  The success screen in `package-payment-view.tsx` no longer says "מעבר לניהול הקמפיין".
- **Unreadable ledger, no redirect loop:** `packagePaymentOf` returns `null` when the ledger cannot be read (`package-paid.ts:27-33`). Every route treats `null` the same way: the mode is `unavailable`, and the route renders an "המצב אינו זמין כרגע" notice in place, with no redirect. A paid customer is then never bounced between the event page and `/setup`.
- **Redirect only for viewers who can see setup:** `/setup` throws `notFound` for a viewer without `campaigns.view` (`getCampaignForEvent`). The event-page redirect therefore applies only to the owner. Other viewers get `readonly_setup` or the permission-limited card.
- **`/app`, login and verify:** no change. They land on the event page, which picks the mode. A user with no event still gets "בואו נתחיל".

### D3. One setup shell, flat content
- **`SetupShell`:** a server component holding the header, the stepper (once), the "סגירת האירוע" control and one content surface. Both `/setup` and the package payment page use it.
- **`SetupSteps`** (the event-page card) is deleted. This retires the duplicate.
- **Flattening.** Step components lose their own bordered sections: `PackageTermsStep` "עיקרי התנאים", the payment view panels and the confirm form. They become `<section>` blocks with an `h3` and a top divider inside the single surface.
- **`AgreementStep`** (pay-per-result, legacy) is left as is (non-goal). It renders only for a legacy campaign.

### D4. Purchase starts the service; the quota is enforced where guests are added (owner decision 8.10)
- **No activation condition.** For a package campaign, `activateCampaign` no longer refuses an empty list: after the ledger shows `collected` it sets the campaign `active` even with zero contacts. `PACKAGE_NO_CONTACTS_ERROR` is retired, along with its customer screens ("start now", "no contacts"). Implemented in `16413312`; re-verification is task 1.2.
- **The list grows with the guest list.** Adding a guest (single add, bulk insert, CSV or WhatsApp import) to an event with a running package admits the guest's contact to the outreach list in order of addition, up to `contact_quota`, through the same eligibility as `fill_authorized_set`. Beyond the quota the guest is added and waits. The existing calls (Context) are kept. Because guests are managed only after setup, the approval-time fill normally admits nobody and these calls carry the whole list; D9 adds the safety nets that replace the removed activation-time fill.
- **Schedule.** A guest admitted after some scheduled touchpoints passed gets the touchpoints still ahead of the event. Whether a late guest also gets the invitation that went out earlier is defined by the outreach engine's existing behavior. Task 1.4 records what it is, and any change to it is a separate decision.
- **Gate.** The guests and statistics pages are management: an owner in `setup` is redirected to `/setup`.
- **Failure after purchase.** If the status change itself fails (a ledger read error or a concurrent change), the payment stays recorded. Staff get the existing Slack alert. The customer sees "הרכישה נרשמה", not an activation error.

### D5. Close inside setup and the back link
- **Close control.** The close control, with a confirmation, is offered for a `draft` event as well as an `active` one (R6 allows draft → closed). `EventStatusActions` now takes `closeAllowed` and `blockedHint` from the event lifecycle model (D7a) instead of `hasBlockingCampaign`, and is rendered only for a viewer holding `events.close`. It calls the same `closeEventAction`, which uses D7 and lands on the event page after a close, wherever it was pressed.
  - Built (2026-10-28) on the event page and at the bottom of `/setup`. `SetupShell` (task 4.1) does not exist yet; when it is built, the control moves into it.
- **Cancellation request.** The event page shows the cancellation request form only when the model tags the service `cancellation.requestable` (paid or running), or to show the status of a request already sent. Before payment the close retires the setup, so there is nothing to request.
- **Back link.** `setupBackTarget`'s package step returns `/setup?step=details`, like the confirm step. `editingDetails` (`?step=details`) is allowed for a confirmed event in setup as well. The details form there receives the same `datesLocked` and `hasOperationalCampaign` the event page passes, so the locks show in the form; the server enforces them either way.

### D6. Payment states inside setup

| Ledger / screen | Step state | Close |
|---|---|---|
| `none` / `form` | pay current | allowed (retires) |
| `declined` / `form` with retry notice | pay current | allowed (retires) |
| `pending` resumable (CardCom) / `form` | pay current | blocked: in flight |
| `pending` / `in_progress` | pay current, waiting text | blocked: in flight |
| `review` / `review` | pay current, waiting text | blocked: support |
| `collected` / `paid` | mode becomes management | blocked: paid |
| `collected` test money | management | blocked (staff reset only) |
| ledger unreadable / `unavailable:ledger` | pay current, "לא זמין כרגע" | blocked (fail closed) |
| `refunded` and others / `unavailable:bad_state` | pay current, support text | blocked: money moved |
| event past / `unavailable:past` | blocked step (`PAST_EVENT_HINT`) | allowed if no money |

Legacy pay-per-result `3e531968` (`pending_approval`, no hold, no ledger rows): close allowed, and it retires through `cancel_campaign`.

### D7. Database: `close_event_retiring_setup(p_event uuid, p_actor uuid)`
Built as migration `20261027211431_close_event_retiring_setup.sql`, applied by the owner (`db push`) and with types regenerated, 2026-10-28.
- **Who may close: the customer permission system (owner, 2026-10-27).** A customer action never runs through a staff function or a staff key ("לא מערבבים הרשאות צוות ומשתמשים בהם עבור לקוח"), and the access decision is not hand-written a second time ("שלא נעבוד כפול"). The same migration adds the customer permission `events.close` ("אירועים — סגירה"):
  - `system_protected`, so only the organization's owner role holds it and it cannot be delegated (owner decision: protected);
  - in the template `role_permissions`, so `create_organization` gives it to every new organization;
  - on the owner role of every existing organization.
  `closeEvent` checks it with `requireEventAccess(eventId, 'events', 'close')`, which runs `can_access_event` on the caller's own session. The event's owner passes by ownership in any case; the permission decides whether another member may close. It is not a platform key, and it is not in `PLATFORM_ACTIONS` (CASL covers staff only; organization RBAC is out of its scope).
- **Security.** `security invoker`, `search_path ''`, execute granted to `service_role` only. No browser-context role gains a way to change an event's status (M1). The function checks no permission itself; it receives the verified user as `p_actor`.
- **Body, one transaction; every refusal returns before the first write:**
  1. Lock the event row (`for update`). Not found → `not_found`; already closed → `already_closed`.
  2. Lock the live campaign (`campaigns_event_noncancelled_uidx`: at most one).
  3. A running service (`scheduled`, `active`, `paused`) → `blocked_paid`: it was paid for and ends through a cancellation request. R7 stays as the backstop.
  4. A campaign in `draft`, `pending_approval` or `approved`: a succeeded money row (test money included) → `blocked_paid`; a payment in flight or a billed result → `blocked_money`; otherwise set it `cancelled` inline (`campaigns_guard_cancel` re-checks the same rule) and release its bound benefit through `release_coupon_assignment` (actor `p_actor`), as a staff cancellation does. `cancel_campaign` is not called: it is staff-only since `20261027124834`.
  5. Update `events.status = 'closed'`.
  6. Insert one `activity_log` row (`event.closed`, `user_id = p_actor`, meta `{retiredCampaignId, statusBefore}`, empty when nothing was retired), then return `closed`.
- **Why the explicit succeeded check.** `cancel_campaign` lets settled test money through, because that is its reset purpose. Closing must not silently reset a test run. The spec requires blocking it.
- **`closeEvent`.** It checks `events.close`, calls the RPC with the verified user, maps every outcome (the RPC error included) to a fixed Hebrew message without "קמפיין", and no longer writes its own `event.closed` row. `closeEventAfterSettlement` and `adminCloseEvent` are untouched.
- **Migration file.** Header (why, what, what not, lock order), its own `begin`/`commit` (the owner's rule from `20261027193942`), a `do $$` verification block (the permission rows, invoker, `search_path`, ACL, service_role's privileges, both guard triggers, the body's rules and order, a call on an unknown event), and a manual rollback. Dry run: `dry-run-close-event-retiring-setup.sql` in this change, one transaction rolled back, 13 checks.

### D7a. The event lifecycle model (XState), for the screens
- **What.** `src/lib/data/event-lifecycle.ts`: one statechart with two parallel regions, `status` (draft, active) and `service` (none, setup, paymentInFlight, paid, moneyMoved, running, finished, unavailable, with their sub-states), and a final `closed`. The service state is resolved from what the server already read (the live campaign, `packagePaymentOf`), never from an event. `event.close` is taken only from the service states where nothing was paid.
- **A decision model, not an authority (owner, 2026-10-28).** The screens ask `snapshot.can({ type: 'event.close' })` whether to offer the close and `hasTag('cancellation.requestable')` whether to offer the request. Who may close is `events.close`; the money rules and the atomic close are D7's function. Guards stay pure and synchronous.
- **Never more permissive than the database.** The service state keeps every distinction the server makes, and an unreadable ledger or invisible campaigns fail closed. `event-lifecycle.test.ts` reads the status lists from the newest migration that defines `close_event_retiring_setup` and checks every campaign status × ledger combination, built with the real `deriveStatus`. `event-lifecycle.model.test.ts` (xstate/graph) shows that no sequence of events from a state holding money reaches `closed`.
- **Viewing it.** `npm run inspect:lifecycle` runs every configuration through `@statelyai/inspect`'s own server, reachable over the tailnet with `tailscale serve`. A local npm patch (`patches/@statelyai/inspect@0.7.2.patch`) makes the page connect to its own origin, adds a `host` option and an inverted `?light` view. A development tool, never deployed.

**Alternatives:**
- Relax R7 to ignore unpaid campaigns. Rejected: it leaves orphaned `pending_approval` rows on closed events, and changes a hand-synced list pinned by parity tests.
- Cancel and then close in two application calls. Rejected: not atomic.

### D8. Customer vocabulary
- **Replacements.** Customer-route strings change, including the shared label maps used by customer routes:
  - `SETUP_STEP_LABELS.live` becomes 'אישורי ההגעה פעילים';
  - `CAMPAIGN_STAGE_LABELS` gets a customer variant;
  - `metadata` titles ('תשלום קמפיין' becomes 'תשלום');
  - buttons ('ניהול הקמפיין' becomes 'אישורי הגעה ותוצאות', 'הפעלת הקמפיין עכשיו' is removed).
- **Errors.** Owner-facing errors thrown by `createCampaign`, `recordPackageApproval` and the activation path get customer wording. Staff-only strings in the same modules stay.
- **Regression guard.** A vitest scan over `src/app/(customer)/**/*.tsx` string literals and JSX text (comments stripped) fails on "קמפיין", with an explicit allowlist for staff-only branches (`manage-client.tsx` admin controls). The error constants get a unit test.

### D9. Admission safety nets for the package list
The guest-add calls stay the primary path. The following makes the list correct, in order of addition, even when one of them did not run, without asking for guests before payment. It applies to campaigns with a `contact_quota`; a campaign without one keeps today's behavior.

- **(a) Order of addition inside the RPC (migration).** A new migration replaces `reconcile_authorized_set` (same signature and return values):
  - `add`, and a `repoint` whose old contact was not on the list: when the campaign has a quota, admit eligible non-members by smallest `guests.seq` up to the quota, in the same transaction and under the existing `for update` lock, instead of inserting `p_contact` directly. Return `added` if `p_contact` is on the list afterwards, `quota_full` otherwise.
  - `delete` that removes a member (`removed`): in the same transaction, admit the first waiting eligible contact by `seq`.
  - Eligibility and the "first by `seq`" rule are the ones `fill_authorized_set` already uses (a contact ranks by the smallest `seq` among its guests; `removal_requested` excluded; must be referenced by a live guest). They move into one shared internal SQL function that both RPCs call, so there is one definition.
  - Audit rows use the existing vocabulary: `in` / `add` for an admission caused by an add, `in` / `delete` for the admission that fills a freed seat (the `out` / `delete` row for the removed member stays). No constraint change.
  - Header, `security definer` and `search_path` as today; grants unchanged; a verification block and a dry-run script in the style of `20261008040027`; manual rollback re-creates the current definition.
- **(b) Worker top-up with link repair.** In `handleArm` (`worker/main.ts`), before `seedOutreachState`, for each running campaign with a quota:
  1. repair links: a new request-free function (admin client, no `requireEventAccess`) reads the event's guests with a valid phone and a null `contact_id`, normalizes with the existing pure `deriveContacts`, upserts the contact and sets `guests.contact_id`. It never clears an existing link;
  2. call `fillAuthorizedSet(event_id, campaign_id, 'arm_topup')`.

  Neither step reads `RECONCILE_AUTHORIZED_SET_ENABLED`, so package admission does not depend on the switch. A failure is logged and the tick continues. Latency is one arm tick.
- **(c) Guards that must not depend on the switch.** For a campaign with a quota, the set-member guard in `pruneOrphanContact` and the `no_live_guest` skip in the outreach engine run whether or not the switch is on, so a deleted guest's contact is never silently cascaded off the list without audit, and never receives outreach. Guest delete and phone change call the reconcile (`delete` / `repoint`) for such a campaign regardless of the switch.
- **(d) Visible failures and per-guest status.** The WhatsApp import logs a failed admission as the CSV import does. The guests page shows each guest's outreach status for a running package, computed from one read of the event's list and contacts (no per-row query):

| Status | Condition | Shown |
|---|---|---|
| No phone | no valid phone | "אין טלפון" (not a quota matter) |
| Link missing | valid phone, `contact_id` null | "בטיפול" (a fault; the top-up repairs it) |
| Asked not to be contacted | `contacts.removal_requested` | its own label |
| On the list | contact in `campaign_authorized_contacts` | no marker |
| Beyond the quota | eligible, not on the list, list full | "מעבר למכסת החבילה" |
| Pending admission | eligible, not on the list, list has room | "בטיפול" (a missed admission; the top-up repairs it) |

  No running package (no quota, or a status outside `approved` / `scheduled` / `active` / `paused`): no marker. Guests that share a phone share one seat and one status.

The switch itself is kept for the pay-per-result paths; removing it entirely is a separate decision (Open Questions).

**Alternatives:**
- Restore the activation-time fill. Rejected: activation runs once, at purchase, when the list is normally empty; it would not help guests added later.
- Refill from the application after `removed` (a second call). Rejected: not atomic; a concurrent add can take the seat between the two transactions (Context).
- Remove `RECONCILE_AUTHORIZED_SET_ENABLED` for quota campaigns only. Partly adopted through (b) and (c); removing it for admission at add time is an open question.
- Let the worker call `buildContactsForEvent`. Not possible: it requires a user session (`requireEventAccess`).

## Risks / Trade-offs

- [The customer cannot prepare the guest list before paying] → accepted by the owner's decision (D4). Guests are the first task on the management page after payment.
- [An org member is redirected into actions they cannot run] → mode `readonly_setup` for non-owners (D1). `permission-separation.test.ts` covers the owner and non-owner branches.
- [Close retires a campaign at the same moment a payment arrives] → the RPC locks the campaign row first, as the ledger insert trigger does. A concurrent `pending` row makes `cancel_campaign` refuse, so the close is blocked, not lost.
- [The vocabulary scan is brittle] → an explicit allowlist with a reason per entry. It scans text, not identifiers.
- [`campaignStage` labels are shared with staff screens] → the customer variant is a separate map, so staff wording is unchanged.
- [Legacy `AgreementStep` keeps its nested panels] → accepted (non-goal). Its only pending campaign becomes closable.
- [The top-up admits a contact up to one tick late] → the guest-add call admits at once in the normal case; the top-up only repairs a miss.
- [The top-up runs on every tick for every running campaign] → one link query and one RPC per active campaign with a quota per tick, the same order of cost as `seedOutreachState` already does there.
- [Replacing a live RPC that billing-adjacent paths call] → same signature and return values; the pay-per-result branch is unchanged; the dry-run script exercises every branch, including a concurrent add after a removal, before `db push`.
- [An `add` may now admit an earlier waiting contact instead of the one just added] → intended (order of addition); the call answers `quota_full` for the new guest, which then shows "מעבר למכסת החבילה".
- [The DB suites stay skipped in normal runs] → the owner runs them with `OUTREACH_DB_IT=1` on the dedicated test DB as part of task 6.

## Migration Plan

1. Merge code and migration file. Nothing runs automatically.
2. The owner runs the dry-run scripts (one request each, rolled back) for both migrations (`close_event_retiring_setup` and the `reconcile_authorized_set` replacement), then `npx supabase db push --linked`, then `npm run types:gen`. I verify `types:check`.
3. The owner deploys. Until the deploy, the old `closeEvent` keeps working, because the RPC is additive.
4. Runtime pass by the owner in the browser:
   - new signup → verify → create event → setup steps → pay (CardCom test terminal) → management;
   - close during setup on a second event.
5. **Rollback:** revert the app commit (routing returns to today's). Then `drop function public.close_event_retiring_setup(uuid, uuid)`, and re-create the previous `reconcile_authorized_set` from the rollback section of its migration (and drop the shared admission function). Records written by closes and admissions stay as history.

## Open Questions

- Final Hebrew wording of the replaced labels is drafted with `hebrew-content-writer` during implementation and shown to the owner in the diff. Wording does not change the specs.
- Whether `RECONCILE_AUTHORIZED_SET_ENABLED` should stop gating admission at add time for package campaigns too (D9 (b) and (c) already remove the dependency for the top-up and the guards). The owner's call.
- The Hebrew wording of the per-guest statuses in D9 (d).
- Which scheduled messages a guest admitted late receives (`ensureCurrentStep` starts from the current step). Task 1.4 records the existing behavior; changing it is a separate decision.
