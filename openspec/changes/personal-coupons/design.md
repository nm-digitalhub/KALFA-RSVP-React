# Design

## Context

Verified on main at 10f32cf8 and, where marked, against the live database (read-only, 11.10.2026). Live counts are a snapshot. Verification steps re-measure them instead of assuming them.

**The sales agent's tools**
- `apply_discount_tier` returns a constant `{tier:'tier_1', amount_or_pct:5}`. It saves no assignment, returns no final price, and discards the objection reason (`discount/[token]/route.ts:21,52-63`).
- `get_pricing` returns every offered package with its `package_id` (`packages.id`), name, price, quota, channels and includes (ce5c98cb).
- `log_outcome` accepts `discount_tier_applied` but does not persist it.
- Tool identity is the resolved `sales_call_attempts` row, through `guardSalesToolRequest`. There is no user session.

**Identity**
- `callback_requests` has no `user_id`.
- The only link from a call to an account is `profiles.sales_referral_attempt_id`, which the account owner can set. It is not proof.
- A verified phone (`auth.users.phone` with `phone_confirmed_at`, unique) proves control of the number. Live, 1 of 6 accounts had one, and purchase does not require it.

**Price and approval**
- `createCampaign` copies `packages.price_with_vat` into `campaigns.package_price` and sets `template_id`.
- Both approval paths store the agreement before approving, in separate steps with no shared transaction:
  - `recordPackageApproval` (`agreements.ts:364-457`): reads the price, renders and uploads the PDF, inserts `signed_agreements`, then calls `approveCampaign`;
  - `recordSignedAgreement` (`agreements.ts:172-324`): the same order.
- `approveCampaign` now refuses when its status-guarded update changes no row (ce5c98cb). A lost race no longer returns success, but the agreement row stored just before it remains.
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
- One personal benefit per customer, valid for the packages the business allows. The server computes it and saves it before it is promised. It is used for one purchase, and reaches the approved terms and the charge unchanged.
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

**D3. One assignment, with package options** (owner, 11.10.2026). An assignment is one personal benefit. It carries one option for each package the offer allows (D-open 8). Only one option can ever be bound to a campaign and paid.

`coupon_assignments` holds:
- the source: `sales_call_attempt_id`, or the `assigned_by` staff user;
- the target: `user_id`, or `phone_e164` until claimed;
- the offer it came from;
- the frozen kind, value and `expires_at`;
- `state` and `bound_campaign_id`;
- an idempotency key, unique per source.

`coupon_assignment_options` holds, per assignment and package (unique together): `package_id`, `list_price`, `discount_amount` and `final_price`, frozen at assignment time.

Neither the agent nor the customer adds a package or raises a value. The options come only from the offer. A trigger freezes the terms and the options. Every state change is written to `coupon_assignment_events`, which is insert-only.

**D4. One migration creates the tables in dependency order:** `coupon_assignments`, `coupon_assignment_options`, `coupon_assignment_events`, then `campaign_pricing` with its foreign key. No reference is left without a constraint.

**D5. States, and the only operations that change them.** Each operation is a database function, run in one transaction, called by the server only.

```
           bind / move option                package payment succeeded (D10)
 assigned ------------------> bound ------------------------------------> consumed
   |   ^                        |
   |   +------- release --------+   only while the pricing is unlocked and the
   |                                campaign has no package payment pending,
   |                                in review or succeeded (D-open 3 decides when)
   +-- void / expire (D-open 1) --> void
```

- **`bind_coupon_assignment(assignment, campaign)`** requires all of the following:
  - the assignment is `assigned`;
  - it is eligible for the account;
  - it has an option for the campaign's package;
  - it has not expired;
  - the campaign is not yet approved and its pricing is unlocked.

  It then writes that option's prices into `campaign_pricing`, and sets the assignment to `bound`.
- **Moving the option.** When the customer changes the package of an unapproved campaign, the same function re-points the pricing to the matching option in one transaction. No new assignment is created. If the new package has no option, the pricing returns to its list price and the assignment returns to `assigned`.
- **`release_coupon_assignment(assignment, reason)`** runs under the same conditions as the release rule above. It restores the pricing (discount 0, final price equals list price, no assignment), sets the assignment back to `assigned` (or `void` if expired), and writes the history row. Once the pricing is locked, release is refused until D-open 3 defines a rule for it.
- **Consumption** is D10.

**D6. One lock order, and a lock that forbids every way of undoing it.**
- Every function that touches a campaign's price takes the row locks in the same order: the campaign (`for update`), then its `campaign_pricing` row (`for update`), then the assignment. This applies to approve, bind, move, release and the sync triggers. Checks run only after the locks are held, so no concurrent price change can slip between a check and a write.
- Once `locked_at` is set, a trigger refuses each of the following:
  - any update of the row, including clearing `locked_at` or changing `campaign_id`;
  - deleting the row. A cascade from deleting the campaign is refused the same way. Task 1.4 checks the existing test-event purge path against this.

