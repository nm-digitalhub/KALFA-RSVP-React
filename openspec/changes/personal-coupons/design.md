# Design

## Context

Verified on main at 17635b2 and, where marked, against the live database (read-only, 11.10.2026). Live counts are a snapshot. Verification steps re-measure them instead of assuming them.

**The sales agent's tools**
- `apply_discount_tier` returns a constant `{tier:'tier_1', amount_or_pct:5}` and discards the objection reason (`discount/[token]/route.ts:21,52-63`).
- `get_pricing` returns every offered package, with name, price, quota, channels and includes, but no id (`pricing/[token]/route.ts:66-72`). `listPackageOffers` does read the id (`campaigns.ts:224,239`).
- `log_outcome` accepts `discount_tier_applied` but does not persist it.
- Tool identity is the resolved `sales_call_attempts` row, through `guardSalesToolRequest`. There is no user session.

**Identity**
- `callback_requests` has no `user_id`.
- The only link from a call to an account is `profiles.sales_referral_attempt_id`, which the account owner can set. It is not proof.
- A verified phone (`auth.users.phone` with `phone_confirmed_at`, unique) proves control of the number. Live, 1 of 6 accounts had one, and purchase does not require it.

**Price and approval**
- `createCampaign` copies `packages.price_with_vat` into `campaigns.package_price` and sets `template_id`.
- `recordPackageApproval` (`agreements.ts:364-457`) reads the price, renders and uploads the PDF, inserts `signed_agreements`, then calls `approveCampaign`. These are separate steps with no shared transaction.
- `approveCampaign` (`campaigns.ts:549-559`) updates with `.eq('status','pending_approval')` but does not check that a row changed. A lost race returns success.
- No trigger locks the price after approval.
- `package_price` is read or written in 20 source files. Live, no database function or view read it.

**Payment**
- `startCardcomPurchase` writes the PENDING ledger row and its line before `LowProfile/Create`.
- `buildCreateLowProfile` refuses a non-positive product line. That is our builder's rule, not a proven CardCom limit.
- `settleCardcomSession` checks success, `ChargeOnly`, the transaction id and the terminal. It updates the ledger row through the service-role client (`cardcom-settle.ts:230`). It does not check the charged amount.
- GetLpResult carries `TranzactionInfo.Amount` and `CoinId` (seen live).

**Ledger**
- `payment_operations` has no grants for anon or authenticated (live).
- `payment_operations_check_lines` forces `credit_applied = -sum(negative lines)`, so any negative line is credit.
- `payment_operations.campaign_id` is `on delete restrict`.

**Audit and permissions**
- `logActivity` needs a user session. Session-less paths insert with the service role.
- Packages are managed under `manage_billing`.

## Goals / Non-Goals

**Goals:**
- A discount that the server computes for one package, that is saved before it is promised, and that reaches the approved terms and the charge unchanged.
- One guarded home for the campaign price, approved atomically and locked.
- A payment is recorded as paid only when CardCom confirms the amount we asked for.

**Non-Goals:**
- Public codes typed at checkout (a later change; they will create an assignment of the same kind).
- SUMIT-era `campaigns` columns (`retire-sumit-campaign-columns`).
- Moving `contact_quota`.
- A new CardCom client, mutator or ledger.

## Decisions

**D1. The discount is fixed when the package is chosen, before the terms are approved.** Alternatives:
- discounting at payment time: rejected, because it would charge a price other than the approved one;
- a negative ledger line: rejected, because it is counted as credit.

**D2. `campaign_pricing`, one row per campaign.** Columns:
- `campaign_id` (PK, FK to `campaigns`)
- `list_price`
- `discount_amount`
- `package_price` (the final price)
- `coupon_assignment_id` (nullable, unique, FK to `coupon_assignments`)
- `version` (integer, raised by trigger on every change)
- `locked_at`

`list_price - discount_amount = package_price`, with all three non-negative, is a check constraint.

**D3. `coupon_assignments`, plus an append-only history table.** An offer exists before any campaign. An assignment holds:
- the source: `sales_call_attempt_id`, or the `assigned_by` staff user;
- the target: `user_id`, or `phone_e164` until claimed;
- the offer it came from (D-open 8);
- the frozen terms: kind, value, `package_id`, the list price and promised final price for that package, and `expires_at`;
- `state` and `bound_campaign_id`;
- an idempotency key, unique per source.

