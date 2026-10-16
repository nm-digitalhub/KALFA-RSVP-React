# Tasks

## 1. Next window instant

- [x] 1.1 Add `nextHumanCallWindowStart` to `src/lib/data/console-calls.ts` next to `isWithinHumanCallWindow`. Verify: `console-calls.test.ts` (10 new cases: inside, before, after, Saturday, Friday afternoon, an edited week, no window, beyond the horizon, Yom Tov, and a property check that every returned instant passes the gate and is the first that does). Passed.

## 2. Pure wait decision and the re-send

- [x] 2.1 Add `src/lib/outreach/call-dispatch-wait.ts`: reasons, per-reason waits and spreads, `decideCallWait`, `callWaitJobId`, `deferCall`. Verify: `call-dispatch-wait.test.ts` (ids, counter, expiry bound, unknown event end, wait limit, per-reason waits, spread ranges, the re-send call). Passed.
- [x] 2.2 Add `dispatchWaits?: number` to `OutreachCallRequest` in `src/lib/queue/queues.ts`.

## 3. Dispatcher and worker

- [x] 3.1 `dispatchOutreachCall`: return `deferred` for the dial window, concurrency cap, hourly cap and balance-under-reserve refusals of a non-manual job; keep `skipped`/`blocked` for a manual job; alert on the first delivery only. Extend `CallDispatchResult`, `call-dispatch-status.ts` and `voice-agent-actions.ts`. Verify: `outreach-calls.test.ts` covers each reason for scheduled, repeated and manual dials, and "no attempt row, no provider call". Passed.
- [x] 3.2 `worker/main.ts`: pass `boss` to `handleCallRequest`; on `deferred` load the campaign's event date, decide, re-send or settle with a log and an ops alert. Verify: the decision is covered by 2.1; typecheck proves the call sites; the worker bundles (esbuild to a scratch directory, `dist/worker.cjs` untouched).

## 4. Verification

- [x] 4.1 `npm run lint` clean, `npm run typecheck` clean, `npm run worker:deps` no violations, focused tests (67 files, 1,697 tests) passed, full suite 734 files / 12,731 tests passed (6 files and 40 tests skipped, as before).
- [ ] 4.2 `npm run build`: not run by the author (the owner started `npm run deploy` instead, which builds from this tree; no source file changed after its `.deploy-id`).
- [ ] 4.3 Live check after the worker restarts: a call round dispatched outside the dial window shows `call-request deferred` in `pm2 logs kalfa-worker` and is dialled when the window opens.
- [x] 4.4 Owner direction on the admin-stop rounds received 16.10.2026 (design, Owner direction); the one consequence to confirm is in that section.

## 5. Operational stops (decided in direction, not built)

- [ ] 5.1 Confirm with the owner that a kill switch no longer cancels pending call rounds (design, Owner direction).
- [ ] 5.2 Add `outreach_disabled`, `live_calls_disabled`, `config_missing`, `campaign_paused` and `waiting_for_quota` to the deferral reasons with their own waits; split `campaign_not_active` by the campaign's status (only `paused` waits). Settle answers stay the original ones. Verify: dispatcher tests per reason for scheduled and manual dials, and that cancelled, closed and past-event campaigns stay final.
- [ ] 5.3 Revalidate on return: every gate runs again, including the new ones. Verify: a test where the stop ended and the call is placed, and one where the campaign was cancelled meanwhile and nothing is placed.
- [ ] 5.4 Alerts: first delivery only for the repeating reasons; one ops alert when the round settles unplaced. Verify: tests.
