# Design

## Context

What exists today was verified on main at f45af75 and against the live database (read-only, 11.10.2026); see proposal.md for why.

**The sales agent's discount tool**
- `apply_discount_tier` returns a constant `{tier:'tier_1', amount_or_pct:5}` and discards the objection reason (`discount/[token]/route.ts:21,52-63`).
- `log_outcome` accepts `discount_tier_applied` but does not persist it.
- `get_pricing` reads the package catalogue (`listPackageOffers`) and writes nothing.
- Tool identity is the resolved `sales_call_attempts` row, through `guardSalesToolRequest`. There is no user session.

**Identity**
- `callback_requests` has no `user_id`.
- The only link from a call to an account is `profiles.sales_referral_attempt_id`, which the account owner can set (grants plus `own_profile_write`). It is not proof.
- A verified phone (`auth.users.phone` with `phone_confirmed_at`, unique) proves control of the number. Read it with `verifiedPhoneOf` / `readVerifiedPhone`. Live, 1 of 6 accounts has one, and purchase does not require it.

**Price**
- `createCampaign` copies `packages.price_with_vat` into `campaigns.package_price` and sets `template_id`.
- `recordPackageApproval` renders that price into the package terms (a PDF with `content_hash`) and calls `approveCampaign`.
- No trigger locks the price afterwards.
- `campaigns` has broad table grants for anon and authenticated, but RLS allows SELECT only. The remaining risk is a privileged server path, not the browser.
- `package_price` is read or written in 20 source files. No database function or view reads it (live).

**Payment**
- `startCardcomPurchase` writes the PENDING ledger row and its line before `LowProfile/Create`.
- `buildCreateLowProfile` refuses a non-positive product line. That is our builder's rule, not a proven CardCom limit.
- A pending session is resumed with the amount it was opened with.
- `settleCardcomSession` checks success, `ChargeOnly`, the transaction id and the terminal. It does not check the charged amount.
- GetLpResult carries `TranzactionInfo.Amount` and `CoinId` (seen live on 11.10.2026).

**Ledger**
- `payment_operations` and `payment_operation_lines` have no grants for anon or authenticated (live).
- `payment_operations_check_lines` forces `credit_applied = -sum(negative lines)`, so any negative line is credit.

**Audit**
- `logActivity` needs a user session. Session-less paths insert with the service role (`recordSalesDialAudit`, `afterPaid`).
- Packages are managed under `manage_billing`; credits under `manage_staff`.

## Goals / Non-Goals

**Goals:**
- A discount that the server computes, that is saved before it is promised, and that reaches the approved terms and the charge unchanged.
- One guarded home for the campaign price, locked at approval.
- A payment is recorded as paid only when CardCom confirms the amount we asked for.

**Non-Goals:**
- Public codes typed at checkout (a later change; they will create an assignment of the same kind).
- Removing SUMIT-era columns from `campaigns`. That belongs to the SUMIT retirement change; see "Neighbouring cleanup".
- Moving `contact_quota`. It also limits contacts and activity, so moving it would widen this change.
- A new CardCom client, mutator or ledger.

## Decisions

**D1. The discount is fixed when the package is chosen, before the terms are approved.** Doing it at payment time would charge a price other than the one in the approved, hashed terms. Doing it after approval would need a second approval. Alternatives:
- a negative ledger line at payment: rejected, because it is counted as credit;
- adjusting the CardCom amount only: rejected, because the approved price would differ.

**D2. `campaign_pricing`, one row per campaign.** Columns:
- `campaign_id` (PK and FK)
- `package_price` (the final price, moved from `campaigns`)
- `list_price`
- `discount_amount`
- `coupon_assignment_id` (nullable, unique)
- `locked_at`

It gives the price-lock rule a table of its own, and keeps discount fields out of the 51-column `campaigns`. Splitting `campaigns` further is not done here. It brings no performance benefit by itself; the gain is separation and protection.

**D3. `coupon_assignments` stays separate.** An offer exists before any campaign, for example promised on a call before signup. It holds:
- the source (`sales_call_attempt_id` or `assigned_by` staff user)
- the target (`user_id`, or `phone_e164` until claimed)
- the frozen terms (kind, value, package scope, list price and final price at assignment, `expires_at`)
- `state`, `bound_campaign_id`
- an idempotency key, unique per source

The terms are frozen by trigger. Only `state`, `user_id` (once, on claim) and `bound_campaign_id` change, and only along the transitions in D5.

**D4. Binding is atomic and exclusive.** One database function binds an assignment to a campaign and writes the `campaign_pricing` row in the same transaction. It is guarded by:
- `unique(coupon_assignment_id)` on `campaign_pricing`
- a state predicate on the update

