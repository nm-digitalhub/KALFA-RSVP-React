# 5.1 — Retired columns compared with the payment ledger

Run on 11.10.2026, 23:12 IDT, after the deploy of groups 1–4. Live database, read-only queries only. Card tokens, card expiry, citizen IDs, document URLs and the SUMIT external reference were compared for equality, never printed.

## Which campaigns hold values

| Campaign | Status | Package | What it holds |
|---|---|---|---|
| `15a8730e` | closed | — | SUMIT payment values, card values, old terms |
| `39334087` | closed | — | SUMIT payment values, card values, hold document, SUMIT customer id, old terms |
| `3e531968` | cancelled | — | old terms only (no money) |
| `75f69dc3`, `c94ae98e`, `6c4a41b4`, `ecd71462` | package campaigns | ₪200 / ₪1 | `0` in the old terms columns (written by the earlier createCampaign; no meaning) |

`billing_route`, `charge_auth_number`, `charge_payment_id`, `charge_document_number`, `charge_document_url`, `sumit_charge_document_id`, `sumit_order_document_id` and `final_invoice_document_id` are empty on every campaign.

## The two SUMIT campaigns against their ledger rows

Each has three succeeded `provider = 'sumit'` rows: `authorize`, `release`, `charge`.

| Column | Ledger | `15a8730e` | `39334087` |
|---|---|---|---|
| `auth_amount` | `authorize.amount` | equal (₪152) | equal (₪200) |
| `auth_number` | `authorize.provider_auth_ref` | equal (`0759469`) | **equal after trim**: the column holds `' 055528'` (a leading space), the ledger `'055528'` |
| `auth_external_ref` | `authorize.meta.auth_external_ref` | equal | equal |
| `authorized_at` | `authorize.occurred_at` | equal | equal |
| `capture_status = 'authorized'` | the `authorize` row | present | present |
| `release_status = 'released'` | the `release` row | present | present |
| `charge_status = 'nothing_to_charge'` | the `charge` row, amount ₪0 | present | present |
| `charged_at` | `charge.occurred_at` | equal | equal |
| `final_charge_amount` | `charge.amount` | equal (₪0) | equal (₪0) |
| `credit_applied` | `charge.credit_applied` | equal (₪84) | equal (₪200) |
| `hold_order_document_id` / `_number` / `_url` | `authorize.provider_document_id` / `_number` / `_url` | empty | equal (2327129322 / 1005 / url) |
| `sumit_customer_id` | `authorize.meta.sumit_customer_id` | empty | equal (copied by 20261011161441) |

Every payment value outside the card exception is retrievable from the ledger. The one textual difference is the leading space in `39334087.auth_number`; the ledger keeps the same reference without it.

## The card exception

- Campaigns holding any card value: **2**, both SUMIT holds released with nothing charged (`release_status = 'released'`, `charge_status = 'nothing_to_charge'`). Campaigns outside the exception holding a card token or citizen ID: **0**. The run does not stop.
- The card token and the citizen ID are **not** in the ledger, as the exception requires.
- **The card expiry IS in the ledger**: both `authorize` rows carry `card_exp_month` / `card_exp_year`, equal to the campaign columns (copied by the earlier ledger backfill, before the owner's decision of 11.10). The exception says the expiry is not copied. **Owner, 11.10.2026: leave it in the ledger** (not removed from the two rows).

## Values with no ledger counterpart (kept here as history)

Old terms, not payment facts:

| Campaign | `price_per_reached` | `base_price` | `included_reached` | `max_charge_ceiling` | `max_contacts` (kept) |
|---|---|---|---|---|---|
| `15a8730e` | 4 | 0 | 0 | 152 | 38 |
| `39334087` | 4 | 200 | 200 | 200 | 0 |
| `3e531968` | 4 | 200 | 200 | 200 | 0 |

`packages`: all three packages hold `price_per_reached`, `base_price`, `included_reached` empty, and `min_hold_floor` = 0, `hold_buffer_pct` = 0.

`app_settings`: `campaign_holds_enabled` true, `base_overage_pricing_enabled` true, `close_charge_enabled` true, `reasonable_coverage_contacts` 300, `extreme_threshold_contacts` 400, `agr_charge_window_days` "30", `agr_hold_release_days` "14". No code reads any of them.

## Readers that still block a drop

Measured with `node scripts/find-legacy-campaign-payment-columns.mjs --no-tests --db`:

- **Database:** only the CHECK constraints on `capture_status`, `charge_status` and `release_status` (they go with the columns).
- **`card_*` and `sumit_customer_id`:** the SUMIT test page (`src/lib/data/admin/sumit-test.ts`) and `scripts/sumit-doc-check.ts` read them from `campaigns`. Both belong to Open Question 2: these two groups wait for it.
- **`credit_applied`:** `src/lib/data/billing.ts` and `src/lib/data/admin/users.ts` read it (through `credit-consumed.ts`) as the fallback for a campaign with no ledger row. It is a payment column the ledger already holds for both SUMIT campaigns (₪84, ₪200); every other campaign holds 0. **Owner, 11.10.2026: add it to the drops.** The credit reader now reads the ledger only; the column is dropped after that code is deployed.
- Every other retired column: no reader.
