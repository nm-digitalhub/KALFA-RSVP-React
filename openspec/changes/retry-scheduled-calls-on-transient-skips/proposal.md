# Proposal

## Why

A scheduled campaign AI-call round is lost without trace when the dispatcher refuses it only for now. `dispatchOutreachCall` answers `skipped` (dial window closed, all call slots busy, campaign hourly cap full) or `blocked` (balance under the reserve), and `handleCallRequest` in worker/main.ts completes the job on every such result, so nothing retries or reschedules it. The planner places the round by the WhatsApp send window and knows nothing of the dial window or of capacity, and the admin can narrow the dial window after a round was planned. Found 15.10.2026 while analysing host-editable send timings; the owner asked to fix it now and to cover every scenario, after the first cut handled only the dial window.

## What Changes

- Classify every dispatch outcome of a scheduled call (design table): wait-and-retry for the temporary refusals, final for the rest, and name what is left to the owner.
- Temporary refusals now return a new `deferred` result carrying the earliest moment worth asking again: dial window closed, concurrency cap reached, campaign hourly cap reached, balance under the reserve.
- `worker/main.ts`: on `deferred`, send the same job again with a deterministic id and `startAfter`, bounded by the end of the event day and a loop guard. When no moment exists before the event day ends, or the guard is reached, settle with the old answer, log it and send an ops alert. Never a silent completion.
- A manual console dial and the workflow callback action keep the old behaviour: refused and reported, never rescheduled.
- Alerts for the capacity and balance refusals fire on the first delivery only, not on every re-delivery.
- A pure `nextHumanCallWindowStart` returns the next instant the live dial window is open, built from the same calendar and weekday window as `isWithinHumanCallWindow`.

## Capabilities

### New Capabilities
- `campaign-call-retry`: how a scheduled campaign AI-call round behaves when the dispatcher refuses it temporarily (defer, bounds, visibility, no duplicate dial, manual dials untouched).

### Modified Capabilities
<!-- none: no merged spec covers call dispatch yet -->

## Impact

- Code: `src/lib/data/console-calls.ts` (next-window helper), `src/lib/data/outreach-calls.ts` (result type, four gates), new `src/lib/outreach/call-dispatch-wait.ts`, `src/lib/queue/queues.ts` (`OutreachCallRequest.dispatchWaits`), `worker/main.ts` (handler), `src/lib/data/call-dispatch-status.ts` and `src/lib/workflow/voice-agent-actions.ts` (the new kind), and a test for each.
- No migration, no new table, no new queue, no new setting.
- Left to the owner, see design "Open decisions": what happens to rounds refused because of an admin stop (kill switches, missing configuration, a paused campaign) or a missing package seat.
