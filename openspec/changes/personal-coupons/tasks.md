# Tasks

Tasks marked **[needs D-open n]** wait for that owner decision (design.md, "Decisions pending"); they are not built on an assumption.

Database checks re-measure the live state; none assumes a fixed count. Every concurrency test runs two transactions in parallel, on two connections, against a local or branch database. A single rolled-back block does not count as proof.

## 1. Schema (phase 1 of D8)

- [ ] 1.1 `npx supabase migration new coupons_and_campaign_pricing`. In dependency order (D4), create:
  - `coupon_assignments` with the frozen-terms trigger and the idempotency key unique per source (one per sales call) (D3);
  - `coupon_assignment_options`, unique per assignment and package, frozen with the assignment;
  - `coupon_assignment_events`, insert-only;
  - `campaign_pricing` with its FK to `coupon_assignments`, the unique assignment, the price check constraint, and the `version` trigger (D2).

  All three tables: RLS on, no grants to anon or authenticated, writes only through the functions in 1.2. Verify on live (read-only after push): no grant to anon or authenticated; every FK exists.
- [ ] 1.2 In the same change set: `bind_coupon_assignment` (including moving the option), `release_coupon_assignment` (D5), and `approve_package_terms` with its request id (D7). `signed_agreements` gains a unique approval request id. All take row locks in the D6 order and are `SECURITY DEFINER`, executable by the service role only. Verify:
  - two parallel binds of one assignment: exactly one succeeds;
  - two parallel approvals: exactly one stores an agreement;
  - an approval in parallel with a bind: the approval sees the bound price or refuses on version, never a mix;
  - an approval with a stale version stores nothing;
  - a release on a locked or paid campaign is refused;
  - moving to a package without an option returns the list price and leaves one assignment.
- [ ] 1.3 The lock trigger (D6), the phase-1 sync trigger (`campaigns.package_price` → `campaign_pricing`), and the phase-1 approval-lock trigger (D8). Copy the price of every campaign that has one. Lock every campaign that was ever approved, whatever its status now (`approved_at` set or a `signed_agreements` row), at its approval time. Verify:
  - the equality query (D8) returns no rows, including no approved campaign with an unlocked price;
  - each of update, unlock, re-key and delete of a locked row is refused;
  - a phase-1 price change on an unlocked row without an assignment is mirrored;
  - an approval made by the old code path locks the price in the same transaction.
- [ ] 1.4 Check how campaigns and their events are deleted today (the test-event purge and `test_event_purge_blocker`) against the lock trigger. Record the result in this change. Verify: a purge of an unpaid test campaign still works; deleting a locked row is refused.

## 2. Writers and approval (phase 2 of D8)

- [ ] 2.1 `createCampaign` writes the pricing through the database, and the phase-2 mirror trigger (`campaign_pricing` → `campaigns.package_price`) replaces the phase-1 sync. Verify: unit tests for a new package campaign; the equality query returns no rows.
- [ ] 2.2 `recordPackageApproval` and `recordSignedAgreement` create an approval request id, render from the pricing row and its `version`, and call `approve_package_terms`. On a definite refusal they remove the uploaded PDF and ask for re-approval. On an unknown outcome they keep the PDF and resolve it by request id (D7). A cleanup job removes only PDFs that no agreement references. `approveCampaign` stops being the package approval path. (Already done outside this change: `approveCampaign` refuses when its guarded update changes no row.) Verify: tests for a stale version, a lost race, a timeout after commit (resolved as approved, PDF kept), and a successful approval that is locked in the same transaction.
- [ ] 2.3 Add list-price and discount tokens to the package terms template (mockup and proposed clause: `ui/Terms.dc.html`). Verify: a rendered document shows all three values when a discount applies. **The wording is the owner's.**
- [ ] 2.4 The purchase paths (`cardcom-purchase`, `package-purchase`, `getCampaignForPurchase`) use the locked final price and refuse an unlocked one. Verify: tests for locked and unlocked.

## 3. Settlement