The once-per-campaign payment index is not relied on for this.

**D5. Assignment states.**

```
 assigned --bind--> bound --paid--> consumed
    |                 |
    |                 +--(campaign abandoned before approval: D-open 3)--> assigned
    +--expire/void--> void
 bound --payment pending/review/unknown--> (stays bound)
```

**D6. The lock.** `approveCampaign` sets `campaign_pricing.locked_at` in the same transaction as the approval. A trigger then refuses any change to prices, discount or assignment. The purchase refuses a campaign whose pricing is not locked.

**D7. The agent tool.** `apply_discount_tier`:
- resolves the call;
- checks the agent's limits (D-open 2);
- writes or returns the assignment (idempotent on the call);
- returns `{offer, list_price, final_price}`;
- records the objection reason and the outcome through a service-role activity insert.

The phone target is the callback request's phone. The ElevenLabs configuration changes only through `agents pull --update` → edit → `agents push` → `pull --update`.

**D8. Settlement checks amount and currency.** `lpResultSchema` reads `TranzactionInfo.Amount` and `CoinId` as `unknown`. Equal amount (in agorot) and shekels lead to succeeded. Anything else, including missing values, leads to review with an alert.

**D9. Staff assignment.** A new admin action, gated on `manage_billing`, the same as packages. It is audited with `logActivity` and needs no phone claim: staff name the account.

## Risks / Trade-offs

- **The price moves to a new table while the old column still exists.** Mitigation: expand → migrate → contract (see Migration Plan), plus a check that the approved price equals the price sent to payment before the old column is dropped.
- **A phone-targeted offer depends on the customer verifying the phone.** Only 1 of 6 accounts has done so. This adds a step for the customer, and is the cost of real proof.
- **The agent's spoken promise can still differ from its configuration.** Mitigation: the tool returns the final price and the prompt quotes it, and verification is done by transcribing real calls (CLAUDE.md voice-agent rule).
- **Settlement now refuses on a missing amount.** If CardCom omits `Amount` on some answer type, real payments go to review. Mitigation: measure on the test terminal before go-live.
- **The agreement template gains tokens.** Wording is the owner's call; existing approved PDFs are unaffected.

## Migration Plan

1. `supabase migration new`: create `coupon_assignments` and `campaign_pricing`, with RLS, server-only writes, freeze and lock triggers, and the binding function. Copy `campaigns.package_price` into `campaign_pricing`:
   - `list_price = package_price`
   - discount 0
   - `locked_at` = `approved_at` for approved campaigns
   Live: 7 campaigns, 4 priced.
2. Move every writer and reader (20 files) to `campaign_pricing`: createCampaign, approval and agreement rendering, both purchases, package-paid, the payment screen and the other screens.
3. Settlement amount check; the agent tool; the staff action.
4. Verify that every campaign's approved price equals its `campaign_pricing.package_price` and the amount of its payment.
5. A separate migration, after deploy, drops `campaigns.package_price`.

Rollback before step 5: the old column is still the source for any un-moved reader.

## Decisions pending (owner)

These change what is built. They are recorded open, not assumed, and the tasks that depend on them are marked.

1. **Expiry.** How long an offer lasts, and which step it must be used by: choosing the package, approving the terms, or paying.
2. **Agent limits.** Tier 1 (5%) only? Only after a price objection? At most one offer per call, and per phone?
3. **Release.** What happens to a bound assignment when the campaign is abandoned before approval, or approved but never paid.
4. **Several eligible offers.** The highest automatically, or the customer chooses.
5. **After a refund.** Whether a refunded campaign's assignment is spent or returned.
6. **An offer that expires or is voided during an open payment session.** Honour it until the session closes, or cancel the session.
7. **Already-approved campaigns.** Can an offer be added to a campaign whose terms are approved? The recommendation is no, because it would need new approval.

## Neighbouring cleanup (separate changes, not in this one)

- **The old per-result model's terms** (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`): check historical readers before moving or removing.
- **SUMIT remnants** (`auth_*`, `capture_status`, `release_status`, `card_*`, `sumit_*`): finish the SUMIT retirement and remove what is no longer read, rather than moving it.
- **`charge_status`, `charged_at`, `final_charge_amount`, document fields:** read the ledger instead, so there is no second source of the same fact.
- **`tos_version`, `approved_by`, `approved_at`:** compare with `signed_agreements` before removing anything.
- **`profiles.sales_referral_attempt_id`:** the owner can write it. Narrow the grant, and read it as a hint only.
