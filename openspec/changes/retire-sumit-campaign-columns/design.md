# Design

## Context

Read-only checks against the live database and main at 2741b04d, on 11.10.2026. Counts are a snapshot; every verification step re-measures them.

**The old model cannot start**
- `packages`: 3 active, 0 with `price_per_reached`. `listCampaignTemplates` filters `active` and `price_per_reached is not null`, so `resolveCanonicalTemplate` throws, and `createCampaign` without a package fails.
- `createCampaign` reaches the old branch only when `listPackageOffers()` is empty (`campaign-actions.ts:103-104`).
- The hold route refuses `package_price != null` before anything is locked (`authorize/route.ts:96-100`).
- Campaigns without a package: 2 `closed` (hold `authorized`, charge `nothing_to_charge`, release `released`) and 1 `cancelled`.
- Switches still on: `payments_enabled`, `campaign_holds_enabled`.

**What packages share with the old model**
- `recordReached` (`billing.ts`) is called by the outreach engine and the webhook processing for every campaign. It calls `try_record_billed_result`, which writes `billed_results` (with `locked_price` copied from `price_per_reached`, 0 for packages) and sets the contact to `reached_billed`.
- `reached_billed` is read by the guest list, the delivery view and the manage page.
- `billed_results`: 23 rows, all on old campaigns; none yet on package campaigns.
- `getCampaignCreditTotal` (`billing.ts`) is used by both CardCom and SUMIT package purchase.

**Database objects reading old-model columns**

| Function | Columns |
|---|---|
| `campaign_billing_summary` | `billed_results`, `max_charge_ceiling` |
| `campaigns_guard_cancel`, `cancel_campaign` | `billed_results`, `capture_status`, `charge_status` |
| `owner_agent_billing_sums` | `charge_status`, `final_charge_amount` |
| `test_event_purge_blocker` | several SUMIT columns |
| `try_record_billed_result` | `price_per_reached` |
| `exposed_for_billing`, `has_service_exposure`, `purge_test_event` | `billed_results` |
| `integrations_configured_flags` | SUMIT settings |

**Code footprint:** 111 non-test source files and 76 test files match the old model's names. The match list is in the scratch inventory, to be re-run in task 1.1. They group as:
- removable whole files: hold, close-charge, capture, crm-holds, hold-status, hold reconcile, the hold form, the agreement step, the SUMIT test page, the pricing-model toggle;
- branches inside shared files: setup steps, labels, stats, payment page, manage page, cancellation, owner agent, FAQ, settings, package form;
- comments only;
- false matches: generated CardCom, SUMIT and WhatsApp models.

**Already done:** `20261011161441` copied the one `sumit_customer_id` into the ledger.

## Goals / Non-Goals

**Goals:**
- No way, in code or admin, to create or bill a pay-per-result campaign.
- No old-model code or comment left, except history read from the ledger.
- The CardCom package flow, reached-contact recording and the ledger keep working unchanged.
- The SUMIT-era columns are dropped, with their history kept as the spec requires.

**Non-Goals:**
- Changing the CardCom flow beyond the retired columns it reads.
- Deleting `billed_results` or `reached_billed` while package campaigns use them (D3).
- SUMIT features that are not campaign payment, until Open Question 2 is answered.

## Decisions

**D1. Close the door first.** Before any removal:
- the package form loses `model_outcome`;
- the packages action refuses `price_per_reached`;
- `createCampaign` requires a package.

The old path then cannot be reached, even while its code still exists.

**D2. Remove by group, each group shipped and tested on its own:**
1. the hold (route, preparation, reconcile, CRM holds, hold status, hold form);
2. close-charge and capture/release (route, job, amount, queue schedule);
3. the signature agreement and the outcome agreement document;
4. the pricing-model and base+overage switches, and the hold switch;
5. old-model branches in shared screens and data;
6. comments and docs.

After each group: tsc, lint, the full suite, and the CardCom package tests.

**D3. Reached-contact recording stays, without old-model inputs.**
- `try_record_billed_result` stops copying `price_per_reached`, and records reach only.
- `billed_results` and `reached_billed` keep their names in this change. Renaming them is a separate change.

**D4. Database functions move off old columns before any drop.**
- `cancel_campaign` and its guard decide by the ledger and the campaign status.
- `campaign_billing_summary` returns reach without a ceiling.
- `owner_agent_billing_sums` reads the ledger.
- The purge blocker checks the ledger.

Each is verified before and after, on a historical campaign and on a CardCom campaign.

**D5. Drops are last, per group, approved.** The group list is in tasks 5.1. The card exception is limited, as the spec states. The old terms columns (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`) are dropped after `try_record_billed_result` and every reader stop using them.

**D6. History.** The old campaigns' payment facts are read from the ledger. A screen that showed them from `campaigns` either reads the ledger or stops showing them.

## Risks / Trade-offs

- **A shared path breaks.** Mitigation: D3 keeps reached recording, and the CardCom and outreach tests run after every group.
- **An old campaign's page breaks.** Mitigation: the 3 old campaigns are opened in a test after each group, and their screens read the ledger.
- **A large change.** Mitigation: the D2 groups are separate commits; nothing is dropped until the code that read a column is deployed.

## Migration Plan

D1, then the D2 groups, then D4, then the ledger comparison, then the D5 drops. Rollback before a drop: revert the code. After a drop: restore from the ledger, except the named card values.

## Open Questions

1. **`billing_route`.** It is empty on every campaign and has no reader. Drop it with the SUMIT groups (recommended), or separately?
2. **SUMIT outside campaign payment.** These are not part of the pay-per-result model:
   - the gated SUMIT package purchase and refund (`purchase/route.ts`, `package-purchase.ts`, `package-refund.ts`);
   - the SUMIT integration page and health check;
   - the SUMIT customers table;
   - the workflow nodes that create SUMIT documents and react to SUMIT card events.

   Remove them too, now that CardCom is the provider, or keep them?