A trigger freezes the terms. Every state change is written to `coupon_assignment_events`, which is insert-only.

**D4. One migration creates the tables in dependency order.** It creates `coupon_assignments`, then `coupon_assignment_events`, then `campaign_pricing` with its foreign key. No reference is left without a constraint.

**D5. States, and the only operations that change them.** Each operation is a database function, run in one transaction, called by the server only.

```
           bind                     package payment succeeded (D10)
 assigned ------> bound ---------------------------------------> consumed
   |   ^            |
   |   +- release --+   only while the pricing is unlocked and the
   |                     campaign has no package payment pending,
   |                     in review or succeeded (D-open 3 decides when)
   +-- void / expire (D-open 1) --> void
```

- **`bind_coupon_assignment(assignment, campaign)`** requires all of the following:
  - the assignment is `assigned`;
  - it is eligible for the account;
  - its package equals the campaign's package;
  - it has not expired;
  - the campaign is not yet approved and its pricing is unlocked.

  It then writes the discount and final price into `campaign_pricing`, and sets the assignment to `bound`.
- **`release_coupon_assignment(assignment, reason)`** runs under the same conditions as the release rule above. It restores the pricing (discount 0, final price equals list price, no assignment), sets the assignment back to `assigned` (or `void` if expired), and writes the history row. Once the pricing is locked, release is refused until D-open 3 defines a rule for it.
- **Consumption** is D10.

**D6. The lock forbids every way of undoing it.** Once `locked_at` is set, a trigger refuses each of the following:
- any update of the row, including clearing `locked_at` or changing `campaign_id`;
- deleting the row. A cascade from deleting the campaign is refused the same way. Task 1.4 checks the existing test-event purge path against this.

**D7. Versioned, atomic approval.**
1. `recordPackageApproval` reads the pricing row with its `version`, renders the PDF from it and uploads it.
2. It then calls `approve_package_terms(campaign, version, agreement fields)`. In one transaction, this function:
   - locks the campaign row;
   - checks that the status is `pending_approval` and the version is current;
   - inserts `signed_agreements`;
   - sets the campaign to `approved`;
   - sets `locked_at`.

On a version mismatch it raises, nothing is stored, and the customer is shown the new terms to approve. The uploaded PDF is removed; if removing it fails, the orphaned file is left without any agreement row pointing to it.

This also closes the `approveCampaign` race, because the function fails when the status guard matches no row.

**D8. The price migration: one source of truth per phase.**

| Phase | Source of truth | How the other copy stays equal |
|---|---|---|
| 1. Migration only, old code running | `campaigns.package_price` | A trigger on `campaigns` upserts `campaign_pricing` (list price = final price, discount 0) when `package_price` is set or changed. It is refused when the pricing row is locked or carries an assignment. |
| 2. New code deployed | `campaign_pricing` | New writers write only `campaign_pricing`, through the functions. A trigger on `campaign_pricing` mirrors the final price to `campaigns.package_price`. Readers move one by one; each reads the same number. |
| 3. Contract | `campaign_pricing` | After every reader has moved and the equality check finds no row that differs, one migration drops the two sync triggers and `campaigns.package_price`. |

The equality check is a query that returns every campaign where the two copies differ, or where an approved campaign's price differs from its succeeded payment amount. It must return no rows; it does not compare against a fixed count.

Coupons are switched on only in phase 2. Rolling back to phase-1 code is safe only while the coupon switch is off: old code would charge the mirrored final price correctly, but would render terms without the discount lines.

**D9. The agent tool is bound to a package.**
- `get_pricing` adds `package_id` to each package.
- `apply_discount_tier` takes `package_id` and the objection reason. It checks that the package is currently offered and that the call is allowed an offer (D-open 2). It then writes or returns the assignment (idempotent per call and package) for the callback request's phone, and returns `{offer, package_id, list_price, final_price}` computed from the offer definition (D-open 8).
- Any discount, percentage or price sent by the caller is ignored.
- The ElevenLabs configuration changes only through `agents pull --update` → edit → `agents push` → `pull --update`.

**D10. Consumption happens in the payment's own transaction.** An `AFTER UPDATE` trigger on `payment_operations` handles the moment a package-purchase row moves to `succeeded`. In the same transaction as the settlement write, it sets that campaign's bound assignment to `consumed` and writes the history row. Nothing is left half done to recover, and no repair ever charges again. The staff view also shows any succeeded payment whose campaign's assignment is not `consumed`, as a guard that should stay empty.

