# Plan — Persist SUMIT `CustomerID` for J5/J4 reconciliation

Status: **DRAFT — awaiting approval** (billing / cross-cutting → plan-then-approve per CLAUDE.md)
Date: 2026-07-14
Related memory: `sumit-charge-verified-behavior`, `outcome-billing-model`

## Problem

A J5 authorize-only hold in SUMIT is **not re-queryable by any endpoint** (`Payment.ID:0`;
`payments/list`, `payments/get`, `creditguy/gateway/gettransaction` all return "not found" —
verified live 2026-07-14 for the brit hold, campaign `15a8730e`).

The **only** durable lookup for the payer + saved card is
`POST /billing/paymentmethods/getforcustomer/` `{Customer:{ID:<CustomerID>}}`, which needs the
SUMIT **CustomerID**.

The J5 response DOES return it as `Data.CustomerID` ("Customer number"), but `authorize.ts`
drops it — the `Resp.Data` type omits `CustomerID`, and the charge sends
`Customer:{EmailAddress, ExternalIdentifier}`, never `Customer.ID`.

**Impact:** holds are not reconcilable/auditable after the fact, and we can't charge via the
canonical `Customer:{ID}` path — we rely on email + our own UUID + the raw token.

> Note: this is a **reconciliation/robustness** fix, NOT a blocker for charging. The existing
> token-based charge (`capture.ts` → saved `CreditCard_Token`) already works a month+ later and
> is unaffected.

## Scope

Persist `Data.CustomerID` (and `Data.Payment.PaymentMethod.ID`) from the J5 response onto the
campaign; optionally use `Customer:{ID}` as a more robust charge path.

## Changes

### 1. Migration (schema)
`supabase migration new add_campaigns_sumit_customer_id`
```sql
alter table public.campaigns
  add column if not exists sumit_customer_id       bigint,
  add column if not exists sumit_payment_method_id bigint;
comment on column public.campaigns.sumit_customer_id is
  'SUMIT Customer number (Data.CustomerID from the J5 authorize response). Canonical payer anchor for getforcustomer + Customer:{ID} charging.';
```
- Nullable, additive, no backfill required (existing brit row can be backfilled manually with
  `2127277236` / `2127277247` if desired — separate one-off, not in this migration).
- No RLS change (campaigns policies already cover these columns; not client-exposed).

### 2. Regenerate types
`supabase gen types typescript --linked > src/lib/supabase/types.ts`
(NEVER hand-edit — per `no-hand-editing-generated-artifacts`.)

### 3. `src/lib/sumit/authorize.ts`
- Extend `Resp.Data` type: add `CustomerID?: number | null` and
  `Payment.PaymentMethod.ID?: number | null` (already partially typed).
- Extend `SumitAuthorizeResult` (line 18): add `sumitCustomerId: number | null`,
  `sumitPaymentMethodId: number | null`.
- In the return block (line ~151): read `json.Data?.CustomerID ?? null` and
  `payment?.PaymentMethod?.ID ?? null` via the existing `toInt` helper.

### 4. `src/app/api/campaigns/[id]/authorize/route.ts`
- Pass `sumitCustomerId` / `sumitPaymentMethodId` from `holdResult` into `recordCampaignHold`.

### 5. `src/lib/data/campaigns.ts` — `recordCampaignHold` (line 377)
- Add `sumitCustomerId: number | null`, `sumitPaymentMethodId: number | null` to the `hold` arg.
- Write `sumit_customer_id` / `sumit_payment_method_id` in the `.update({...})`.

### 5b. `src/lib/data/close-charge.ts` — charge-≤-hold guard (belt-and-suspenders)
SUMIT rule: a J5 hold authorizes only up to its amount — you cannot charge MORE than the held
frame (to charge more you must place a FRESH J5 at the higher amount, then J4). Our design
already guarantees `charge ≤ hold` structurally via the recipient-freeze SAFETY INVARIANT
(`prepareCampaignHold`, campaigns.ts:535: `reached ⊆ frozen set ⇒ charge ≤ frozenSetSize×price ≤
hold`; note `max_charge_ceiling = full×price` MAY exceed the hold, but the actual charge is bounded
by the frozen set, not the ceiling). Charge < hold is fine (verified: partial J4 on token).

Add an explicit assertion so the invariant is ENFORCED at charge time, not merely relied upon:
- Before calling `captureHeldCardSumit`, if `amount > campaign.auth_amount` → do NOT charge.
  Route to `charge_review` (`markCampaignChargeOutcome`) + ops alert. Never charge over the held
  frame.
- On such a breach the correct recovery is a FRESH J5 at the higher amount then J4 (SUMIT's
  prescribed flow) — surface it for admin action; do not auto-charge-over-hold.
- This backstops the recipient-freeze P0 ([[campaign-recipient-freeze-p0]] — a guest added after
  the freeze): if the freeze invariant were ever violated so `reached` exceeded the frozen set,
  this guard prevents charging above what was authorized.

