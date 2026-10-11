# Design

## Context

Verified on main at 10f32cf8 and, where marked, against the live database (read-only, 11.10.2026). Live counts are a snapshot. Verification steps re-measure them instead of assuming them. Re-verified at 4ace2851 (12.10.2026), after `retire-sumit-campaign-columns` dropped the pay-per-result columns and the old signature path was removed; the facts below are updated to that state.

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
- One approval path (the signature path, `recordSignedAgreement`, was deleted on 12.10.2026 with the pay-per-result model): `recordPackageApproval` (`agreements.ts:135`) stores the agreement before approving, in separate steps with no shared transaction — reads the price, renders the PDF from the admin-managed package document (`getApprovedPackageAgreementDoc`, version `2026-10-v6`) after comparing it with the version the customer was shown, uploads it, inserts `signed_agreements`, then calls `approveCampaign`.
- `approveCampaign` now refuses when its status-guarded update changes no row (ce5c98cb). A lost race no longer returns success, but the agreement row stored just before it remains.
- No trigger locks the price after approval.
- `package_price` is read or written in 20 source files. Live, no database function or view read it.

**Payment**
- `startCardcomPurchase` writes the PENDING ledger row and its line before `LowProfile/Create`.
- `buildCreateLowProfile` refuses a non-positive product line. That is our builder's rule, not a proven CardCom limit.
- `settleCardcomSession` checks success, `ChargeOnly`, the transaction id and the terminal. It updates the ledger row through the service-role client (`cardcom-settle.ts:219`). It does not check the charged amount.
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

**D3. One assignment, with package options** (owner, 11.10.2026). An assignment is one personal benefit. It carries one option for each package the offer allows (D14). Only one option can ever be bound to a campaign and paid.

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
   |   +------- release --------+   automatic only (D17): the move between
   |                                packages or to a newer campaign, while the
   |                                pricing is unlocked and no package payment
   |                                is pending, in review or succeeded
   +-- void / expire (D15) --> void
