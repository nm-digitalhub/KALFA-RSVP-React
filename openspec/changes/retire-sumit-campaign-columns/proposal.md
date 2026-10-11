# Proposal

## Why

The SUMIT package purchase is gated, and no live SUMIT package payment exists. Yet `campaigns` still carries 25 columns of the old authorise-and-capture model:
- `auth_*`, `authorized_at`
- `capture_status`, `release_status`
- `card_*`
- `charge_*`, `charged_at`, `final_*`
- `hold_order_*`
- `sumit_*`
- `billing_route`

The payment ledger (`payment_operations`) already records the same facts. So `campaigns` is a second, stale source of payment state, and code still reads it (for example `capture_status` in about 22 source files, `charge_status` in about 16) as do four database functions.

This was split out of `personal-coupons` (owner, 11.10.2026), so each migration can be completed and verified on its own.

## What Changes

- Every code reader and writer of the 25 columns moves to the ledger, or is removed where the SUMIT path is gated.
- Four database functions stop reading the columns:
  - `campaigns_guard_cancel`
  - `cancel_campaign`
  - `owner_agent_billing_sums`
  - `test_event_purge_blocker`
- Before any drop, each campaign's SUMIT values are compared field by field with its ledger rows.
- Each column group is dropped by its own migration, after the owner approves that group.
- No SUMIT transaction is refunded, captured or released through CardCom.
- No historical data is deleted, except the owner's named card exception (see the spec).

Already done (migration `20261011161441`, applied and verified 11.10.2026): the one `sumit_customer_id` value was copied into `meta.sumit_customer_id` of that campaign's SUMIT authorize row.

## Capabilities

### New Capabilities
- `sumit-campaign-columns-retirement`: the SUMIT-era columns of `campaigns` stop being read and written, their history is kept in the ledger (with one named exception), and only then are they dropped.

### Modified Capabilities
None.

## Impact

- **Code:** the readers of the 25 columns in `src`, including the gated SUMIT purchase route, close-charge, cancellation and admin billing screens.
- **Database:**
  - one migration updating the four functions;
  - one drop migration per column group, each created with `supabase migration new` and pushed by the owner.
- **Types:** regenerated after each drop.
- **No change** to CardCom, the ledger's shape, or `personal-coupons`.
