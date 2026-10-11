# Tasks

Tasks marked **[needs D-open n]** wait for that owner decision (design.md, "Decisions pending"); they are not built on an assumption.

## 1. Pricing record (expand)

- [ ] 1.1 `npx supabase migration new campaign_pricing`. Create `campaign_pricing` per design D2:
  - RLS on; `revoke all` from anon and authenticated; server-only writes;
  - copy `campaigns.package_price` into it, with list price = price, discount 0, and `locked_at` = `approved_at` for approved campaigns;
  - a lock trigger refusing any change to prices, discount or assignment once `locked_at` is set.

  Verify, in a rolled-back live block: 4 rows copied, equal to `campaigns.package_price`; an update after lock refused; a customer can neither read nor write the table.
- [ ] 1.2 `approveCampaign` sets `locked_at` in the same transaction as the approval (D6). Verify: a test proves an approved campaign's pricing is locked, and that a second approval does not move `locked_at`.
- [ ] 1.3 `createCampaign` writes the `campaign_pricing` row with the package's list price, and keeps writing `campaigns.package_price` until the contract step. Verify: unit tests for a new package campaign.

## 2. Readers and writers move to the pricing record

- [ ] 2.1 Move the purchase paths (`cardcom-purchase`, `package-purchase`, `getCampaignForPurchase`) to the locked final price, and refuse an unlocked price. Verify: tests for locked, unlocked, and a price that differs from the approved one.
- [ ] 2.2 Move package approval and agreement rendering to `campaign_pricing`, adding list-price and discount tokens to the package terms template. Verify: a rendered document shows all three values when a discount applies. **The wording is the owner's.**
- [ ] 2.3 Move the remaining readers (screens, stats, labels, cancellation, package-paid, payment screen; the 20 files found by `grep package_price`). Verify: `grep package_price src` finds only the pricing module and the contract-step note; tsc and the full suite pass.

## 3. Settlement verifies the amount

- [ ] 3.1 `settleCardcomSession` reads `TranzactionInfo.Amount` and `CoinId`, and records succeeded only on an equal amount in shekels. Otherwise it goes to review with an alert (D8). Verify: tests for equal, different and missing values; a read-only GetLpResult on terminal 172204 shows both fields present.

## 4. Coupon assignments

- [ ] 4.1 `npx supabase migration new coupon_assignments`. Create the table per D3:
  - frozen-terms trigger;
  - unique idempotency key per source;
  - the atomic binding function (D4) that writes `campaign_pricing.coupon_assignment_id` under `unique`.

  Verify, in a rolled-back live block: two concurrent binds of one assignment, exactly one succeeds; a terms update refused; a customer has no access.
- [ ] 4.2 Apply an eligible assignment when a package is chosen: discount and final price into `campaign_pricing`, state `bound`, all in one transaction. Eligibility is either a staff assignment to the account, or an assignment to a phone equal to the account's verified phone (claimed once). Verify: tests that a shared link or a profile referral never applies an offer, and that a verified matching phone does.
- [ ] 4.3 **[needs D-open 1, 3, 4, 7]** Expiry, release of a bound assignment on an abandoned campaign, the choice among several offers, and refusal after approval. Verify: tests per decided rule.
- [ ] 4.4 On a succeeded payment, set the assignment to `consumed`; pending, review and unknown leave it `bound`. Verify: tests for each payment outcome.
- [ ] 4.5 **[needs D-open 5, 6]** The assignment after a refund, and an offer that ends during an open session. Verify: tests per decided rule.

## 5. Sales agent and staff

- [ ] 5.1 **[needs D-open 2]** `apply_discount_tier` (D7):
  - resolves the call, checks the limits, writes or returns the assignment (idempotent per call) targeted at the callback request's phone;
  - returns `{offer, list_price, final_price}`;
  - records the objection reason and the outcome via a service-role activity insert.

  Verify: route tests — a repeat call returns the same assignment; a failed write returns "no offer"; no caller-sent value is used.
- [ ] 5.2 Update the agent's prompt so it quotes the returned final price and promises only after the tool answers. Use the sanctioned flow: `agents pull --update` → edit → `agents push` → `pull --update`. Verify: the pulled config matches; a real test call is transcribed (CLAUDE.md voice-agent rule).
- [ ] 5.3 Staff action to assign and void an offer for an account, gated on `manage_billing`, audited with `logActivity` (D9). Verify: tests for permission, audit and idempotency.

## 6. Contract

- [ ] 6.1 Run a live check: every campaign's approved price equals `campaign_pricing.package_price` and the amount of its succeeded payment. Verify: query output recorded in this change.
- [ ] 6.2 After the deploy of groups 1–5: `npx supabase migration new drop_campaigns_package_price`, then regenerate types. Verify: tsc and the full suite pass; nothing reads the old column.

## 7. SUMIT-era columns retire into the ledger (D10)

- [ ] 7.1 Map every reader and writer of the 25 SUMIT-era `campaigns` columns in `src` (for example `capture_status` in about 22 files, `charge_status` in about 16) and move each to the ledger (`payment_operations`), or remove it where the SUMIT path is gated. Do not route any SUMIT refund, capture or release through CardCom. Verify: tests per moved reader; `grep` finds no reader of the retired columns outside the generated types.
- [ ] 7.2 `npx supabase migration new`: update `campaigns_guard_cancel`, `cancel_campaign`, `owner_agent_billing_sums` and `test_event_purge_blocker` to stop reading the columns, reading the ledger where a fact is still needed. Verify: in a rolled-back live block, cancelling a campaign and the owner billing sums behave as before for the 2 historical campaigns.
- [ ] 7.3 **[needs D-open 8 for `sumit_customer_id`]** The card token, expiry and citizen ID are not copied (owner, 11.10.2026). Then compare, field by field, every SUMIT column of the 2 historical campaigns with their ledger rows. Verify: the comparison output is recorded in this change, with no unexplained difference other than the card values deliberately left.
- [ ] 7.4 After the deploy of 7.1–7.2 and with the owner's approval for each group, create one drop migration per column group (`auth_*`/`authorized_at`, `capture_status`/`release_status`, `card_*`, `charge_*`/`charged_at`/`final_*`, `hold_order_*`, `sumit_*`; `billing_route` per **D-open 9**). Regenerate the types. Verify: tsc and the full suite pass; a live search of functions and views finds no reference.
