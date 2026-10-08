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
- **Activation today needs contacts.** `activateCampaign` fills the outreach list (`fill_authorized_set`: first contacts by order of addition up to `contact_quota`, skipping guests who asked to be removed) and refuses when it fills to zero (`PACKAGE_NO_CONTACTS_ERROR`, `campaigns.ts:1169`). This change removes that condition.
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

### D4. Purchase starts the service; guests join at any time (owner decision 8.10)
- **No activation condition.** For a package campaign, `activateCampaign` no longer refuses an empty list: after the ledger shows `collected` it sets the campaign `active` even with zero contacts. `PACKAGE_NO_CONTACTS_ERROR` is retired, along with its customer screens ("start now", "no contacts").
- **The list grows with the guest list.** Adding a guest (single add, CSV or WhatsApp import) to an event with a running package admits the guest's contact to the outreach list in order of addition, up to `contact_quota`, through the same eligibility as `fill_authorized_set`. Beyond the quota the guest is added and marked as waiting. This already exists and is kept: single add (`guests-actions.ts:108`), CSV import (`import-actions.ts:316`), WhatsApp import (`whatsapp/actions.ts:176`) and `guests.ts:920` call `reconcileCampaignSetForContact(…, 'add')`, which admits up to `contact_quota` and returns `quota_full` beyond it. It is gated by `RECONCILE_AUTHORIZED_SET_ENABLED`, which is set to true. The list is first filled at terms approval (`agreements.ts:463`), so it is not empty at purchase when guests already exist.
- **Schedule.** A guest admitted after some scheduled touchpoints passed gets the touchpoints still ahead of the event. Whether a late guest also gets the invitation that went out earlier is defined by the outreach engine's existing behavior. Task 1.4 records what it is, and any change to it is a separate decision.
- **Gate.** The guests and statistics pages are management: an owner in `setup` is redirected to `/setup`.
- **Failure after purchase.** If the status change itself fails (a ledger read error or a concurrent change), the payment stays recorded. Staff get the existing Slack alert. The customer sees "הרכישה נרשמה", not an activation error.

### D5. Close inside setup and the back link
- **Close control.** `SetupShell` renders the close control with a confirmation for a `draft` event as well as an `active` one. Today `EventStatusActions` shows it only for `active` (`event-status-actions.tsx:104`), although R6 allows draft → closed. It calls the same `closeEventAction`, which now uses D7.
- **Back link.** `setupBackTarget`'s package step returns `/setup?step=details`. `editingDetails` is allowed for a confirmed event in setup as well. The form already applies the date locks (`datesLocked`) and the live-campaign field protection server-side.

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

### D7. Database: `close_event_retiring_setup(p_event uuid, p_owner uuid)`
- **Security.** One migration, created via `npx supabase migration new <name> < /dev/null`. The function is `security invoker` with `search_path ''`. Execute is granted to `service_role` only and revoked from public, anon and authenticated. Because the caller is service_role, the body checks `events.owner_id = p_owner` itself.
- **Body, one transaction:**
  1. Lock the event row (`for update`). If not found or not owned, return `not_found`. If already closed, return `already_closed`.
  2. Lock the live (non-cancelled) campaigns of the event.
  3. For each campaign in `draft`, `pending_approval` or `approved`: if a `payment_operations` row with outcome `succeeded` exists for it (test money included), return `blocked_paid`. Otherwise call `public.cancel_campaign(v.id, p_owner)`. On `not_cancellable`, return `blocked_money` (in-flight payment, hold or charge; `cancel_campaign`'s gate decides).
  4. Update `events.status = 'closed'`. R7 still guards it and raises if any operational campaign remains, for example `active`.
  5. Insert `activity_log` (`event.closed`, `user_id = p_owner`, meta `{retiredCampaignId, statusBefore}`), then return `closed`.
- **Why the explicit succeeded check.** `cancel_campaign` lets settled test money through, because that is its reset purpose. Closing must not silently reset a test run. The spec requires blocking it.
- **`closeEvent`.** It calls the RPC after `requireOwnedEvent`, maps the four results to safe Hebrew messages without "קמפיין", and stops writing its own `event.closed` activity row, since the RPC writes it. The existing `closeEventAfterSettlement` and `adminCloseEvent` paths are untouched.
- **Migration file.** It follows `20261008040027`'s structure: header (why, what, what not), a `do $$` verification block (grants, ACL, invoker, search_path, a call on a fixture), a dry-run script and a manual rollback (`drop function`). It is not applied by me. The owner runs `db push`, then `types:gen`.

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

## Risks / Trade-offs

- [The customer cannot prepare the guest list before paying] → accepted by the owner's decision (D4). Guests are the first task on the management page after payment.
- [An org member is redirected into actions they cannot run] → mode `readonly_setup` for non-owners (D1). `permission-separation.test.ts` covers the owner and non-owner branches.
- [Close retires a campaign at the same moment a payment arrives] → the RPC locks the campaign row first, as the ledger insert trigger does. A concurrent `pending` row makes `cancel_campaign` refuse, so the close is blocked, not lost.
- [The vocabulary scan is brittle] → an explicit allowlist with a reason per entry. It scans text, not identifiers.
- [`campaignStage` labels are shared with staff screens] → the customer variant is a separate map, so staff wording is unchanged.
- [Legacy `AgreementStep` keeps its nested panels] → accepted (non-goal). Its only pending campaign becomes closable.

## Migration Plan

1. Merge code and migration file. Nothing runs automatically.
2. The owner runs the dry-run script (one request, rolled back), then `npx supabase db push --linked`, then `npm run types:gen`. I verify `types:check`.
3. The owner deploys. Until the deploy, the old `closeEvent` keeps working, because the RPC is additive.
4. Runtime pass by the owner in the browser:
   - new signup → verify → create event → setup steps → pay (CardCom test terminal) → management;
   - close during setup on a second event.
5. **Rollback:** revert the app commit (routing returns to today's). Then `drop function public.close_event_retiring_setup(uuid, uuid)`. Records written by closes stay as history.

## Open Questions

- Final Hebrew wording of the replaced labels is drafted with `hebrew-content-writer` during implementation and shown to the owner in the diff. Wording does not change the specs.
