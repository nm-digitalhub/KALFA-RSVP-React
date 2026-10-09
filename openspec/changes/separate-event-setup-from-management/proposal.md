# Proposal

## Why

A new customer's setup is scattered: the step list appears on the event page and again on `/setup`, each step's content sits in cards nested three deep, and the event page shows close, cancellation-request and edit controls before the customer has paid. The customer sees the word "קמפיין" for a concept that, to them, does not exist. And an unpaid setup leftover (a campaign row in `pending_approval`, like `3e531968`) blocks closing the event with a message the customer cannot act on. Customer cancellation is staff-only, and the admin list does not show that campaign.

The owner defines this as one problem: there is no clear boundary between setting up an event and managing it.

## What Changes

- **One boundary: server-confirmed payment.** Until the payment ledger records the package as paid (`collected`), every customer route of the event shows the setup flow and nothing else. After that, the event page becomes the management page.
- **Routing follows the boundary.** `/app/events/[id]` redirects an owner whose setup is unfinished to `/setup`. `/setup` redirects a paid event to `/app/events/[id]`, not to the campaign page. Login, email verification and return visits keep landing on `/app`, which already routes to the event page; the event page then picks setup or management.
- **One step list, flat content.** The stepper renders only in the setup shell, once. Step content is one surface with headings and dividers, not cards inside cards. The payment route renders inside the same setup shell, so the step list stays visible while paying.
- **Purchase ends setup; there is no "activation" (owner decision, 8.10).** The recorded purchase starts the service automatically, whether or not the event has guests. The customer never sees an activation, "start" or "paid, not started" state. Guests are not a setup step: they are managed after purchase, can be added at any time, and each one is approached on the package schedule up to the quota.
- **The quota is enforced where guests are added (owner decision, 8.10).** Purchase needs no guests. Adding a guest is what puts the guest on the outreach list, in order of addition, up to the package's contact quota; beyond it the guest is added and waits, visibly. The activation-time fill that used to back this up was removed in `16413312`, so this change adds code-based safety nets in its place (see design D9):
  - **order of addition is kept atomically:** a migration replaces `reconcile_authorized_set` so that an add, and a removal that frees a seat, admit the first waiting guest by order of addition inside the same transaction, even against a concurrent add;
  - **a missed admission is repaired:** the worker, on each tick, re-links guests whose contact link failed and tops up every running package list. Neither step depends on `RECONCILE_AUTHORIZED_SET_ENABLED`;
  - **the guards do not depend on the switch** for a package: a deleted guest's contact never leaves the list silently through a cascade, and never receives outreach;
  - the WhatsApp import logs a failed admission instead of swallowing it;
  - the guests page shows each guest's outreach status, and tells "beyond the quota" apart from a missing phone, a missing link, a request not to be contacted and a pending admission.
- **Close and back inside setup.** The setup shell offers "סגירת האירוע" (with confirmation). The back link from the package step goes to the details step inside setup, not to the event page, which would now redirect back.
- **"קמפיין" is removed from customer-visible text.** This covers step labels, stage labels, page titles, `metadata` titles, buttons and server error messages that reach the owner. The new wording is "אישורי הגעה" / "השירות". Staff surfaces keep the word.
- **Closing an event discards unpaid setup data atomically.** A new database function closes the event and cancels its unpaid campaign in one transaction, with an audit row. Nothing is deleted:
  - the campaign row becomes `cancelled`;
  - `signed_agreements` rows and `payment_operations` rows stay as they are (the ledger is append-only);
  - declined payment attempts stay in the ledger;
  - guest data follows the existing closed-event behavior.

  This corrects an earlier chat message that said the leftover "is deleted with it".
- **Payment states are first-class setup states.** Not started or declined: pay again. In progress or in review: a waiting state, and closing is blocked with a support message. Paid: the management page, with no start action, whether or not guests exist.

## Capabilities

### New Capabilities
- `event-setup`: what a customer sees for an event from creation until server-confirmed payment, how routing selects setup or management, the single step list, the payment states inside setup, read-only access for non-owner viewers, and the customer vocabulary (no "קמפיין").
- `event-closure`: when an event may be closed, how unpaid setup data is retired on close, what blocks closing, and what is recorded.

### Modified Capabilities
None. `openspec/specs/` has no existing capabilities.

