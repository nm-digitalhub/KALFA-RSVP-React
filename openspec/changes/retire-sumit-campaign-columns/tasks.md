# Tasks

Every verification re-measures the live state; none assumes a fixed count. After every group: tsc, lint, the full suite, and the CardCom package tests (`src/lib/payments/cardcom-*`, `package-*`).

## 1. Close the door (D1)

- [x] 1.1 Re-run the old-model inventory, and record it in this change as removable files, shared branches, comments, and false matches (`inventory.md`).
- [x] 1.2 Remove `model_outcome` from the admin package form. Make the packages action refuse `price_per_reached`. Make `createCampaign` require a package, and remove the no-package branch in `setupCampaignAction`. Verify: tests that a per-result package cannot be saved and a campaign cannot be created without a package; the package flow tests pass.

## 2. Remove the old model's code (D2)

- [x] 2.1 The hold: the `authorize` route, `prepareCampaignHold`, `lockCampaignForHold`, `sumit-hold-reconcile`, `sumit/authorize`, `crm-holds`, the hold form, and their jobs and tests. (`hold-status` and the `sumit-hold-changed` template serve the SUMIT card workflow trigger, so they move to 6.1.) Verify: no reference left; the payment page works for a package campaign.
- [x] 2.2 Close-charge and capture/release: the `close-charge` route, `close-charge.ts`, `close-charge-amount.ts`, `sumit/capture`, the queue job and schedule, and their tests. Verify: no reference left; the queue starts without the job.
- [x] 2.3 The signature agreement: `recordSignedAgreement`, `AgreementStep`, the phone-code step, and the outcome agreement document and admin page parts. Verify: the package terms approval still works; the 3 old campaigns' agreement records remain readable.
- [x] 2.4 The switches: the pricing-model and base+overage toggles, and the hold switch in code and admin settings. Verify: settings save; no reader of the switches left.
- [x] 2.5 Old-model branches in shared code: setup steps, campaign status and labels, event stats and summary, the manage page, cancellation money, admin campaigns and callbacks, the owner agent, the FAQ and public business facts. Verify: tests per screen for a package campaign and for an old campaign shown from the ledger (D6).
- [ ] 2.6 Comments and docs that describe the old model. Verify: a search for the old model's terms finds only history notes and this change.

## 3. Reached recording without old inputs (D3)

- [ ] 3.1 `npx supabase migration new`: `try_record_billed_result` stops reading `price_per_reached`, and `campaign_billing_summary` returns reach without a ceiling. Verify: in a rolled-back live block, recording a reach on a package campaign gives the same outcome as before; outreach and webhook tests pass.

## 4. Database functions (D4)

- [x] 4.1 `npx supabase migration new`: `campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums` and `test_event_purge_blocker` stop reading retired columns, and read the ledger where a fact is still needed. (`exposed_for_billing`, `has_service_exposure` and `purge_test_event` read no retired column — measured 11.10.2026.) Verify: cancelling a historical campaign and a CardCom campaign, the owner billing sums and a test purge give the same result before and after (in a rolled-back live block).

## 5. Compare and drop (D5)

- [x] 5.1 For every campaign that holds a value in any retired column at the time of the run, compare each value with its ledger rows. Differences are allowed only for the named card exception. Verify: the output is recorded in this change (`comparison-5-1.md`); the run stops if a campaign outside the exception holds a card value.
- [ ] 5.2 After the deploy of groups 1–4, and with the owner's approval for each group, create one drop migration per group, then regenerate the types:
  - `auth_*`, `authorized_at` — `20261011201543`
  - `capture_status`, `release_status` — `20261011201545`
  - `card_*` and `sumit_customer_id` — `20261027092539`, after their last readers (the SUMIT test page and `scripts/sumit-doc-check.ts`) were removed in 6.1 (Open Question 2, owner, 27.10.2026); pushed by the owner on 27.10.2026. Read back live the same day: none of the five columns is left on `campaigns`, and the ledger row holding `sumit_customer_id` is still there
  - `sumit_test_transactions` (the table of the retired diagnostic page) — `20261027092536`; pushed by the owner on 27.10.2026, read back live: the table is gone
  - `charge_*`, `charged_at`, `final_*` — `20261011201547`
  - `hold_order_*` — `20261011201549`
  - `sumit_*` — `sumit_order_document_id` and `sumit_charge_document_id` dropped in `20261027075846` (empty in every row, no reader, 27.10.2026); `sumit_customer_id` with the `card_*` group above
  - the old terms: `price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling` (on `campaigns` and `packages`), and `min_hold_floor`, `hold_buffer_pct` (on `packages`) — `20261011201551`
  - the switches and hold settings: `campaign_holds_enabled`, `base_overage_pricing_enabled`, `close_charge_enabled`, `reasonable_coverage_contacts`, `extreme_threshold_contacts`, `agr_charge_window_days`, `agr_hold_release_days` (on `app_settings`) — `20261011201553`
  - `billing_route` (Open Question 1) and its enum type — `20261011201555`
  - `credit_applied` (on `campaigns`; added by the owner 11.10.2026) — `20261011203216`, pushed only after the deploy of the ledger-only credit reader (`creditConsumedByCampaign`); the ledger holds the same credit for the two SUMIT campaigns

  Verify: tsc and the full suite pass; a live search of functions and views finds no reference.

## 6. SUMIT outside campaign payment

- [ ] 6.1 The SUMIT diagnostics (Open Question 2, owner, 27.10.2026: retired). Remove the `/admin/sumit-test` page and form, `/api/admin/sumit-test` and its test, `src/lib/data/admin/sumit-test.ts`, `src/lib/data/admin/sumit-test-transactions.ts`, `src/lib/sumit/safe-preview.ts` and `src/lib/sumit/charge-response.ts` with their tests, and `scripts/sumit-doc-check.ts`. Also remove the admin menu entry, the link on the integration page, their entries in `admin-data-layer-coverage.test.ts` and `knip.json`, and the comments that point at them. Keep `src/lib/sumit/raw-charge.ts`, which `scripts/sumit-charge-token.ts` still uses. Verify: a search of the repo finds no live reference to the removed files, routes or exports; the integration page test asserts the link is gone; typecheck, lint, the full suite and the build pass.
- [ ] 6.2 Every other SUMIT feature in Open Question 2 keeps its existing scope (owner, 27.10.2026): the backup purchase and refund, the card form, `sumit_customers`, the integration page and its settings, the daily health check, the workflows with `hold-status` and its template, and the `scripts/sumit-*` probes. Verify: the diff of 6.1 changes none of their files except the integration page's test-page link and comments.

Do not archive this change while a step above is open: the migration notes and comparison-5-1.md refer to its paths.
