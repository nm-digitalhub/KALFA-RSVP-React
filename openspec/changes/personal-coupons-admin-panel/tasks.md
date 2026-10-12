# Tasks

Stages follow the spec's §15 order. After every stage: lint, `npx tsc --noEmit`, the
touched suites; the full suite + build before the final commit of the change. Reading
AGENTS.md's Next.js docs note applies before UI work.

## Stage א — data layer

- [ ] א.1 The unified display-status mapper (state + expires_at + history reason →
  label), shared by list and detail. Verify: unit tests covering every row of the
  spec's §5 table, incl. expired-assigned → פגה and consumed-past-expiry → מומשה.
- [ ] א.2 listStaffAssignments(filters, pagination): SQL-side q (exact normalized
  email/phone), status, source, offer, sort (+id tiebreak), 25/page, total of the
  filtered set; rows slim to list fields; email resolution not serial-per-row. Verify:
  tests for filter beyond 200 rows, out-of-range page correction, invalid-param
  normalization, fetch-failure shape.
- [ ] א.3 The global guard via pricing_round_id (AD4): globalGuardCount +
  guardCheckStatus, independent of page/filter; the ranking stays display-only.
  Verify: tests — exception off-page found; pending does not mask succeeded; failed
  check reported as unavailable, not zero.
- [ ] א.4 getStaffAssignmentDetail(id) (AD5): all sections, package matching by
  package_id, payment attempts via pricing_round_id, history ordered at,id with
  actor labeling rules, allowedActions display-only, section-level failure markers.
  Verify: tests incl. missing-options warning, unknown-action event rendering,
  historical consumption visible after release.
- [ ] א.5 Idempotent replay answers the SAVED assignment+options and refuses a
  same-key/different-request replay (AD7). Verify: test — retry after a price change
  returns the frozen options; mismatched replay refused.

## Stage ב — list + detail screens

- [ ] ב.1 /admin/assignments rewritten on א.2/א.3: concise table (desktop) / cards
  (mobile, no 64rem min-width), filters/search/sort/pagination in the URL, the
  "דורש בדיקה" entry when exceptions exist, honest empty/filtered-empty/error states,
  no green banner on every load. Verify: component tests per state; params round-trip.
- [ ] ב.2 /admin/assignments/[id] (new page) rendering א.4: header, recipient, terms +
  source (callback linkage only when resolvable), frozen options table / mobile
  blocks, binding + payments (incl. the expired-but-open-payment sentence), history,
  copyable id. Permission-gated links (AD10). Verify: component tests per section,
  not-found after permission check, partial-failure rendering.
- [ ] ב.3 List→detail→back navigation preserving validated filters (AD1). Verify: test
  that a crafted return param outside the list is rejected.

## Stage ג — assign flow

- [ ] ג.1 lookupStaffAssignmentRecipient (AD6) + the account step in
  /admin/assignments/new: exact validated email, איתור חשבון → confirm card with the
  account's active benefits; found/not_found/unavailable distinct. Verify: test that a
  user beyond the provider page limit is found; failure ≠ not-found.
- [ ] ג.2 Explicit offer choice (no silent default), server-computed preview, estimated
  validity labeled as such, stale-offer refusal → "תנאי ההצעה השתנו" re-confirm.
  Verify: tests for the stale path and the explicit-choice requirement.
- [ ] ג.3 Submit: stable idempotency key per operation, double-submit blocked, success
  and duplicate-kept navigate to the resulting assignment's detail with the spec's
  messages. Verify: tests — replay message, duplicate-kept points at the KEPT row.

## Stage ד — atomic void

- [ ] ד.1 Lock-order audit of release_coupon_assignment vs the campaign→round→assignment
  order (acceptance 20); fix release first if it assumes another order. Verify:
  documented reading of both function sources + the replacement RPC.
- [ ] ד.2 Migration via `npx supabase migration new`: void_staff_coupon_assignment
  (service_role-only, SECURITY DEFINER, empty search_path) — live re-checks under
  locks, release+state+event in one transaction, staff reason to meta.staff_reason,
  no-op never answers success, repeat void writes no second event. Verify: SQL checks
  on the local DB incl. rollback-on-late-failure; grants refused to browser roles.
- [ ] ד.3 The void dialog on the detail page (AlertDialog, required reason, danger
  styling, focus kept/returned), wired to the new function; stale-state refusal
  refreshes the view keeping the typed reason. Verify: component tests; action tests
  for every refusal code.
- [ ] ד.4 Two-connection concurrency on the local DB: void vs bind/approve/open-payment
  races — one winner, zero partial writes (acceptance 19). Verify: recorded run like
  the replacement RPC's proof.

## Stage ה — closure

- [ ] ה.1 Permission acceptance (spec §14 1–3): no manage_billing → no list/detail/
  lookup/assign/void; id tampering never bypasses; links only with their own
  permissions. Verify: the admin coverage test stays green + targeted tests.
- [ ] ה.2 Browser pass at 360/390/desktop, RTL, keyboard, zoom (acceptance 24) on the
  deployed build; record findings. Verify: noted in this change with screenshots'
  findings (test data only).
- [ ] ה.3 Full gates (lint, tsc, full suite, build) + the acceptance list §14 walked
  item-by-item and recorded in verification-acceptance.md. Verify: all green before
  the change is offered for archive.