**D7. Versioned, atomic approval with a request id.**
1. `recordPackageApproval` creates an approval request id. It reads the pricing row with its `version`, renders the PDF from it, and uploads it under a path that contains the request id.
2. It then calls `approve_package_terms(request id, campaign, version, agreement fields)`. In one transaction, this function:
   - takes the locks in the D6 order;
   - checks that the campaign is awaiting approval and the version is current;
   - inserts `signed_agreements` with the request id (unique);
   - sets the campaign to `approved`;
   - sets `locked_at`.

What happens next depends on the answer:

| Answer | What happens |
|---|---|
| Success | Done. |
| A definite refusal (stale version, wrong status) | Nothing was stored. The uploaded PDF is removed, and the customer is shown new terms to approve. |
| No answer (timeout, broken connection) | The outcome is unknown. Nothing is removed. The server looks up `signed_agreements` by the request id: found means approved, not found means refused. |

A cleanup job removes a PDF only after it has confirmed that no agreement row points to it. The same request-id pattern applies to the signature path (`recordSignedAgreement`).

**D8. The price migration: one source of truth per phase.**

| Phase | Source of truth | How the other copy stays equal |
|---|---|---|
| 1. Migration only, old code running | `campaigns.package_price` | A trigger on `campaigns` upserts `campaign_pricing` (list price = final price, discount 0) when `package_price` is set or changed. It is refused when the pricing row is locked or carries an assignment. A second trigger locks the pricing row whenever a campaign moves to `approved`, so an approval by old code also locks the price. |
| 2. New code deployed | `campaign_pricing` | New writers write only `campaign_pricing`, through the functions. A trigger on `campaign_pricing` mirrors the final price to `campaigns.package_price`. Readers move one by one; each reads the same number. |
| 3. Contract | `campaign_pricing` | After every reader has moved and the equality check finds no row that differs, one migration drops the sync triggers and `campaigns.package_price`. |

- **The initial copy** covers every campaign that has a price. A campaign that was approved at any time is locked, whatever its status is now (`approved_at` is set, or its `signed_agreements` row exists), with `locked_at` taken from the approval time.
- **The equality check** is a query that returns every campaign where:
  - the two copies differ;
  - or an approved campaign has an unlocked price;
  - or an approved campaign's price differs from its succeeded payment amount.

  It must return no rows. It does not compare against a fixed count.
- **Rollback.** Returning to phase-1 code is allowed only while no campaign carries an assignment. Old code cannot show or honour a discount, so after the first assignment is bound, rollback is closed. A query that lists the blocking campaigns is part of the runbook. Turning the coupon switch off does not reopen rollback, because the bound assignments and the discounted prices remain.

**D9. The agent tool.**
- `get_pricing` returns `package_id` per package (done, ce5c98cb).
- `apply_discount_tier` takes the objection reason, and no package and no value. It checks that the call is allowed an offer (D-open 2). It then writes, or on a repeat returns, the one assignment for this call, for the callback request's phone. The return is `{offer, options:[{package_id, package_name, list_price, final_price}]}`, computed from the offer definition (D-open 8).
- Any discount, percentage, price or package sent by the caller is ignored.
- The agent says the benefit applies to the listed packages, and that the customer chooses at signup.
- The ElevenLabs configuration changes only through `agents pull --update` → edit → `agents push` → `pull --update`.

**D10. Consumption happens in the payment's own transaction.** An `AFTER UPDATE` trigger on `payment_operations` handles the moment a package-purchase row moves to `succeeded`. In the same transaction as the settlement write, it sets that campaign's bound assignment to `consumed` and writes the history row. Nothing is left half done to recover, and no repair ever charges again. The staff view also shows any succeeded payment whose campaign's assignment is not `consumed`, as a guard that should stay empty.

**D11. Settlement adds amount and currency to its existing checks.** It keeps success, `ChargeOnly`, the transaction id and the terminal. It adds: `TranzactionInfo.Amount` equal to the ledger amount (in agorot), and `CoinId` meaning shekels. Anything else, including a missing value, goes to review with an alert.

**D12. Screens.** The wording is the owner's. The mockups and proposed copy are in `ui/` (canvas: https://claude.ai/artifact/L7KViWHTF2puFwa7bTZRpy). They are built on the existing components: the setup page and its stepper, `PackageChoiceForm`, `PackageTermsStep`, `ApprovePackageTermsForm`, `FormError`, and the admin packages and recordings pages.

