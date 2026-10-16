# Proposal

## Why

The concurrency cap that every outbound call dispatcher enforces counts our own rows, not live provider sessions: `countActiveCallsAllSurfaces()` sums the rows of `call_attempts`, `callback_request_attempts` and `sales_call_attempts` whose status is `queued`, `dialing` or `in_progress`. A row that never receives its terminal callback stays in that count for good, and the scheduled reconcile job (`QUEUES.callReconcile`, every 10 minutes) only sends a Slack alert for rows older than 15 minutes; it never settles them (verified: the alerter in `voximplant-reconcile.ts` contains no write). With the default cap of 5, five orphaned rows hold every campaign's calls back until someone repairs the rows by hand. Found 16.10.2026 while making refused calls retry (change `retry-scheduled-calls-on-transient-skips`), which turns this from silent loss into long deferral until the event ends. Today all three tables have no stuck row (every row is settled), so this is a latent jam, not a live one.

## What Changes

- Two independent layers, so one failing cannot leave the other exposed (numbers decided 16.10.2026):
  1. **Capacity ceiling, 45 minutes**: the active-call count ignores rows older than the ceiling. It limits what a row consumes, it does not close the row: the row keeps its status, its alert and its recovery.
  2. **Automatic recovery**: the reconcile job settles rows it can prove stale, using each surface's own helper, and keeps its alert.
- A stale row with no provider session id settles through the surface's own "unknown" helper (`markStartUnknown`, `markCallbackDispatchUnknown`, `markSalesDispatchUnknown`): conservative, never redialled.
- A stale row with a provider session id is checked against the provider's record by session id: running is left alone, absent for the 2-hour proof window settles as "unknown". How an ended session is settled depends on a lookup that is not yet proven and on what data the provider can supply (design D4); proving the lookup is a prerequisite task.
- No change to any status value, no migration, no new table.

## Capabilities

### New Capabilities
- `call-attempt-recovery`: how a call attempt left in an active status is treated by the capacity count and by reconciliation.

### Modified Capabilities
<!-- none: no merged spec covers call attempts yet -->

## Impact

- Code: `src/lib/data/call-attempts.ts`, `callback-request-attempts.ts`, `sales-call-attempts.ts` (the three active counts), `src/lib/data/voximplant-reconcile.ts` (settle step), reuse of `call-result-processing.ts` and the Voximplant history helpers; tests for each.
- Operational: the reconcile job gains a write path, so it needs the same alert on every settle.
- Plan only. Nothing is built; the owner approves the open decisions in the design first.
