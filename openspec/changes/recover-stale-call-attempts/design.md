# Design

## Facts (read in code, measured, or marked as coming from a comment)

- `countActiveCallsAllSurfaces()` = `countActiveCalls()` + `countActiveCallbackDispatches()` + `countActiveSalesDispatches()`. Each counts rows in `['queued','dialing','in_progress']` of its own table, with no age bound.
- Nothing writes a row as `queued` (no insert in src does). `createCallAttempt` inserts as `dialing` before the provider is called; `recordDialConfirmed` stores the provider session id after `StartScenarios`. `created_at` is therefore the dial moment on all three surfaces. `call_attempts` also has `last_callback_at`; the other two tables only `created_at` and `updated_at`.
- Terminal statuses are `completed`, `failed`, `no_answer`, `no_response`, `cancelled`, `handed_off`. `failed_to_start` and `start_unknown` are in neither the terminal nor the active set, so they free the slot. `recordCallOutcome` only moves a row that is still active, so settling cannot overwrite a real outcome.
- The three surfaces have their own closing helpers, not one: RSVP `markStartUnknown` (call_attempts.status), meeting-confirm `markCallbackDispatchUnknown` (callback_request_attempts.dispatch_status), sales `markSalesDispatchUnknown` (sales_call_attempts.dispatch_status).
- The reconcile job runs every 10 minutes, selects rows older than 15 minutes in an active status and only calls `sendSlackAlert` (no write; read in `voximplant-reconcile.ts`). Its alert is edge-triggered on the stuck SET, with its own state per table: it sends at once when the set of ids changes (a new row or a partial resolve), again every 6 hours while the same set persists, and resets when the set clears. State is per process.
- From comments only, not verified: an earlier incident left a test row stuck for four days (2026-07-19), and a 2026-07-21 incident was a terminal callback rejected by the schema. The same comment explains why the reconciler was made alert-only: an automated reconciler risks double-calling a call that is merely mid-flight. This design never redials, so that risk does not apply, but it is why recovery only ever settles to `start_unknown` or to a provider-proven end.
- The terminal callback payload (`voxCallbackSchema`) carries `call_status`, duration, `rsvp_method`, `finish_reason`, recording and transcript. Those come from the scenario's own knowledge of the conversation. `processCallResult` takes a persisted `webhook_inbox` row; it does no HTTP or token work itself (the route verifies and persists first), but its input is that scenario payload.
- Provider history by session id: the low-level `GetCallHistoryRequest` type has a `call_session_history_id` filter, but the helper the app uses (`fetchVoxCallHistory`) filters by window, direction, outcome, duration and phone only, and the project CLI creates asynchronous reports. A lookup by session id that returns exactly one record is NOT proven in this repository.
- Longest call by configuration: `max_duration_seconds` 600 (RSVP), 300 (Meeting Confirm), 300 (Sales Close). Today every row of the three tables is settled.

## Decisions

**D1. A ceiling on the capacity count, 45 minutes.** The three counts add `created_at >= now - 45 min`. It means "above 45 minutes the row stops consuming capacity", not "the row is closed": the row keeps its status, stays in the stuck-row alert and stays eligible for recovery. It is an operational safety net, not a proof that no real call lasts that long. Age is `created_at` on all three tables (D6).

**D2. The 15-minute stale threshold only decides when to look.** What a row becomes depends on what is known about it (D3, D4). The 45-minute ceiling and the 2-hour proof window below are separate numbers with separate jobs.

**D3. No provider session id: the surface's own "unknown" helper, after the stale threshold.** RSVP `markStartUnknown`, meeting-confirm `markCallbackDispatchUnknown`, sales `markSalesDispatchUnknown`. One rule, three writers. It is deliberately conservative: it may mark an attempt that never reached the provider, because nothing separates "the worker stopped before the request" from "the request left and the session id was lost". It frees the slot and never redials.

**D4. With a provider session id: look the session up, then act. Not yet implementable as first written.**
- Needs a proven lookup by session id (task 2.1).
- Applying the outcome "through the webhook's processing" is not possible from provider history alone: the data `processCallResult` needs (`call_status` meaning, `finish_reason`, `rsvp_method`, transcript) is the scenario's, not the provider's. Two ways forward, to be decided after 2.1: (a) split `processCallResult` into parse and `applyCallOutcome(attemptId, body)` and have the reconciler pass only what the provider can truthfully supply, or (b) settle an ended session without business effects as the surface's "unknown" status and recover the conversation's real outcome from ElevenLabs (the row already carries `el_conversation_id`) in a separate step. Until then, an ended session settles as the "unknown" status with a recorded reason; the in-call tools have already written the RSVP, so what is lost is the reach stop, not the answer.
- Session still running: leave the row. Provider has no record after the 2-hour proof window: the "unknown" status. Lookup error: do nothing this run.

**D5. Alert semantics.** The stuck-set alert stays as is. A recovery summary is sent separately, once per run that settled anything (table, count, path, no personal data). After a settle the next stuck set is computed from what remains, so the existing edge-triggered logic alerts for the remainder and not for rows already settled; a row settled in a run is not reported as stuck in the same run.

**D6. Age source.** `created_at`, because no surface creates `queued` rows and a row is created at the dial moment. A guard test fails if a future insert uses `queued`, because then `created_at` would stop meaning "dial time".

**D7. The ceiling changes the count only.** A row older than 45 minutes whose callback arrives later is settled as usual; the ceiling never writes a row.

## Risks

- D4 is the unresolved part. D1 and D3 stand alone and remove the jam without it.
- Provider history can lag; the proof window is long for that reason.
- The first reconcile run after deploy settles whatever aged rows exist; today there are none.

## Open decisions

None for the owner on the numbers (45 minutes capacity ceiling only, 2-hour proof window, automatic recovery: decided 16.10.2026). Open technically: D4 (a) or (b), after the session lookup is proven.

## Out of scope

Redialling a settled row, any change to a status value or table, and the retry rules for refused scheduled calls (change `retry-scheduled-calls-on-transient-skips`).
