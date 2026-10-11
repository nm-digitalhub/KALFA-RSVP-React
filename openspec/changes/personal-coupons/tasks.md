# Tasks

Tasks marked **[needs D-open n]** wait for that owner decision (design.md, "Decisions pending"); they are not built on an assumption.

Database checks re-measure the live state; none assumes a fixed count. Every concurrency test runs two transactions in parallel, on two connections, against a local or branch database. A single rolled-back block does not count as proof.

## 1. Schema (phase 1 of D8)

- [ ] 1.1 `npx supabase migration new coupons_and_campaign_pricing`. In dependency order (D4), create:
  - `coupon_assignments` with the frozen-terms trigger and the idempotency key unique per source (one per sales call) (D3), and the D16 constraint: at most one active (not consumed, void or expired) assignment per phone;
  - `coupon_assignment_options`, unique per assignment and package, frozen with the assignment;
  - `coupon_assignment_events`, insert-only;
  - `campaign_pricing` as append-only pricing rounds (D2): `id` PK, the one-current-row partial unique index on `(campaign_id) where superseded_at is null`, the same partial uniqueness for `coupon_assignment_id`, the FK to `coupon_assignments`, `superseded_at`/`superseded_by`, the price check constraint, and the `version` trigger.

  All four tables: RLS on, no grants to anon or authenticated, writes only through the functions in 1.2. Verify on live (read-only after push): no grant to anon or authenticated; every FK exists.
