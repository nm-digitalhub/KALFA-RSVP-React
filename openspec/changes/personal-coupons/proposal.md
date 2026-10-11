# Proposal

## Why

The sales agent ("Omer") offers a discount today, but nothing carries it into the purchase.
- `apply_discount_tier` returns a constant 5% (`src/app/api/voximplant/sls/tool/discount/[token]/route.ts:21`), saves nothing and returns no final price.
- `createCampaign` and the CardCom purchase know nothing of it.
- So a promised discount cannot be honoured, and nothing proves who was promised what.

The price itself also has no guarded home. It lives in `campaigns.package_price`, one of 51 columns. Its value is copied into the package terms the customer approves (a PDF with a content hash). Yet nothing in the database stops a privileged server path from changing it after approval. Personal coupons need a place to record "list price, discount, final price", and that place is where the price-lock rule belongs.

## What Changes

- **Personal coupon assignments.** The sales agent (through a server tool) and staff can assign an offer to a specific customer:
  - The server computes the discount and the final price from the configured offer; the agent never does.
  - The agent may promise it only after the assignment is saved.
  - Repeating the same call never creates a second assignment.
  - The offer's terms are frozen in the assignment; a later change to the offer does not change it.
  - A coupon is not credit, and never touches `billing_credits` or `credit_applied`.
- **`campaign_pricing`.** A new table with one row per campaign holding the price agreed for that campaign:
  - final price (moved from `campaigns.package_price`)
  - list price
  - discount amount
  - the coupon assignment
  - `locked_at`, set when the customer approves the terms

  After `locked_at`, the database refuses any change to the row. Existing prices are copied over first. Every reader and writer then moves to it, with a check that the approved price equals the price sent to payment. Only after that is `campaigns.package_price` dropped, so there are never two sources of the price.
- **The discount is applied before the terms are approved.** It happens when the package is chosen. It is shown in the approved package terms as list price, discount and final price. CardCom still receives one positive product line at the final price, so no CardCom client or ledger change is needed for the discount itself.
- **Binding an assignment to a campaign is atomic and exclusive.** A database constraint stops two requests, or two campaigns, from taking the same assignment. An unknown payment outcome never releases it.
- **Settlement verifies the amount.** `settleCardcomSession` compares the amount and currency CardCom reports with the ledger row. A mismatch or a missing value goes to review and is never marked paid.
- **`apply_discount_tier` changes:**
  - it persists the assignment and returns the server's final price;
  - the objection reason and the outcome are recorded in the activity log through the service role (the tool has no user session);
  - the agent's configuration is updated through the sanctioned ElevenLabs flow (`agents pull --update` → edit → `agents push`).
- **SUMIT-era columns leave `campaigns`.** The SUMIT purchase is gated and no live SUMIT package payment exists, yet `campaigns` still carries 25 columns of the old authorise-and-capture model (`auth_*`, `capture_status`, `release_status`, `card_*`, `charge_*`, `hold_order_*`, `sumit_*`, `final_*`, `billing_route`). Every code and database reader moves off them first. Their history is kept before any column is dropped: no historical data is deleted as part of code cleanup, and no SUMIT transaction is refunded through CardCom. Each drop is a separate migration, approved by the owner.

## Capabilities

### New Capabilities
- `coupon-assignments`: how a personal offer is assigned to a customer (by the sales agent or staff). Covers who may assign and within which limits, idempotency, frozen terms, eligibility, binding to a campaign, and what releases or consumes an assignment.
- `campaign-pricing`: the price agreed for a campaign. Covers list price, discount and final price, the lock at terms approval, a single source of the price for terms, payment and screens, and how a coupon is shown in the approved terms.
- `package-payment-settlement`: what a CardCom package payment must match before it counts as paid — amount and currency against the ledger row — and what happens on a mismatch or missing data.
- `sumit-campaign-columns-retirement`: the SUMIT-era columns of `campaigns` stop being read and written, their history is preserved, and only then are they dropped.

### Modified Capabilities
None. `openspec/specs/` has no capabilities yet.

## Impact

- **Database.** Each migration is created with `supabase migration new` and pushed only with the owner's approval:
  - new tables `coupon_assignments` and `campaign_pricing`, with RLS, server-only writes, a lock trigger and exclusive-binding constraints;
  - a copy of the existing prices (7 campaigns live, 4 with a price);
  - a later migration that drops `campaigns.package_price`;
  - SUMIT columns: database functions updated first (`campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums`, `test_event_purge_blocker`), history preserved, then drop migrations per column group.
- **Code:**
  - `src/lib/data/campaigns.ts` (createCampaign, getCampaignForPurchase, approveCampaign)
  - `src/lib/data/agreements.ts` and the package agreement template (tokens for list price and discount)
  - `src/lib/payments/` (cardcom-purchase, cardcom-settle, package-purchase, package-paid, package-payment-screen)
  - the screens and readers that read `package_price` (20 files today)
  - the sales tools `src/app/api/voximplant/sls/tool/discount|pricing/[token]/route.ts`
  - a new admin surface to assign and void an offer
- **Agent configuration:** `agent_configs/KALFA-Sales-Close.json`, through the sanctioned pull/push flow.
- **SUMIT code paths:** every reader of the SUMIT columns (for example `capture_status` in about 22 source files, `charge_status` in about 16), including the gated SUMIT purchase route and admin billing screens.
- **Legal wording:** the package terms document gains list price and discount lines. The wording is the owner's call.
- **Out of scope:**
  - public coupon codes (a later change);
  - moving `contact_quota`.