**D11. Settlement adds amount and currency to its existing checks.** It keeps success, `ChargeOnly`, the transaction id and the terminal. It adds: `TranzactionInfo.Amount` equal to the ledger amount (in agorot), and `CoinId` meaning shekels. Anything else, including a missing value, goes to review with an alert.

**D12. Screens.** The wording is the owner's.
- **Package choice (customer):**
  - On the package an eligible offer is for, the screen shows the list price, the discount and the final price.
  - Every other package shows its list price.
  - An offer bound to another campaign of the same account is not shown.
- **Reaching the offer (customer):**
  - The agent tells the caller that the offer waits for the phone number it called.
  - An account without a verified phone sees a neutral prompt to verify its phone. It does not reveal whether any offer exists, because an unverified account has not proved the number.
  - After verification, the offer appears on the package choice.
- **An offer that does not apply (customer, owner of the offer only):**
  - an offer for another package: "this offer is for package X";
  - an expired or voided offer: "the offer ended on …";
  - an offer already used: nothing.
- **Several eligible offers:** D-open 4.
- **Staff (admin, `manage_billing`):**
  - a list of assignments with source, target, package, prices, state, bound campaign, and that campaign's package payment outcome (pending, review or succeeded) read from the ledger;
  - assign and void actions;
  - no release action until D-open 3 defines it.
  - An assignment whose payment is in review is shown as held by that review.

**D13. Staff assignment** is gated on `manage_billing` and audited with `logActivity`. It needs no phone claim, because staff name the account.

## Risks / Trade-offs

- **Two copies of the price during the transition.** Mitigation: the database keeps them equal in both phases (D8), and the contract waits for an equality check that returns no rows.
- **A rejected approval leaves an uploaded PDF behind.** Mitigation: it is removed. Any file left over has no agreement row, so it binds no one.
- **A phone-targeted offer depends on the customer verifying the phone.** This adds a step for the customer, and is the cost of real proof.
- **The agent's spoken promise can still differ from its configuration.** Mitigation: the tool returns the final price and the prompt quotes it, and verification is done by transcribing real calls (CLAUDE.md voice-agent rule).
- **Settlement now refuses on a missing amount.** If CardCom omits `Amount` on some answer type, real payments go to review. Mitigation: measure on the test terminal before go-live.
- **The consume trigger couples the ledger to coupons.** Mitigation: it only reads `coupon_assignments` and writes its state and history. It never changes the ledger row, and its own tests cover each outcome.

## Migration Plan

As D8. In order:
1. The tables, functions and triggers. The price is copied for every campaign that has one.
2. New code: writers, approval, purchase and settlement. The coupon switch stays off.
3. Readers move, one by one.
4. The coupon switch turns on: the agent tool, staff and customer screens.
5. The equality check returns no rows.
6. The contract migration.

Rollback before step 6 is safe only with the coupon switch off (D8).

## Decisions pending (owner)

These change what is built. They are recorded open, not assumed, and the tasks that depend on them are marked.

1. **Expiry.** How long an offer lasts, and which step it must be used by: choosing the package, approving the terms, or paying.
2. **Agent limits.** Tier 1 (5%) only? Only after a price objection? At most one offer per call, and per phone?
3. **Release.** When an unlocked bound assignment is released: the campaign abandoned before approval, after how long, by whom. Whether anything may ever release one after approval when no payment has started.
4. **Several eligible offers.** The highest automatically, or the customer chooses.
5. **After a refund.** Whether a refunded campaign's consumed assignment stays spent or is returned.
6. **An offer that expires or is voided during an open payment session.** Honour it until the session closes, or cancel the session.
7. **Already-approved campaigns.** Can an offer be added to a campaign whose terms are approved? The recommendation is no, because it would need new approval.
8. **Where offers are defined.** A staff-managed offers table (kind, value, packages, validity, who may assign it), or fixed values in code. The server computes every discount from this source, and nothing can be assigned until it exists. The recommendation is a table under `manage_billing`.

## Neighbouring cleanup (separate changes, not in this one)

- The old per-result model's terms (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`): check historical readers before moving or removing.
- `tos_version`, `approved_by`, `approved_at`: compare with `signed_agreements` before removing anything.
- `profiles.sales_referral_attempt_id`: the owner can write it. Narrow the grant, and read it as a hint only.
- SUMIT-era columns: `retire-sumit-campaign-columns`.
