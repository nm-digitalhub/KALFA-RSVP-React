# Proposal

## Why

KALFA sells fixed-price packages, paid once through CardCom. The earlier pay-per-result model is still in the code:
- a SUMIT card hold (J5) at approval;
- a signed agreement with a phone code;
- a charge at close, from the reached contacts, up to a ceiling.

It can no longer start (verified live, 11.10.2026):
- no active package has a per-result price, so `resolveCanonicalTemplate` refuses to create such a campaign;
- the hold route refuses any package campaign;
- the 3 old campaigns are finished: 2 closed with the hold released and nothing charged, 1 cancelled.

The admin package form still offers the per-result model (`model_outcome`), so a staff member could bring it back. Its code, comments, switches and 25 SUMIT-era `campaigns` columns remain. The owner decided on 11.10.2026 to remove the old model completely, code and comments, with CardCom as the payment provider.

## What Changes

- **Close the door.**
  - The admin package form loses the per-result option.
  - Saving a package with a per-result price is refused.
  - Creating a campaign without a package is refused.
- **Remove the old model's code paths:**
  - the hold route, hold preparation, hold reconcile and CRM holds;
  - close-charge (route, job, amount) and capture/release;
  - the signature agreement step with its phone code, and the outcome agreement document;
  - the base+overage pricing toggle;
  - the old-model branches in setup steps, labels, stats, the payment page, the manage page, cancellation, the owner agent and the FAQ;
  - the comments that describe any of these.
- **Keep what packages use:**
  - reached-contact recording (`recordReached` → `try_record_billed_result`) and the contact status `reached_billed`, which package campaigns also go through;
  - the CardCom purchase, settlement and refund;
  - the payment ledger.
- **Database.**
  - The functions that read old-model columns move off them.
  - The old model's switches and per-result package columns are listed for removal.
  - The 25 SUMIT-era `campaigns` columns and the old terms columns are dropped, one approved group per migration, after the code that read them is deployed.
- **History.**
  - The ledger keeps the old campaigns' payment facts. The SUMIT customer id was copied in `20261011161441`.
  - No SUMIT transaction is refunded, captured or released through CardCom.
  - The card token, expiry and citizen ID of the released, uncharged campaigns are not kept (owner, 11.10.2026).

## Capabilities

### New Capabilities
- `sumit-campaign-columns-retirement`: the pay-per-result model can no longer be created and its code is removed; the SUMIT-era columns stop being read, their history is kept in the ledger (with one named exception), and only then are they dropped; the CardCom package flow keeps working unchanged.

### Modified Capabilities
None.

## Impact

- **Code:** about 110 source files reference the old model, many through a single branch or comment (map in design.md). The CardCom package flow (`src/lib/payments/cardcom-*`, `package-*`) changes only where it reads a retired column.
- **Database:**
  - functions updated: `campaign_billing_summary`, `campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums`, `test_event_purge_blocker`, `try_record_billed_result` (to stop copying `price_per_reached`), and `exposed_for_billing`/`has_service_exposure` where they read old terms;
  - drop migrations per approved group;
  - every migration is created with `supabase migration new` and pushed by the owner.
- **Admin:** the package form, settings (pricing-model toggle, hold switch), the SUMIT test page and the agreement page.
- **Customer screens:** setup steps, the payment page (hold form), the manage page, the stats page and the event summary.
- **Out of scope until decided:** SUMIT features that are not campaign payment (design.md, Open Question 2).