| Source | Image | Screen |
|---|---|---|
| `ui/Main.dc.html`, `ui/Mobile.dc.html` | `ui/Main.png`, `ui/Mobile.png` | Package choice with the benefit (desktop, phone) |
| `ui/States.dc.html` | `ui/States.png` | The agent's line, the neutral phone prompt, an ended, voided or in-use benefit, a refused approval |
| `ui/Terms.dc.html` | `ui/Terms.png` | Package terms with list price, benefit and final price; proposed price clause |
| `ui/Assignments.dc.html` | `ui/Assignments.png` | Staff list of assignments |
| `ui/AssignNew.dc.html` | `ui/AssignNew.png` | Staff assigns a benefit |
| `ui/Offers.dc.html`, `ui/OfferEdit.dc.html` | `ui/Offers.png`, `ui/OfferEdit.png` | Offer list and offer form (D-open 8) |

- **Package choice (customer):**
  - Every package with an option in the customer's benefit shows its list price, the discount and the final price.
  - Every other package shows its list price.
  - Changing the package before approval moves the benefit (D5).
  - A benefit bound to another campaign of the same account is shown as in use there.
- **Reaching the benefit (customer):**
  - The agent tells the caller that the benefit waits for the phone number it called.
  - An account without a verified phone sees a neutral prompt to verify its phone. It does not reveal whether any benefit exists, because an unverified account has not proved the number.
  - After verification, the benefit appears on the package choice.
- **A benefit that does not apply (customer, owner of the benefit only):**
  - an expired or voided benefit: "the benefit ended on …";
  - a benefit already used: nothing.
- **Several benefits:** D-open 4 (for example, one from a call and one from staff).
- **Staff (admin, `manage_billing`):**
  - a list of assignments with source, target, options, state, bound campaign and chosen package, and that campaign's package payment outcome (pending, review or succeeded) read from the ledger;
  - assign and void actions;
  - no release action until D-open 3 defines it.
  - An assignment whose payment is in review is shown as held by that review.

**D13. Staff assignment** is gated on `manage_billing` and audited with `logActivity`. It needs no phone claim, because staff name the account.

## Risks / Trade-offs

- **Two copies of the price during the transition.** Mitigation: the database keeps them equal in both phases, locks on any approval (D8), and the contract waits for an equality check that returns no rows.
- **Rollback closes once a discount exists.** Mitigation: the coupon switch turns on only after phase 2 has run without needing a rollback, and the blocking query is in the runbook.
- **A PDF without an agreement can be left behind** after an unknown outcome. Mitigation: the cleanup job, which deletes only files that no agreement references. A leftover file binds no one.
- **A phone-targeted benefit depends on the customer verifying the phone.** This adds a step for the customer, and is the cost of real proof.
- **The agent's spoken promise can still differ from its configuration.** Mitigation: the tool returns the final prices and the prompt quotes them, and verification is done by transcribing real calls (CLAUDE.md voice-agent rule).
- **Settlement now refuses on a missing amount.** If CardCom omits `Amount` on some answer type, real payments go to review. Mitigation: measure on the test terminal before go-live.
- **The consume trigger couples the ledger to coupons.** Mitigation: it only reads `coupon_assignments` and writes its state and history. It never changes the ledger row, and its own tests cover each outcome.

## Migration Plan

As D8. In order:
1. The tables, functions and triggers, including the phase-1 approval lock. The price is copied for every campaign that has one.
2. New code: writers, approval with request id, purchase and settlement. The coupon switch stays off.
3. Readers move, one by one.
4. The coupon switch turns on: the agent tool, staff and customer screens. From the first bound assignment, rollback to phase-1 code is closed.
5. The equality check returns no rows.
6. The contract migration.

## Decisions pending (owner)

These change what is built. They are recorded open, not assumed, and the tasks that depend on them are marked.

1. **Expiry.** How long a benefit lasts, and which step it must be used by: choosing the package, approving the terms, or paying.
2. **Agent limits.** Tier 1 (5%) only? Only after a price objection? At most one benefit per phone across calls? (One per call is decided.)
3. **Release.** When an unlocked bound assignment is released: the campaign abandoned before approval, after how long, by whom. Whether anything may ever release one after approval when no payment has started.
4. **Several benefits for one customer.** The highest automatically, or the customer chooses.
5. **After a refund.** Whether a refunded campaign's consumed assignment stays spent or is returned.
6. **A benefit that expires or is voided during an open payment session.** Honour it until the session closes, or cancel the session.
7. **Already-approved campaigns.** Can a benefit be added to a campaign whose terms are approved? The recommendation is no, because it would need new approval.
8. **Where offers are defined.** A staff-managed offers table (kind, value, the packages it allows, validity, who may assign it), or fixed values in code. The server computes every discount and every option from this source, and nothing can be assigned until it exists. The recommendation is a table under `manage_billing`.

## Neighbouring cleanup (separate changes, not in this one)

- The old per-result model's terms (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`): check historical readers before moving or removing.
- `tos_version`, `approved_by`, `approved_at`: compare with `signed_agreements` before removing anything.
- `profiles.sales_referral_attempt_id`: the owner can write it. Narrow the grant, and read it as a hint only.
- SUMIT-era columns: `retire-sumit-campaign-columns`.
