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
- [ ] 2.5 Old-model branches in shared code: setup steps, campaign status and labels, event stats and summary, the manage page, cancellation money, admin campaigns and callbacks, the owner agent, the FAQ and public business facts. Verify: tests per screen for a package campaign and for an old campaign shown from the ledger (D6).
- [ ] 2.6 Comments and docs that describe the old model. Verify: a search for the old model's terms finds only history notes and this change.

## 3. Reached recording without old inputs (D3)

- [ ] 3.1 `npx supabase migration new`: `try_record_billed_result` stops reading `price_per_reached`, and `campaign_billing_summary` returns reach without a ceiling. Verify: in a rolled-back live block, recording a reach on a package campaign gives the same outcome as before; outreach and webhook tests pass.

## 4. Database functions (D4)

- [x] 4.1 `npx supabase migration new`: `campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums` and `test_event_purge_blocker` stop reading retired columns, and read the ledger where a fact is still needed. (`exposed_for_billing`, `has_service_exposure` and `purge_test_event` read no retired column — measured 11.10.2026.) Verify: cancelling a historical campaign and a CardCom campaign, the owner billing sums and a test purge give the same result before and after (in a rolled-back live block).

## 5. Compare and drop (D5)

- [ ] 5.1 For every campaign that holds a value in any retired column at the time of the run, compare each value with its ledger rows. Differences are allowed only for the named card exception. Verify: the output is recorded in this change; the run stops if a campaign outside the exception holds a card value.
- [ ] 5.2 After the deploy of groups 1–4, and with the owner's approval for each group, create one drop migration per group, then regenerate the types:
  - `auth_*`, `authorized_at`
  - `capture_status`, `release_status`
  - `card_*`
  - `charge_*`, `charged_at`, `final_*`
  - `hold_order_*`
  - `sumit_*`
  - the old terms: `price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling` (on `campaigns` and `packages`), and `min_hold_floor`, `hold_buffer_pct` (on `packages`)
  - the switches and hold settings: `campaign_holds_enabled`, `base_overage_pricing_enabled`, `close_charge_enabled`, `reasonable_coverage_contacts`, `extreme_threshold_contacts`, `agr_charge_window_days`, `agr_hold_release_days` (on `app_settings`)
  - `billing_route` (Open Question 1)

  Verify: tsc and the full suite pass; a live search of functions and views finds no reference.

## 6. SUMIT outside campaign payment

- [ ] 6.1 **[needs Open Question 2]** Per the owner's answer, remove or keep each SUMIT feature listed there. Verify: per decision.
