# Proposal

## Why

The staff benefit screens shipped as a thin first cut (personal-coupons 7.3): a 200-row
unpaginated list filtered in memory, no detail page, an exact-email scan capped at 1,000
users, payment attribution by campaign ranking, and a browser `window.confirm` for void.
The owner's spec (docs/briefs/personal-coupons-screens-spec-he.md, 13.10.2026) defines the
production-grade panel: the team must see who holds which benefit, what prices were
promised, its validity, binding and consumption state, and what is allowed right now.

## What Changes

- **List** (/admin/assignments): concise rows (customer, offer title, unified display
  status, expiry, details link), server-side search/filter/sort/pagination (q, status,
  source, offer, sort, page; 25/page, stable sort), a global exception count independent
  of the page/filter with a "דורש בדיקה" entry, honest empty/error states, mobile cards
  instead of a 64rem table.
- **Detail page** (/admin/assignments/[id], NEW): recipient + account-claim state, saved
  terms and source (agent call / staff, assigned_by), frozen options (list/discount/final
  per package, from coupon_assignment_options only), current binding (event, campaign,
  chosen package by package_id), payment attempts attributed via
  payment_operations.pricing_round_id → campaign_pricing → coupon_assignment_id, history
  from coupon_assignment_events, allowedActions (display-only). Permission-gated links.
- **Assign screen**: an account-lookup step (server-resolved, not a 1,000-user scan;
  explicit confirm of the found account; active benefits shown), explicit offer choice
  (no silent first-option default), stale-offer refresh ("תנאי ההצעה השתנו"), idempotency
  key bound to the original request (a replay with a different target/offer is refused),
  navigate to the created/returned assignment's detail page.
- **Void**: moves to the detail page as an AlertDialog with a REQUIRED reason (≤500
  chars, kept in meta.staff_reason), server-decided under locks, release+state+event as
  one transaction, no success answer when nothing changed, repeat void writes no second
  event.
- **Data-layer corrections** (spec §2): the unified display-status model (derived פגה,
  void reasons from history), package matching by id (never name), an idempotent-retry
  answer that returns the SAVED options (not a fresh computation), exception counting via
  pricing_round_id (never the pending>review>succeeded ranking), email lookup that is not
  serial-per-row, history writes checked.

Out of scope (owner's explicit exclusions): objection categories, any change to the
agent's tool/prompt, price editing, validity extension, benefit transfer, staff-to-phone
assignment, bulk void, customer messaging. Unifying the agent/staff writers is NOT a goal;
if a hard technical dependency on it appears, it is surfaced in design before any scope
change. The /admin/offers screens stay separate.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `coupon-assignments`: the staff visibility and operation requirements — paginated
  server-side listing, the assignment detail view, the account-lookup assign flow, the
  reasoned atomic void, and the pricing_round_id-based payment attribution and exception
  guard.
