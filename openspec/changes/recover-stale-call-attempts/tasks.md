# Tasks

Plan only. Nothing below starts before the owner answers the open decisions in the design.

## 1. Capacity ceiling

- [ ] 1.1 Add the age ceiling to `countActiveCalls`, `countActiveCallbackDispatches` and `countActiveSalesDispatches`, with the ceiling as one shared constant. Verify: tests per table for a stale row (not counted), a fresh row (counted), and the boundary.
- [ ] 1.2 Test through `countActiveCallsAllSurfaces`: orphaned rows in all three tables at the cap do not block a dispatch.

## 2. Recovery

- [ ] 2.1 Rows with no provider session id: settle through `markStartUnknown` after the stale threshold. Verify: a test that a row that reached a terminal status in the meantime is unchanged.
- [ ] 2.2 Rows with a provider session id: look up the session with the existing history helpers; ended → the webhook's processing function; running → unchanged; absent after the proof window → `start_unknown`; lookup error → unchanged. Verify: one test per branch, and a test that applying the same ended session twice does not duplicate billing or RSVP effects.
- [ ] 2.3 One summary alert per run that settled anything. Verify: a test that no personal data is in the fields.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm run typecheck`, `npm run worker:deps`, focused tests, then the full suite.
- [ ] 3.2 Live check after deploy: reconcile logs show a run with zero rows, and an artificially aged row in a throwaway test database settles as designed.
