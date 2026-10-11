# Tasks

## 1. Readers move to the ledger

- [ ] 1.1 Map every reader and writer of the 25 columns in `src`. Move each to the ledger (`payment_operations`), or remove it where the SUMIT path is gated. Do not route any SUMIT refund, capture or release through CardCom. Verify: tests per moved reader; `grep` finds no reader of the retired columns outside the generated types; tsc and the full suite pass.

## 2. Database functions

- [ ] 2.1 `npx supabase migration new`: update `campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums` and `test_event_purge_blocker` to stop reading the columns, reading the ledger where a fact is still needed. Verify: cancelling a historical SUMIT campaign and a CardCom campaign, and the owner billing sums, give the same result before and after (in a rolled-back live block).

## 3. Compare with the ledger

- [ ] 3.1 For every campaign that holds a value in any of the 25 columns at the time of the run (re-measured, not assumed to be 2), compare each value with its ledger rows. Differences are allowed only for the named card exception. Verify: the comparison output is recorded in this change; the run stops if a campaign outside the exception holds a card value.

## 4. Drop, one approved group at a time

- [ ] 4.1 After the deploy of groups 1–2, and with the owner's approval for each group, create one drop migration per group:
  - `auth_*`, `authorized_at`
  - `capture_status`, `release_status`
  - `card_*`
  - `charge_*`, `charged_at`, `final_*`
  - `hold_order_*`
  - `sumit_*`
  - `billing_route` (per Open Question 1)

  Regenerate the types after each. Verify: tsc and the full suite pass; a live search of functions and views finds no reference.
