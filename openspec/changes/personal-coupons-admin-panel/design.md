# Design

Source: docs/briefs/personal-coupons-screens-spec-he.md (13.10.2026), read against the
shipped screens (ac24fdf0) and the live schema. The spec's texts are proposals; nothing
here changes business rules.

## Decisions

- **AD1 — list/detail split.** The list stays concise (customer, offer title, display
  status, expiry, details link); everything else moves to /admin/assignments/[id].
  No side drawer. Back-to-list preserves q/status/source/offer/sort/page via validated
  params only — never a free client-supplied return URL.
- **AD2 — one display-status mapper.** A single pure function derives the display
  status (and void reason from history) for list and detail; פגה is computed at read
  time. It lives in the data layer so both screens and tests share it.
- **AD3 — server-side query.** listStaffAssignments gains (filters, pagination) and
  returns {rows, total, page, pageSize, globalGuardCount, guardCheckStatus}. Filtering,
  sorting and counting run in SQL (indexed where needed); the in-memory ?state= filter
  and limit(200) go away. Rows stop loading options/history; the list query slims to
  what it shows. guardCheckStatus distinguishes "checked: N" from "check failed".
- **AD4 — exception guard by pricing_round_id.** The guard joins
  payment_operations(outcome=succeeded, kind=package_purchase).pricing_round_id →
  campaign_pricing.coupon_assignment_id → assignment.state <> 'consumed', over the whole
  table. The current pending>review>succeeded display ranking stays for the payment
  BADGE only, never for the guard.
- **AD5 — detail reader.** getStaffAssignmentDetail(id) returns assignment, recipient,
  source, frozenOptions, currentBinding, relatedPricingRounds, paymentAttempts, history,
  allowedActions {canVoid, blockReason}, warnings. allowedActions is display-only; the
  void action re-decides. Partial failures return section-level unavailable markers, not
  a thrown page.
- **AD6 — account lookup.** lookupStaffAssignmentRecipient(email) resolves server-side
  without the 1,000-user page scan — preferred: an exact-email query against the Auth
  schema through the existing server-only admin path (the project already reads
  auth.users server-side elsewhere); answers found/not_found/unavailable with minimal
  fields + the account's active benefits. The assign action re-validates account and
  offer on confirm.
- **AD7 — idempotency with request binding.** coupon_assignments already carries the
  unique idempotency_key; the replay answer changes to read the SAVED assignment +
  options (today it recomputes current prices). Request binding (same key ⇒ same
  target+offer) is enforced by comparing the stored row's user_id/offer_id to the replay
  and refusing mismatches — no schema change needed.
- **AD8 — atomic void.** The void gains a required staff reason (meta.staff_reason on
  the event; the operational reason code stays the machine value). Release + state +
  event must commit together: reuse release_coupon_assignment and the existing guards
  inside ONE transaction. Today's TS sequence is not atomic, so this follows the proven
  pattern of replace_sales_coupon_assignment: a service_role-only SQL function
  (void_staff_coupon_assignment) created via `npx supabase migration new`, locking in
  the SAME campaign → round → assignment order (acceptance 20: verify release's lock
  order matches before relying on it). Writer unification with the agent path is NOT
  pulled in — the void function is the only new shared-mechanics surface, and no
  technical dependency on unifying the creators was found.
- **AD9 — assign create stays TS-side.** createStaffAssignment keeps its current write
  path (insert + options + event with the existing delete-on-partial-failure rule) —
  acceptance 16 is covered by the existing constraints plus tests; no create RPC is
  required by the spec. If stage-ד testing proves otherwise, that becomes its own
  decision, presented before widening scope.
- **AD10 — permissions unchanged.** Everything stays behind manage_billing per function
  (the coverage test enforces it); links to /admin/users/[id] (manage_staff + access
  reason) and /admin/events/[id] (view_events) render only when the viewer holds those
  permissions. No new RLS grants; the browser never touches the tables.
- **AD11 — UI reuse.** Pagination, Badge, Button, AlertDialog, FormError, SubmitButton,
  formatCurrency, Israel time formatting. Mobile: cards for the list, stacked blocks for
  options. No new table/form/Sheet library; design tokens only.

## Risks

- The guard join and the filtered count need to stay cheap: add indexes only where
  EXPLAIN on the local DB shows they are needed; schema work, if any, is its own
  reviewed migration.
- Concurrency acceptance (19–20) runs on the LOCAL DB with two real connections, the
  same harness as the replacement RPC's proof.
- Auth email lookup variance: AD6's query path must be measured against a seeded local
  Auth table beyond 1,000 users before the scan is deleted.

## Out of scope

Objection categories, agent tool/prompt changes, price editing, validity extension,
benefit transfer, staff-to-phone assignment, bulk void, customer messaging, offers-screen
restructuring, payments rewrite.
