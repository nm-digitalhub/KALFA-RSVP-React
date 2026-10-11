# Proposal

## Why

The sales agent ("Omer") offers a discount today, but nothing carries it into the purchase.
- `apply_discount_tier` returns a constant 5% (`src/app/api/voximplant/sls/tool/discount/[token]/route.ts:21`), saves nothing and returns no final price.
- `get_pricing` lists every package without an id, so a promise cannot be tied to one package.
- `createCampaign` and the CardCom purchase know nothing of a discount.
- So a promised discount cannot be honoured, and nothing proves who was promised what.

The price itself also has no guarded home. It lives in `campaigns.package_price`, one of 51 columns, and its approval is not atomic. `recordPackageApproval` (`src/lib/data/agreements.ts:364-457`):
1. reads the price;
2. renders and uploads the terms PDF;
3. inserts the `signed_agreements` row;
4. only then calls `approveCampaign`.

The price can change between step 1 and step 4. `approveCampaign` (`src/lib/data/campaigns.ts:549-559`) also does not check that its guarded update changed a row, so a lost race goes unnoticed after the agreement row is already stored.

## What Changes

- **Personal coupon assignments.** The sales agent (through a server tool) and staff can assign an offer to a specific customer, for one specific package:
  - The server computes the discount and the final price from a defined offer; the agent never does.
  - The agent may promise it only after the assignment is saved.
  - Repeating the same request never creates a second assignment.
  - The assignment freezes the offer's terms, the package and the price promised for it.
  - A coupon is not credit, and never touches `billing_credits` or `credit_applied`.
- **`campaign_pricing`.** A new table, one row per campaign: list price, discount, final price, the bound assignment, a version and `locked_at`. Once locked, the database refuses any change, unlock, re-key or delete of the row.
- **Atomic, versioned approval.** The terms PDF is rendered from one pricing version. One database function then does all of the following in a single transaction:
  - checks that this version is still current;
  - stores the signed agreement;
  - approves the campaign;
  - locks the price.

  If the price changed in the meantime, the approval is refused and new terms are rendered.
- **A defined migration of the price.** `campaigns.package_price` and `campaign_pricing` are kept equal by the database for the whole transition. Each phase names the one source of truth. The old column is dropped only after every reader has moved and equality is verified.
- **Binding, release and consumption are database operations.**
  - Binding an assignment writes the pricing in the same transaction.
  - Releasing one restores the list price in the same transaction, and only in the states where release is allowed.
  - Consumption is written in the same transaction that records the package payment as succeeded, so no gap between them can be left half done.
  - An unknown payment outcome never releases an assignment.
- **Settlement verifies the amount.** `settleCardcomSession` keeps its existing checks (success, `ChargeOnly`, transaction id, terminal) and adds amount and currency against the ledger row. A mismatch or a missing value goes to review and is never marked paid.
- **Screens.**
  - The customer sees an eligible offer where they choose a package, and is led to verify the phone it was promised to.
  - The customer is told plainly when an offer does not fit the package or has ended.
  - Staff can assign, void and follow an assignment, including one tied to a payment in review.
- **`apply_discount_tier` changes:**
  - it takes a package id, persists the assignment and returns the server's final price;
  - the objection reason and the outcome are recorded in the activity log through the service role (the tool has no user session);
  - the agent's configuration is updated through the sanctioned ElevenLabs flow (`agents pull --update` → edit → `agents push`).

## Capabilities

### New Capabilities
- `coupon-assignments`: how a personal offer is assigned to a customer for one package (by the sales agent or staff). Covers idempotency, frozen terms, eligibility, binding, release, consumption, and the screens.
- `campaign-pricing`: the price agreed for a campaign. Covers list price, discount and final price, versioned atomic approval, the lock and what it forbids, a single source of the price, and the transition from `campaigns.package_price`.
- `package-payment-settlement`: what a CardCom package payment must match, in addition to the existing checks, before it counts as paid, and what happens on a mismatch or missing data.

### Modified Capabilities
None. `openspec/specs/` has no capabilities yet.

## Impact

- **Database.** Each migration is created with `supabase migration new` and pushed only with the owner's approval:
  - `coupon_assignments`, its history, and `campaign_pricing` with its foreign key to `coupon_assignments`, all in one migration;
  - the sync, version, lock and consume triggers;
  - the bind, release and approve functions;
  - a copy of the existing prices;
  - a later migration that drops `campaigns.package_price` and the sync.
- **Code:**
  - `src/lib/data/campaigns.ts` (createCampaign, getCampaignForPurchase, approveCampaign, listPackageOffers)
  - `src/lib/data/agreements.ts` (recordPackageApproval) and the package agreement template (tokens for list price and discount)
  - `src/lib/payments/` (cardcom-purchase, cardcom-settle, package-purchase, package-paid, package-payment-screen)
  - the screens and readers that read `package_price` (20 files today)
  - the sales tools `src/app/api/voximplant/sls/tool/discount|pricing/[token]/route.ts`
  - the customer package-choice and phone-verification screens
  - a new admin surface for offers and assignments
- **Agent configuration:** `agent_configs/KALFA-Sales-Close.json`, through the sanctioned pull/push flow.
- **Legal wording:** the package terms document gains list price and discount lines. The wording is the owner's call.
- **Out of scope:**
  - public coupon codes (a later change);
  - SUMIT-era `campaigns` columns (`retire-sumit-campaign-columns`);
  - moving `contact_quota`.
