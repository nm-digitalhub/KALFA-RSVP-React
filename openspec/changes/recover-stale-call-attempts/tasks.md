# Tasks

Decided 16.10.2026: 45-minute capacity ceiling (capacity only), 2-hour provider-absence proof window, automatic recovery. Tasks 2.1 and 2.2 come before any recovery code that touches a provider session.

## 1. Capacity ceiling (stands alone, removes the jam)

- [ ] 1.1 Add the 45-minute age ceiling to the three active counts, with one shared constant. Verify: tests per table for a row older than the ceiling (not counted), a fresh row (counted), the boundary, and that the row's status is untouched.
- [ ] 1.2 Test through `countActiveCallsAllSurfaces`: orphaned rows in all three tables at the cap do not block a dispatch.
- [ ] 1.3 Race test: a row older than the ceiling receives its terminal callback afterwards and settles normally (the ceiling only affected the count).
- [ ] 1.4 Guard test: no source file inserts a call attempt row with status `queued`, so `created_at` stays the age source.

## 2. Prove the provider lookup

- [ ] 2.1 Add a helper that reads the provider's record by session id with the project's own client (read-only), and prove `session id -> exactly one record` with a real known session. Verify: a test, and a written result in this change.
- [ ] 2.2 Decide D4 (a) or (b) from what 2.1 shows the provider can supply, and record the decision here.

## 3. Recovery

- [ ] 3.1 Rows with no provider session id: after the 15-minute threshold, settle through each surface's own helper (`markStartUnknown`, `markCallbackDispatchUnknown`, `markSalesDispatchUnknown`). Verify: per surface, including that a row that reached a terminal status in between is unchanged.
- [ ] 3.2 Rows with a provider session id, per D4: ended, running, absent after the 2-hour proof window, lookup error. Verify: one test per branch, and a test that settling the same ended session twice does not duplicate billing or RSVP effects.
- [ ] 3.3 If D4 (a): split `processCallResult` into parse and `applyCallOutcome`, keeping the webhook route's behaviour unchanged. Verify: the existing webhook tests pass untouched.
- [ ] 3.4 Alerts: the stuck-set alert unchanged; one recovery summary per run that settled anything; a row settled in a run is not reported stuck in that run. Verify: tests on the alerter state across a partial settle, and that the fields hold no personal data.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm run typecheck`, `npm run worker:deps`, focused tests, then the full suite.
- [ ] 4.2 After deploy: the reconcile logs show a run with zero rows, and a deliberately aged row in a throwaway database settles as designed.