### 6. (Optional, follow-up) `src/lib/sumit/capture.ts`
- When `sumit_customer_id` is present, send `Customer:{ ID: sumitCustomerId }` (canonical payer)
  alongside the token. Keep the token path as the primary/fallback (it is verified working and
  charges a fresh J4). Guard behind presence so pre-fix holds still charge via token only.
- Low priority — do NOT change the working charge config (AutoCapture:true, OMIT VATRate, OMIT
  CreditCardAuthNumber) per `sumit-charge-verified-behavior`.

## Risks

- **Type regen churn:** `gen types` may reorder/rewrite unrelated bits of `types.ts`. Review the
  diff to ensure only the two new columns changed.
- **Response shape assumption:** `Data.CustomerID` confirmed present in the live J5 response
  (brit) + swagger (`Payments_Charge_Response.CustomerID` "Customer number"). Read defensively
  (`?? null`) — a null must NOT fail the hold (it's additive metadata, not required to charge).
- **PII scope:** `sumit_customer_id` / `sumit_payment_method_id` are opaque SUMIT ids, not PII —
  fine to store/log as reconciliation anchors (unlike CitizenID/token).

## Verification

1. `npm run lint` · `npx tsc --noEmit` · `npm run build --webpack` (all must pass).
2. Focused: `authorize.ts` adapter test (mock a J5 response incl. `Data.CustomerID` → assert it
   flows to `recordCampaignHold`); `recordCampaignHold` writes both columns.
3. Live J5 sanity: a real hold **cannot** run headless (logActivity → cookies) — defer to an
   authed browser test flow, or backfill+verify the existing brit row via `getforcustomer`.
4. Confirm the token-based charge path is unchanged (no diff to `capture.ts` body if §6 deferred).

## Table decision (investigated 2026-07-14 via 2 subagents)

**No dedicated SUMIT payment/charge/hold/transaction/audit table exists** in any schema —
nothing to reuse (`payment_events` confirmed absent; charge/hold data lives ONLY as columns on
`campaigns`, overwritten in place). Closest precedents `billed_results` (per-contact billing
evidence) and `activity_log` (generic jsonb audit) do NOT model SUMIT transactions.

**Cardinality is NOT 1:1.** Holds and charges are retryable at the attempt level —
`lockCampaignForHold`/`lockCampaignForCharge` (campaigns.ts:362, :603) match
`null`/`*_failed`/`*_review`; `authorize/route.ts:162` mints a **fresh `authRef` UUID per
attempt**; `markCampaignHoldFailed`/`markCampaignChargeOutcome` only flip the status enum. So the
`campaigns` columns keep only the LAST attempt — a declined attempt preceding a successful charge
is not reconstructable from the DB (only Slack/logs). This is a standing **audit gap** vs
CLAUDE.md's "preserve auditability for payment state changes".

**Decision → two phases, NOT either/or:**
- **Phase A (this plan):** add the 2 columns to `campaigns`. Same "current authorized state"
  semantics as `card_token_ref`/`card_exp_*`/`card_citizen_id`. Minimal, unblocks reconciliation
  + `Customer:{ID}` charging. Does NOT fix the audit gap.
- **Phase B (separate plan + approval — tracked, not blocking):** append-only `payment_events`
  (`campaign_id, kind hold|charge, attempt_ref, outcome authorized|declined|review|charged,
  sumit_customer_id, sumit_payment_method_id, amount, raw_response REDACTED (no PAN/CVV/token/
  CitizenID), created_at`), written ALONGSIDE the campaigns columns (which stay as the fast
  "current state" cache). Closes the audit gap without disturbing the idempotency-lock logic.
  Cross-cutting (new table + RLS + every write call-site) → own written plan + approval.

## Charge-over-hold flow (designed 2026-07-14 via code-architect subagent)

SUMIT: a J5 authorizes only up to its amount; charging MORE needs a FRESH J5 at the higher
amount, then J4. Below is the flow for when `final_amount > auth_amount`.

### Breach analysis (can it happen?)
- **Bounded today, not impossible.** `funded_cap = least(max_contacts, floor(auth_amount/price))`
  (migration `20260712115459_billing_exposure_funded_cap.sql:72-80`) keeps `accrued ≤ auth_amount`
  when the exposure gate is on; the freeze membership gate caps it when off. `price_per_reached`
  is locked post-approval; `max_charge_ceiling` only (re)computed inside `prepareCampaignHold`.
  `billed_results.manual_adjustment` is currently DEAD (written/read nowhere) — a future admin
  adjustment tool summing it into `accrued` would open a live breach path (flag for that feature).
- **The live gap:** `close-charge.ts:96` caps at `min(accrued, ceiling)` — `ceiling` (full×price)
  is NOT the hold. When `covered < full` the hold `auth_amount < ceiling`, so if the cap machinery
  is ever bypassed/misconfigured, close-charge would charge up to `ceiling > auth_amount`.
  `CHARGE_COLUMNS` (campaigns.ts:583) doesn't even select `auth_amount` → guard uncodable until fixed.

### Consent distinction (§14ג — critical)
`max_charge_ceiling` is what the customer SIGNED (rendered into the agreement PDF, `agreements.ts:159`).
`auth_amount` (J5) is a security instrument sized to `covered`, legitimately ≤ ceiling.
- **Case (a): `auth_amount < amount ≤ ceiling`** — WITHIN the signed contract; customer already
  consented. Only a technical SUMIT gap → fresh J5 then J4. **This is the only case the flow handles.**
- **Case (b): `amount > ceiling`** — OUTSIDE consent = §14ג violation. Already structurally
  impossible (`min(accrued, ceiling)` caps it). Add a defensive assert; if ever detected →
  hard-stop, NO re-hold, escalate as data-integrity incident.

### Decision: (A) exception → admin-triggered, CUSTOMER-PRESENT re-hold. NOT auto.
- **Not (B) auto re-hold:** a J5 authorize needs a fresh client-side `SingleUseToken` (og-token from
  the browser SDK at card presence) — `authorizeHoldSumit` requires it; the stored `CreditCard_Token`
  proves headless *capture* (J4) works, but there is **no verified path to place a fresh J5 headless
  from a stored token**. Do not build on that unverified assumption. Auto-raising a customer's
  authorization silently mid-charge is also poor §14ג practice.
- **Not (C) charge-up-to-hold + flag:** permanently under-collects owed revenue with no recovery.
- **(A) matches KALFA's existing `hold_review`/`charge_review` retry-tolerant, admin-gated pattern.**

### Flow / state machine
New `charge_status` value **`hold_insufficient`** (vocabulary at campaigns.ts:331).
```
close-charge: amount = min(accrued,ceiling) − credits
  amount ≤ 0            → nothing_to_charge
  amount ≤ auth_amount  → captureHeldCardSumit (J4) → charged / charge_failed / charge_review
  amount > auth_amount  → hold_insufficient   ← NEW GUARD, terminal-pending-admin (NO charge)
        │
        ▼  admin reviews (blocked-money alert), triggers "request re-authorization"
        │  → owner-facing reauth route re-runs the J5 hold flow at the new amount
        │    (customer present, fresh SingleUseToken; replaces the hold, updates auth_amount,
        │     keep prior_auth_amount for audit)
        ▼
  charge_status reset to null → re-enter close-charge → now amount ≤ auth_amount → J4 → charged
```

### Code touch-points
- `campaigns.ts:583` — add `auth_amount` to `CHARGE_COLUMNS` / `CampaignChargeState` (**prerequisite**).
- `close-charge.ts` (~after the `amount ≤ 0` check, before `lockCampaignForCharge`) — the guard:
  `if (amount > (campaign.auth_amount ?? 0)) → markCampaignChargeOutcome(id,'hold_insufficient')
   + error alert (category campaign_billing) + return {outcome:'hold_insufficient', amount}`.
- `close-charge.ts:25-34` `CloseChargeOutcome.outcome` union + `campaigns.ts:646` `markCampaignChargeOutcome`
  outcome union → add `'hold_insufficient'` (tsc will flag exhaustive consumers; audit if/else at
  `close-charge` route + tests `src/app/api/campaigns/[id]/close-charge/route.test.ts`).
- `closeCampaignAndCharge` must treat `hold_insufficient` as **terminal-pending-admin** (return
  immediately, do NOT re-lock) so a bare retry can't loop; only the reauth route resets to `null`.
- **Re-hold recovery route (bigger — own sub-phase):** owner-facing `/app/events/[id]/campaign/
  [campaignId]/reauth` reusing the `authorize/route.ts` hold flow with `amount` pre-set; email the
  owner a link (agreement-email pattern); gate identically (holds-enabled, ownership, allowed-origin).
  Extend `recordCampaignHold` to keep `prior_auth_amount`.
- Defensive assert `amount ≤ ceiling` (case b fail-closed).

### Open verifications BEFORE building the recovery route
1. Confirm with SUMIT whether a J5 `AuthorizeAmount` can be placed server-side from a stored
   `CreditCard_Token` (no fresh SingleUseToken). If yes → re-hold can be admin-triggered-headless
   (lower friction, same state machine). If no → customer-present reauth as specced.
2. `campaigns.auth_expires_at` exists but is never written/read — populate at hold time + check
   staleness (a stale hold is a distinct failure mode from "hold too small").

### Verification (tests)
- `close-charge.test.ts`: accrued > mocked `auth_amount` but ≤ `ceiling` → assert
  `outcome:'hold_insufficient'`, `markCampaignChargeOutcome('hold_insufficient')`,
  `captureHeldCardSumit` NEVER called. Plus a case that `amount ≤ ceiling` cap still holds (case b).
- lint / tsc / build (union widening forces consumer updates).

### Phasing
- **A1 (fail-closed guard, small, ship first):** add `auth_amount` to CHARGE_COLUMNS + the guard +
  `hold_insufficient` state + alert + tests. Pure protection — never charges over the frame.
- **A2 (recovery route, bigger, own approval):** owner reauth flow + admin trigger, AFTER the two
  open verifications above.

## Out of scope
- Changing the charge model (fresh J4 on saved token stays).
- Building a J5 "status" surface (no such SUMIT endpoint exists).
- Recurring/standing-order retry behavior.
- Phase B (`payment_events` audit table) — its own plan; do not bundle here.
