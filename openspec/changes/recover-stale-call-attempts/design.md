# Design

## Facts (each read in code or measured, 16.10.2026)

- `countActiveCallsAllSurfaces()` = `countActiveCalls()` + `countActiveCallbackDispatches()` + `countActiveSalesDispatches()`. Each counts rows in `['queued','dialing','in_progress']` of its own table, with no age bound (src/lib/data/call-attempts.ts, callback-request-attempts.ts, sales-call-attempts.ts).
- `createCallAttempt` inserts the row as `dialing` before the provider is called; `recordDialConfirmed` stores the provider session id afterwards. So a row stuck without a session id is a worker that stopped in that gap, and the call may or may not have started.
- Terminal statuses are `completed`, `failed`, `no_answer`, `no_response`, `cancelled`, `handed_off`. `failed_to_start` and `start_unknown` are written by `markFailedToStart` / `markStartUnknown` and are in neither the terminal nor the active set, so they free the slot. `recordCallOutcome` only moves a row that is still active, so settling cannot overwrite a real outcome.
- Terminal outcomes arrive through the post-call result processing (`call-result-processing.ts`), fed by the Voximplant callback. If that callback never arrives, nothing else settles the row.
- The reconcile job runs every 10 minutes (`QUEUES.callReconcile`), selects rows older than `STUCK_AFTER_MS` = 15 minutes in an active status, and only calls `sendSlackAlert` (the alerter function contains no write).
- Longest call by configuration: the agents' `max_duration_seconds` are 600 (RSVP), 300 (Meeting Confirm) and 300 (Sales Close).
- Right now `call_attempts` has no row in an active status, and `callback_request_attempts` (13) and `sales_call_attempts` (25) are all `concluded`.

## Decisions

**D1. A ceiling on the count, independent of recovery.** The three counts add `created_at >= now - CEILING`. The ceiling is three times the longest configured call plus ring time, 45 minutes as a starting value. It is a safety net: even if the reconcile job fails or is slow, no orphan holds a slot beyond it. It cannot undercount a real call, because no call lasts that long.

**D2. The stale threshold stays a trigger for checking, not for closing.** Fifteen minutes decides when to look at a row, as today. What the row becomes is decided by what is known about it (D3, D4).

**D3. No provider session id: settle as `start_unknown`.** That is the status the code already uses for "the call may have gone out; never redial". It frees the slot without claiming a failure or risking a second dial. Written through `markStartUnknown`, which only acts on an active row.

**D4. With a provider session id: ask the provider, then act.** Reuse the existing Voximplant history helpers (src/lib/voximplant/call-snapshot.ts, call-history-normalize.ts, `fetchReturnableCall`). Ended: apply the outcome through the same function the webhook path uses, so billing and RSVP effects happen once and idempotently. Running: leave the row. Not found after a proof window (2 hours as a starting value): `start_unknown`. Lookup error: do nothing this run.

**D5. One alert per run.** The existing stuck-row alert stays; a settle adds a single summary alert (table, count, path), no personal data.

**D6. All three tables, one rule.** The three surfaces share the cap, so they share the ceiling and the settle rules; only the status column name differs (`status` and `dispatch_status`).

## Risks

- D4 depends on the provider's history being queryable by session id promptly; if it is not, the proof window decides, which is why the window is long.
- Applying an ended session through the webhook's own processing must stay idempotent; the existing guard in `recordCallOutcome` and the reach recorder's `billed_results` uniqueness are what make a double application harmless. A test must prove it.
- The ceiling hides a row from the count but not from the reconcile alert, which is the intent.

## Open decisions (owner)

1. The ceiling (45 minutes proposed) and the proof window (2 hours proposed).
2. Should the reconcile job settle rows automatically, or only alert as today and let the ceiling alone remove the jam? The ceiling alone is the smaller change; settling also repairs the data (and any lost RSVP outcome).

## Out of scope

Re-dialling a `start_unknown` call, and any change to a status value or table.