- [ ] 1.2 In the same change set: `bind_coupon_assignment` (including moving the option), `release_coupon_assignment` (D5), `approve_package_terms` with its request id (D7), `supersede_campaign_pricing` (D22: reasons `benefit_accepted`/`lapsed_reapproval`, refused on any pending/review/succeeded package payment, one-way superseded mark, campaign back to `pending_approval`), and `open_package_payment` (D22: current+locked round, amount equal, bound benefit unexpired at open, in the PENDING insert's transaction). `signed_agreements` gains a unique approval request id and the pricing round it was rendered from. All take row locks in the D6 order and are `SECURITY DEFINER`, executable by the service role only. Verify:
  - two parallel binds of one assignment: exactly one succeeds;
  - two parallel approvals: exactly one stores an agreement;
  - an approval in parallel with a bind: the approval sees the bound price or refuses on version, never a mix;
  - an approval with a stale version stores nothing;
  - a release on a locked or paid campaign is refused;
  - moving to a package without an option returns the list price and leaves one assignment;
  - a supersede in parallel with an open: they serialize on the campaign lock — the session opens on the new round or the supersede is refused by the pending row, never a session on a superseded price;
  - a supersede while a payment is pending, in review or succeeded is refused;
  - a superseded row refuses every further update.
- [ ] 1.3 The lock trigger (D6), the phase-1 sync trigger (`campaigns.package_price` → `campaign_pricing`), and the phase-1 approval-lock trigger (D8). Copy the price of every campaign that has one. Lock every campaign that was ever approved, whatever its status now (`approved_at` set or a `signed_agreements` row), at its approval time. Verify:
  - the equality query (D8) returns no rows, including no approved campaign with an unlocked price;
  - each of update, unlock, re-key and delete of a locked row is refused;
  - a phase-1 price change on an unlocked row without an assignment is mirrored;
  - an approval made by the old code path locks the price in the same transaction.
- [ ] 1.4 Check how campaigns and their events are deleted today (the test-event purge and `test_event_purge_blocker`) against the lock trigger. Record the result in this change. Verify: a purge of an unpaid test campaign still works; deleting a locked row is refused.

## 2. Writers and approval (phase 2 of D8)

- [ ] 2.1 `createCampaign` writes the pricing through the database, and the phase-2 mirror trigger (`campaign_pricing` → `campaigns.package_price`) replaces the phase-1 sync. Verify: unit tests for a new package campaign; the equality query returns no rows.
- [ ] 2.2 `recordPackageApproval` (the only approval path — `recordSignedAgreement` was deleted on 12.10.2026) creates an approval request id, renders from the pricing row and its `version`, and calls `approve_package_terms`. On a definite refusal it removes the uploaded PDF and asks for re-approval. On an unknown outcome it keeps the PDF and resolves it by request id (D7). A cleanup job removes only PDFs that no agreement references. `approveCampaign` stops being the package approval path. (Already done outside this change: `approveCampaign` refuses when its guarded update changes no row.) Verify: tests for a stale version, a lost race, a timeout after commit (resolved as approved, PDF kept), and a successful approval that is locked in the same transaction.
- [ ] 2.3 Add list-price and discount tokens to the package terms: new token keys in `src/lib/agreements/template.ts` (`AgreementContent`, `agreementTokens`), and the lines in the admin-managed document body (the body lives in the admin agreement page since 12.10.2026; `renderAgreementBody` refuses an empty body). Mockup and proposed clause: `ui/Terms.dc.html`. Verify: a rendered document shows all three values when a discount applies. **The wording is the owner's.**
- [ ] 2.4 The purchase paths (`cardcom-purchase`, `package-purchase`, `getCampaignForPurchase`) open through `open_package_payment` (D22): the current locked round's final price, refusing an unlocked or superseded round and an expired bound benefit (the lapse answer routes to re-approval, D15). Verify: tests for locked, unlocked, superseded, and expired-benefit-at-open; a session already open settles even when the expiry passed after opening (D20).

## 3. Settlement

- [ ] 3.1 `settleCardcomSession` keeps its existing checks and adds `TranzactionInfo.Amount` and `CoinId` (D11). Verify:
  - tests for equal, different and missing values;
  - a test that an existing check still fails when the amount matches;
  - a read-only GetLpResult on terminal 172204 shows both fields present.
- [ ] 3.2 The consume trigger on `payment_operations` (D10). Verify: in one transaction, a package payment moving to succeeded consumes the bound assignment; pending, review and failed leave it bound; the ledger row is never changed by the trigger.

## 4. Readers move to the pricing record

- [ ] 4.1 Move the remaining readers (screens, stats, labels, cancellation, package-paid, payment screen; every file `grep package_price src` finds). Verify: the grep finds only the pricing module and the contract note; tsc and the full suite pass.

## 5. Offers and assignments (coupon switch)

- [ ] 5.1 The offers table (D14) and its staff screens under `manage_billing` (`ui/Offers.dc.html`, `ui/OfferEdit.dc.html`). Verify: tests for permission, audit, and that an assignment freezes the offer's terms.
- [ ] 5.2 Eligibility and claim. The binding is applied at package choice for:
  - a staff assignment to the account;
  - an assignment to a phone equal to the account's verified phone, claimed once.

  Verify: tests that a shared link or a profile referral never applies or reveals an offer, and that a verified matching phone does.
- [ ] 5.3 Expiry (D15), automatic-move-only release (D17), the best-price choice among several benefits (D18), and the post-approval path: a benefit on an approved unpaid campaign supersedes the locked pricing and requires re-approval at the discounted price (D21) — all decided. Verify: tests per rule, including that payment opens only on the latest approved price.
- [ ] 5.4 The assignment after a refund stays consumed (D19), and a session opened in validity completes with its discount (D20) — both decided. Verify: tests per rule, including the consume trigger consuming an assignment whose expiry passed mid-session.
- [ ] 5.5 The acceptance flow (ש5/D21/D22): the owner of a benefit with approved, unpaid terms sees "יש לך הטבה — לחץ לקבל"; accepting runs `supersede_campaign_pricing(benefit_accepted)` and routes to approving the new terms; not accepting leaves the approved price payable. Staff void during a pending payment is refused and the row shows held-by-payment. Verify: tests for accept, ignore-and-pay-old, and the refused void.

## 6. Sales agent

- [x] 6.1 `get_pricing` adds `package_id`. Verify: route test.
- [ ] 6.2 (D14, D16 decided) `apply_discount_tier` (D9):
  - it takes the objection reason only, and checks the call's limits;
  - it writes or returns the one assignment for this call, with an option per package the offer allows, for the callback request's phone;
  - it returns `{offer, options:[{package_id, package_name, list_price, final_price}]}`, or a defined no-offer response;
  - it records the objection reason and the outcome through a service-role activity insert.

  The call scenario (`SalesCloseAgent.voxengine.js`):
  - its discount result mapper forwards `offer` and `options`, and keeps accepting the legacy `{tier, amount_or_pct}` response during the deploy. Already done outside this change and uploaded with `npm run vox:upload:salesclose` (11.10.2026, scenario 920396);
  - a communication failure keeps returning the existing "not configured" result, so the agent promises nothing.

  Verify: route tests — a repeat call returns the same assignment and options; a failed write returns "no offer"; no caller-sent price, value or package is used. Scenario: tests or a recorded test call for an offer, no offer, and a communication failure.
- [ ] 6.3 Update the agent's prompt so it quotes the returned final prices for the packages in the benefit, says the customer chooses at signup, promises only after the tool answers, and tells the caller the offer waits for the phone it was called on. Use the sanctioned flow: `agents pull --update` → edit → `agents push` → `pull --update`. Verify: the pulled config matches; a real test call is transcribed (CLAUDE.md voice-agent rule).

## 7. Screens (D12)

- [ ] 7.1 Package choice (`ui/Main.dc.html`, `ui/Mobile.dc.html`, states in `ui/States.dc.html`): on every package the benefit allows, the list price, discount and final price; the benefit moving when the package changes before approval; the message for an ended benefit. **The wording is the owner's.** Verify: component tests per state; RTL and keyboard check; a runtime check in the browser.
- [ ] 7.2 A neutral invitation to verify the phone (`ui/States.dc.html`) for an account without a verified phone. It reveals nothing about offers. Verify: a test that the response is identical whether or not an offer exists for any phone.
- [ ] 7.3 Staff assignment list and assign form (`ui/Assignments.dc.html`, `ui/AssignNew.dc.html`): state, options, source, bound campaign, chosen package and its payment outcome, plus assign and void, and the guard row for a succeeded payment whose assignment was not consumed (D10). Verify: permission tests; an assignment held by a payment in review is shown as such.

## 8. Contract (phase 3 of D8)

- [ ] 8.1 Run the equality query (D8) on live. Verify: it returns no rows; the output is recorded in this change.
- [ ] 8.2 Rollback rule (D8): before the coupon switch turns on, add the query listing campaigns that carry an assignment to the runbook. Verify: it returns a seeded test campaign with an assignment, and nothing else.
- [ ] 8.3 After the deploy of groups 1–7: `npx supabase migration new drop_campaigns_package_price`. It drops the mirror trigger and the column; then regenerate the types. Verify: tsc and the full suite pass; nothing reads the old column.