- [ ] 3.1 `settleCardcomSession` keeps its existing checks and adds `TranzactionInfo.Amount` and `CoinId` (D11). Verify:
  - tests for equal, different and missing values;
  - a test that an existing check still fails when the amount matches;
  - a read-only GetLpResult on terminal 172204 shows both fields present.
- [ ] 3.2 The consume trigger on `payment_operations` (D10). Verify: in one transaction, a package payment moving to succeeded consumes the bound assignment; pending, review and failed leave it bound; the ledger row is never changed by the trigger.

## 4. Readers move to the pricing record

- [ ] 4.1 Move the remaining readers (screens, stats, labels, cancellation, package-paid, payment screen; every file `grep package_price src` finds). Verify: the grep finds only the pricing module and the contract note; tsc and the full suite pass.

## 5. Offers and assignments (coupon switch)

- [ ] 5.1 **[needs D-open 8]** The offer source and its staff screens under `manage_billing` (`ui/Offers.dc.html`, `ui/OfferEdit.dc.html`). Verify: tests for permission, audit, and that an assignment freezes the offer's terms.
- [ ] 5.2 Eligibility and claim. The binding is applied at package choice for:
  - a staff assignment to the account;
  - an assignment to a phone equal to the account's verified phone, claimed once.

  Verify: tests that a shared link or a profile referral never applies or reveals an offer, and that a verified matching phone does.
- [ ] 5.3 **[needs D-open 1, 3, 4, 7]** Expiry, when release runs, the choice among several offers, and refusal after approval. Verify: tests per decided rule.
- [ ] 5.4 **[needs D-open 5, 6]** The assignment after a refund, and an offer that ends during an open session. Verify: tests per decided rule.

## 6. Sales agent

- [x] 6.1 `get_pricing` adds `package_id`. Verify: route test.
- [ ] 6.2 **[needs D-open 2, 8]** `apply_discount_tier` (D9):
  - it takes the objection reason only, and checks the call's limits;
  - it writes or returns the one assignment for this call, with an option per package the offer allows, for the callback request's phone;
  - it returns `{offer, options:[{package_id, package_name, list_price, final_price}]}`;
  - it records the objection reason and the outcome through a service-role activity insert.

  Verify: route tests — a repeat call returns the same assignment and options; a failed write returns "no offer"; no caller-sent price, value or package is used.
- [ ] 6.3 Update the agent's prompt so it quotes the returned final prices for the packages in the benefit, says the customer chooses at signup, promises only after the tool answers, and tells the caller the offer waits for the phone it was called on. Use the sanctioned flow: `agents pull --update` → edit → `agents push` → `pull --update`. Verify: the pulled config matches; a real test call is transcribed (CLAUDE.md voice-agent rule).

## 7. Screens (D12)

- [ ] 7.1 Package choice (`ui/Main.dc.html`, `ui/Mobile.dc.html`, states in `ui/States.dc.html`): on every package the benefit allows, the list price, discount and final price; the benefit moving when the package changes before approval; the message for an ended benefit. **The wording is the owner's.** Verify: component tests per state; RTL and keyboard check; a runtime check in the browser.
- [ ] 7.2 A neutral invitation to verify the phone (`ui/States.dc.html`) for an account without a verified phone. It reveals nothing about offers. Verify: a test that the response is identical whether or not an offer exists for any phone.
- [ ] 7.3 Staff assignment list and assign form (`ui/Assignments.dc.html`, `ui/AssignNew.dc.html`): state, options, source, bound campaign, chosen package and its payment outcome, plus assign and void, and the guard row for a succeeded payment whose assignment was not consumed (D10). Verify: permission tests; an assignment held by a payment in review is shown as such.

## 8. Contract (phase 3 of D8)

- [ ] 8.1 Run the equality query (D8) on live. Verify: it returns no rows; the output is recorded in this change.
- [ ] 8.2 Rollback rule (D8): before the coupon switch turns on, add the query listing campaigns that carry an assignment to the runbook. Verify: it returns a seeded test campaign with an assignment, and nothing else.
- [ ] 8.3 After the deploy of groups 1–7: `npx supabase migration new drop_campaigns_package_price`. It drops the mirror trigger and the column; then regenerate the types. Verify: tsc and the full suite pass; nothing reads the old column.