## Non-goals

- **Retiring the pay-per-result model.** `AgreementStep` keeps rendering for a legacy campaign. The only pending one, `3e531968`, becomes closable through this change. Retirement is tracked in `docs/superpowers/plans/2026-10-08-old-billing-model-remnants-audit.md`.
- **The admin `/admin/campaigns` list gap.** Draft, pending-approval and approved campaigns are not listed. That is a separate staff-surface change.
- **The signed agreement text.** It lives as data in `agreement_documents` and `agreements/template.ts`, and may contain "קמפיין". Changing signed wording is the owner's separate decision; this change does not touch it.
- **URL paths.** `/campaign/[campaignId]/…` routes keep their names; only visible text changes.
- **Merging the campaign results page into the event page.** It keeps its route and is renamed in visible text only.
- **Test-money resets.** A campaign paid with test money stays a staff reset (`cancel_campaign`), and closing never silently resets it.
- **Messages sent to the owner by email, WhatsApp or Slack.** They are not customer UI in this sense.

## Impact

- **Customer routes under `src/app/(customer)/app/events/[id]/`:**
  - event `page.tsx`, `setup/page.tsx`, `setup-steps.tsx`, `setup-stepper.tsx`;
  - `campaign/[campaignId]/payment/*`, `approve/package-terms-step.tsx`;
  - `event-status-actions.tsx`, `campaign-actions.ts`, `guests/page.tsx` and `stats/page.tsx` (mode gate);
  - every file that renders "קמפיין" to a customer (17 files contain it today, some only in comments).
- **Payment landing:**
  - `campaign/[campaignId]/payment/package-payment-view.tsx` (the success screen);
  - `src/app/api/campaigns/[id]/purchase/route.ts` and `cardcom-open-fields-form.tsx`: after payment they return to `payment?paid=1` and must land on the event page instead;
  - `campaign/[campaignId]/page.tsx`: it needs a mode gate, because today it is reachable by URL before payment.
- **Domain:**
  - `src/lib/data/setup-steps.ts` (boundary, steps, back target);
  - `src/lib/data/package-activation-errors.ts` and `package-purchase-errors.ts` (customer-facing error strings);
  - `src/lib/data/event-labels.ts` (customer labels);
  - `src/lib/data/events.ts` (`closeEvent` calls the new RPC);
  - `src/lib/data/contacts.ts` (`reconcileCampaignSetForContact` and `pruneOrphanContact`: not switch-gated for a package; a new request-free link repair) and `worker/main.ts` (`handleArm`: link repair and top-up of running package lists);
  - `src/lib/data/outreach-engine.ts` (the `no_live_guest` skip, not switch-gated for a package);
  - `guests/import/whatsapp/actions.ts` (log a failed admission) and `guests/page.tsx` (per-guest "beyond the quota" marker);
  - customer-facing error strings in `src/lib/data/campaigns.ts` and `src/lib/data/agreements.ts`.
- **Database:** two migrations.
  - One adds a security-invoker function, callable by `service_role` only, that closes an event and retires its unpaid campaign. The R7 trigger, `cancel_campaign` and the ledger are unchanged.
  - One replaces `reconcile_authorized_set` (same signature and results) and adds a shared admission function used by it and by `fill_authorized_set`, so admission by order of addition is atomic. The audit vocabulary is unchanged.

  `types.generated.ts` is regenerated through the normal command.
- **Tests:**
  - `setup-steps` unit tests;
  - event, setup and payment page routing tests;
  - `/app` routing test;
  - `closeEvent` tests;
  - `permission-separation.test.ts`;
  - `campaign-status.test.ts` parity (unchanged);
  - a vocabulary scan of customer routes;
  - guest-add admission tests for the single add, bulk insert, CSV import and WhatsApp import paths, and for the worker link repair and top-up;
  - the DB integration suites `reconcile.integration.test.ts` and `fill-authorized-set.integration.test.ts` (skipped unless `OUTREACH_DB_IT=1` on a dedicated test DB), extended with order of addition, the freed seat and a concurrent add;
  - a dry-run script for the `reconcile_authorized_set` replacement;
  - a migration dry-run script.
- **Operations:** the owner applies the migration and deploys. Build and the full test suite run only when the owner says so.
