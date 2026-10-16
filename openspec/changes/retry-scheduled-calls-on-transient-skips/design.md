# Design

## Context

Campaign call rounds are enqueued by the outreach engine at a slot chosen from the WhatsApp send policy (src/lib/outreach/send-window.ts), then consumed by `handleCallRequest` (worker/main.ts), which calls `dispatchOutreachCall`. That function runs a chain of gates and answers `skipped`, `blocked`, `transient_error` or a dial outcome. Every `skipped` and `blocked` completes the job (worker comment: a retry must never place a second call), so a round refused only for now is gone.

The codebase already solves a sibling problem: `deferForRegistry` (src/lib/dnc/registry-wait.ts) re-sends a job with a deterministic id and `startAfter` when the DNC registry is unavailable, bounded by a wait count. This change follows that pattern.

## Every dispatch outcome of a scheduled call, classified

| Outcome | Class | Why |
|---|---|---|
| `skipped: outside_dial_window` | **wait** until the window opens | calendar condition, passes by itself |
| `skipped: max_concurrency` | **wait** a few minutes | capacity, frees by itself |
| `skipped: campaign_hour_cap` | **wait** a few minutes | capacity, frees by itself |
| `blocked: balance_below_reserve` | **wait** a quarter of an hour | a top-up fixes it; the error alert already tells ops |
| `transient_error: balance_check_failed` | already retried by pg-boss (`CALL_RETRY`) | unchanged; a final failure alerts via `guardedWorker` |
| `skipped: no_call_consent`, `dnc_listed` | final | a person's choice; never dial |
| `skipped: already_reached` | final | the guest already answered |
| `skipped: event_closed` | final | the answer cannot be recorded |
| `skipped: concurrent_owner` | final | another dispatch owns the call |
| `skipped: waiting_for_quota` | final here | the package quota shows waiting guests visibly |
| `failed_to_start`, `start_unknown`, `dialed`, `already_*` | final | provider outcomes; an ambiguous or failed start is never dialled again (the attempt row records it) |
| `skipped: outreach_disabled`, `blocked: live_calls_disabled`, `blocked: config_missing` | **wait** (owner direction 16.10.2026, not yet built) | a temporary operational stop: ask again later and revalidate on return, as long as the round is still legal before the event; ops alert when it settles |
| `skipped: campaign_not_active` while the campaign is `paused` | **wait** (same direction, not yet built) | a pause ends; revalidate on resume |
| `skipped: campaign_not_active` for any other status (cancelled, closed, not started) and an event in the past | final | a business refusal, not a pause |
| `skipped: waiting_for_quota` | **wait** (same direction, not yet built) | a seat can open after an upgrade or a swap; the guest stays visibly waiting meanwhile |

A manual console dial and the workflow callback action (`isManual`) are never in the wait class: an operator is waiting for the answer.

## Decisions

**D1. Reuse the registry-wait pattern, no new queue.** `src/lib/outreach/call-dispatch-wait.ts`: deterministic id per (campaign, contact, touchpoint, wait), `startAfter` as a Date, `CALL_RETRY` options, a wait counter on the payload (`dispatchWaits`).

**D2. One definition of "window open".** `nextHumanCallWindowStart(fromMs, dialWeekday, horizonMs)` sits beside `isWithinHumanCallWindow` in console-calls.ts and is built from the same pieces: the Shabbat/Yom-Tov calendar (`nextAllowedAt`, resume delay 0, as the gate has none), Saturday as a belt-and-suspenders block, and the per-weekday `DayWindow`. `null` when no open instant exists in the 14-day look-ahead. A test asserts every returned instant passes the gate and is the first one that does.

**D3. The decision is pure.** `decideCallWait({ job, reason, notBeforeMs, expiryMs })` returns `defer` (next wait count, run-at) or `settle` (`no_window_before_event_end` | `wait_limit`). The worker performs the effect.

**D4. Waits per reason.** Dial window: the calendar answer. Concurrency 3 min, hourly cap 10 min, balance 15 min. Each adds a deterministic spread (2, 5, 5 and 10 min respectively) so a burst does not return as a burst.

**D5. Bounds.** The expiry is `eventDayExclusiveEndMs(event date)`, the cutoff the planner uses. An unknown event end settles, never defers without a bound. The wait limit is 300, a loop guard only.

**D6. Where the result is produced.** `dispatchOutreachCall` returns `{ kind: 'deferred', reason, notBeforeMs }` for the four reasons unless `job.isManual`. Gate order is unchanged: every refusing gate still runs before the call attempt row and before the provider call, so a deferral leaves no state behind and cannot dial twice.

**D7. Alerts.** Concurrency and balance alerts fire only when `dispatchWaits` is absent (the first delivery). Settling after the bound sends one ops alert (`send_health`) with campaign id, touchpoint, the refusal and the settle reason, and logs the same fixed strings (no PII).

**D8. The settle answer stays what it was.** On settle the job completes with `skipped` (or `blocked` for the balance) and the original reason, so everything downstream (logs, manual settlement) reads it unchanged. `FinalDispatchResult` in call-dispatch-status.ts excludes `deferred`, like `transient_error`.

## Risks

- A queued job without `dispatchWaits` counts as 0, so jobs queued before the deploy behave.
- Many deferred jobs can pile up if capacity stays full for hours; the settle bound and the alert make that visible. The hourly cap is per campaign, so one busy campaign does not block another's retries.
- The worker handler now needs `boss`; the registration closure already has it.
- `CallDispatchResult` gains a member; the typechecker proved every consumer, including `mapDispatchResult` in voice-agent-actions.ts (a manual dial, never deferred, mapped as the old refusal) and the ops script.

## Owner direction (16.10.2026) and what is built

Separate temporary operational blocks from permanent business refusals: a temporary block (capacity, window, quota, balance, a kill switch off for now, missing configuration, a paused campaign) is deferred and revalidated when it ends; a permanent refusal (consent, removal list, no longer eligible, a cancelled or closed campaign, an event in the past, a guest who already answered, a provider outcome) is final. Built and deployed: the dial window, concurrency, hourly cap and balance. Not built yet: the kill switches, missing configuration, paused campaign and quota rows above (tasks section 5).

One consequence the owner should confirm before section 5: a kill switch used as an EMERGENCY stop would no longer cancel pending call rounds; they would wait and resume by themselves when it is switched back on (still gated by consent, removal list, dial window, caps and the event end). If a switch must mean "stop everything, for good", that switch needs to stay final.

## Out of scope

Providing the host with a way to choose call times (the host-editable timings change), a needs-attention campaign state, and re-dialling after a provider failure (needs a new touchpoint index, a different design).