```

- **`bind_coupon_assignment(assignment, campaign)`** requires all of the following:
  - the assignment is `assigned`;
  - it is eligible for the account;
  - it has an option for the campaign's package;
  - it has not expired;
  - the campaign is not yet approved and its pricing is unlocked — or the campaign is approved with no package payment started, and the bind runs through the supersede-and-re-approve operation (D21).

  It then writes that option's prices into `campaign_pricing`, and sets the assignment to `bound`.
- **Moving the option.** When the customer changes the package of an unapproved campaign, the same function re-points the pricing to the matching option in one transaction. No new assignment is created. If the new package has no option, the pricing returns to its list price and the assignment returns to `assigned`.
- **`release_coupon_assignment(assignment, reason)`** runs under the same conditions as the release rule above. It restores the pricing (discount 0, final price equals list price, no assignment), sets the assignment back to `assigned` (or `void` if expired), and writes the history row. Once the pricing is locked, release is refused (D17). It is never called by hand — only as the internal step of the automatic move (D17).
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

A cleanup job removes a PDF only after it has confirmed that no agreement row points to it. (`recordPackageApproval` is the only approval path; the signature path, `recordSignedAgreement`, was deleted on 12.10.2026.)

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
- `apply_discount_tier` takes the objection reason, and no package and no value. It checks that the call is allowed an offer (D14, D16). It then writes, or — while the phone already holds an active assignment — returns, the one active assignment for the callback request's phone (D16). The return is `{offer, options:[{package_id, package_name, list_price, final_price}]}`, computed from the offer definition (D14).
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
| `ui/Offers.dc.html`, `ui/OfferEdit.dc.html` | `ui/Offers.png`, `ui/OfferEdit.png` | Offer list and offer form (D14) |

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
- **Several benefits:** the best price applies automatically (D18).
- **Staff (admin, `manage_billing`):**
  - a list of assignments with source, target, options, state, bound campaign and chosen package, and that campaign's package payment outcome (pending, review or succeeded) read from the ledger;
  - assign and void actions;
  - no release action (D17).
  - An assignment whose payment is in review is shown as held by that review.

**D13. Staff assignment** is gated on `manage_billing` and audited with `logActivity`. It needs no phone claim, because staff name the account.

**D14. Offers are defined in a staff-managed table** (owner, 12.10.2026 — "כן, מסך ניהול"). An offers table holds, per offer: kind (a percentage or a fixed amount — owner, 12.10.2026, ש1), value, the packages it allows, validity (a number of days from the moment the benefit is given — owner, 12.10.2026, ש2), and who may assign it. It is managed in the admin screens (`ui/Offers.dc.html`, `ui/OfferEdit.dc.html`) under `manage_billing`, like the packages. The server computes every discount, option and final price from this table only; the agent, the browser and the code carry no fixed discount values. Nothing can be assigned until an offer exists. Fixed values in code were rejected: changing an offer must not require a deploy.

**D15. Expiry: payment is the deciding step** (owner, 12.10.2026 — "כן, נכון", after rejecting approval-as-deadline: it would guarantee a price indefinitely). 
- How long a benefit lasts is a per-offer field in the offers table (D14), frozen onto the assignment (D3). It is never a constant in code.
- The benefit counts only if the campaign's package payment **succeeded** before the expiry. Approving the terms in time is not enough.
- The approved terms document states the deadline explicitly: the price is valid for payment until that date.
- Passed the deadline without payment — even with approved terms — the benefit lapses. A customer who wants to continue approves **new terms at the then-current price** (the list price, or whatever offer then applies).
- Engineering consequence for D6/D7: an approved-but-expired discounted campaign needs a defined database operation that supersedes the locked pricing and opens a new approval round. A locked row is still never updated or deleted by a plain write; the operation and its exact mechanics are specified with the D7 function, and the lock's guarantees (the paid history and the signed document stay immutable) hold.
- The expiry falling during an open payment session: the session completes with its discount (D20).

**D16. One active benefit per phone** (owner, 12.10.2026 — "כן, מאשר").
- While a phone has an assignment that is not expired, consumed or void, any further call for that phone returns **that** assignment, with its existing options and expiry. No new assignment, no renewed validity.
- Once it is consumed, void or expired, a later call may create a new assignment.
- The limit binds the calls, not staff: staff may assign another benefit to an account that already holds one (owner, 12.10.2026, ש3); D18 then applies the best price, and an equal-value duplicate is voided (D18).
- What the agent may give comes only from the offers table — D14's "who may assign it"; there is no tier constant in code.
- The objection reason stays required and recorded (D9). When the agent offers the benefit is the prompt's rule; the server cannot verify the conversation.

**D17. No manual release, no abandonment timer** (owner, 12.10.2026 — "כן, מאשר"). The only thing that ends a benefit is its own expiry (D15), a void by staff, or consumption by payment.
- Before approval, the benefit follows the account's live campaign automatically: it moves between packages (D5), and to a newer campaign of the same event when the previous one was cancelled — inside `bind_coupon_assignment`, never by hand.
- After approval (locked pricing) there is no release at all: the campaign pays within the validity, or the benefit lapses (D15).
- A cancelled campaign — approved or not — frees its bound, unconsumed assignment (owner, 12.10.2026, ש4): if the benefit is still within its validity it returns to assigned and applies to the event's next campaign; if expired it goes void.
- Staff have no release action; `release_coupon_assignment` exists only as the internal step of the automatic move.
- Verified context: a customer account holds one event (R10, `events.ts:161`), so "another campaign" can only be a newer campaign of that same event.

**D18. Several benefits: the best price applies automatically** (owner, 12.10.2026 — "כן, מאשר"). When an account is eligible for more than one active assignment (for example one claimed by its verified phone and one assigned by staff):
- for the package the customer chooses, the assignment whose option gives the **lowest final price** for that package is bound; if only one has an option for it, that one is bound;
- there is no customer choice screen;
- the other assignment stays as it is — active until its own expiry, void or a later use;
- **an equal-value duplicate is not kept** (owner, 12.10.2026, ש6): when a new assignment would give the same final price as an existing active one, the system voids one of the two — keeping the one whose validity lasts longer — with an audited void (reason: duplicate). So two equal benefits never coexist.

**D19. A refund never returns a benefit** (owner, 12.10.2026 — "כן, מאשר", asked explicitly about a full cancellation). A consumed assignment stays consumed after any refund, full or partial. A repeat purchase after a full cancellation pays the list price. Compensation is never automatic: staff may assign a **new** benefit by hand (D13). Verified context: refunds exist and always pass through staff — the cancellation-request flow (full_cancellation / partial_charge / declined) records them in the payment ledger.

**D20. An open payment session finishes with its discount** (owner, 12.10.2026 — "כן"). The moment that counts is the opening of the payment session: a session opened while the benefit was valid completes at its locked price, even if the expiry passes or staff void the benefit mid-session. A void takes effect from the next session. (The price is locked at approval — D7; D15 bounds how long the locked price is payable; the session is opened only on a locked price, D2/D6.)

**D21. A benefit can be applied after approval — through re-approval at the new price** (owner, 12.10.2026 — "כן, מאשר", reversing the earlier recommendation: this is the closing tool for a hesitating customer). A customer who approved terms but has not paid may receive a benefit, and it applies to that campaign:
- allowed only while the campaign has no package payment pending, in review or succeeded;
- **the trigger is the customer's explicit acceptance** (owner, 12.10.2026, ש5): the site shows "יש לך הטבה — לחץ לקבל"; until the customer accepts, nothing changes and the earlier approved price stays payable. Accepting resets the prior terms-approval and immediately opens the new approval at the discounted price. The agent and staff only create the benefit — the customer is always the one who applies it;
- the reset-and-re-approve runs through the defined supersede operation (the same one D15's lapse path uses): the locked pricing is superseded and a new pricing version carries the discount;
- the charge opens only on the latest approved, locked price; the earlier signed document stays archived;
- a plain update of a locked row remains forbidden (D6) — the supersede operation is the only path, and it never alters the paid history or a stored document.

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

All eight were decided by the owner on 12.10.2026 and recorded as D14–D21. Nothing is open.

1. ~~**Expiry.**~~ Decided (owner, 12.10.2026): per-offer validity in the offers table; payment is the deciding step — D15.
2. ~~**Agent limits.**~~ Decided (owner, 12.10.2026): one active benefit per phone; the allowed offers come from the offers table — D16.
3. ~~**Release.**~~ Decided (owner, 12.10.2026): no manual release, no timer; automatic move only — D17.
4. ~~**Several benefits for one customer.**~~ Decided (owner, 12.10.2026): the best price for the chosen package applies automatically — D18.
5. ~~**After a refund.**~~ Decided (owner, 12.10.2026): stays spent, full cancellation included; compensation only by a new staff assignment — D19.
6. ~~**A benefit that expires or is voided during an open payment session.**~~ Decided (owner, 12.10.2026): opened in validity — completes with the discount — D20.
7. ~~**Already-approved campaigns.**~~ Decided (owner, 12.10.2026): yes — through re-approval at the discounted price — D21.
8. ~~**Where offers are defined.**~~ Decided (owner, 12.10.2026): a staff-managed offers table under `manage_billing` — D14.

## Neighbouring cleanup (separate changes, not in this one)

- ~~The old per-result model's terms (`price_per_reached`, `base_price`, `included_reached`, `max_charge_ceiling`)~~ — dropped on 11.10.2026 by `retire-sumit-campaign-columns` (their historical values are recorded in its `comparison-5-1.md`).
- `tos_version`, `approved_by`, `approved_at`: compare with `signed_agreements` before removing anything (still on `campaigns`, 12.10.2026).
- `profiles.sales_referral_attempt_id`: the owner can write it. Narrow the grant, and read it as a hint only.
- SUMIT-era columns: `retire-sumit-campaign-columns` — mostly dropped on 11.10.2026; `card_*` and `sumit_*` remain on `campaigns` while the owner keeps the SUMIT test page.
