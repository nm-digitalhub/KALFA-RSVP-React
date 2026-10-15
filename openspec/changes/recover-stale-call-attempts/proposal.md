# Proposal

## Why

The concurrency cap that every outbound call dispatcher enforces counts our own rows, not live provider sessions: `countActiveCallsAllSurfaces()` sums the rows of `call_attempts`, `callback_request_attempts` and `sales_call_attempts` whose status is `queued`, `dialing` or `in_progress`. A row that never receives its terminal callback stays in that count for good, and the scheduled reconcile job (`QUEUES.callReconcile`, every 10 minutes) only sends a Slack alert for rows older than 15 minutes; it never settles them (verified: the alerter in `voximplant-reconcile.ts` contains no write). With the default cap of 5, five orphaned rows hold every campaign's calls back until someone repairs the rows by hand. Found 16.10.2026 while making refused calls retry (change `retry-scheduled-calls-on-transient-skips`), which turns this from silent loss into long deferral until the event ends. Today all three tables have no stuck row (every row is settled), so this is a latent jam, not a live one.

## What Changes

- Two independent layers, so one failing cannot leave the other exposed:
  1. **Capacity ceiling**: the active-call count ignores rows older than a ceiling that no real call can reach, so a stuck row can never hold a slot longer than that.
  2. **Recovery**: the reconcile job settles rows it can prove stale, using existing helpers, and keeps its alert.
- A row with no confirmed provider session that is stale settles as `start_unknown` through the existing `markStartUnknown` (the call may have gone out and is never redialled).
- A row with a provider session id is checked against the provider's call record and, when the session has ended, settled through the same processing the post-call webhook uses; when the provider says it is still running it is left alone; when the provider has no record after a longer proof window it settles as `start_unknown`.
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
