# Design

## Context

Read-only checks against the live database on 11.10.2026:
- Of the 7 campaigns live that day, 2 held SUMIT values. Both have matching ledger rows (provider `sumit`, succeeded):
  - an authorize row (152 and 200, with the auth reference; one with its document);
  - a release row;
  - a zero charge with `credit_applied` 84 and 200.
- These match `auth_amount`, `release_status`, `final_charge_amount` and `campaigns.credit_applied`.
- Not in the ledger:
  - `card_token_ref`, `card_exp_*` and `card_citizen_id` on both campaigns;
  - `sumit_customer_id` on one. It has since been copied (`20261011161441`).
- Columns empty on every campaign that day: `final_invoice_document_id`, `sumit_order_document_id`, `sumit_charge_document_id`, `charge_payment_id`, `charge_document_number`, `billing_route`.
- Database objects reading the columns: `campaigns_guard_cancel` and `cancel_campaign` (`capture_status`, `charge_status`); `owner_agent_billing_sums` (`charge_status`, `charged_at`, `final_charge_amount`); `test_event_purge_blocker` (several). No view reads them.

These counts are a snapshot. Every verification step re-measures them instead of assuming them.

## Goals / Non-Goals

**Goals:**
- One source of payment facts: the ledger.
- No history lost beyond the owner's named card exception.

**Non-Goals:**
- Changing `payment_operations` columns.
- `campaigns.credit_applied`, `contact_quota`, the old per-result terms (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`), and `tos_version`/`approved_*`. Each is checked in its own change.

## Decisions

**D1. Retire into the existing ledger, not a new table.** The ledger already holds the authorize, release and charge facts, and has columns for the rest. An archive table would be a third copy.

**D2. The card exception.** The card token, expiry and citizen ID are not copied (owner, 11.10.2026). Both authorisations were released and nothing was charged, and these are sensitive personal data. The spec states this exception and limits it to those columns.

**D3. The SUMIT customer id goes to `meta.sumit_customer_id`** of the campaign's SUMIT authorize row. `provider_account_id` is `integer`, and the value does not fit. Done in `20261011161441`.

**D4. Order.**
1. Move code readers to the ledger, and deploy.
2. Update the four database functions.
3. Compare every campaign's SUMIT values with its ledger rows.
4. Drop one approved group per migration.

A group is dropped only after a source search and a live search of functions and views both find no reference.

## Risks / Trade-offs

- **A reader is missed and breaks after a drop.** Mitigation: both searches in D4, and the drop follows the deploy of the code that stopped reading the column.
- **A cancellation path changes behaviour.** `cancel_campaign` and its guard read `capture_status` and `charge_status`. Mitigation: before-and-after tests on a historical SUMIT campaign and on a CardCom campaign.

## Migration Plan

As D4. Rollback before a drop: revert the code; the columns still hold their values. After a drop, a group is restored from the ledger, apart from the named card values.

## Open Questions

1. **`billing_route`.** It is empty on every campaign and has no reader. Drop it with the SUMIT groups, or separately?
