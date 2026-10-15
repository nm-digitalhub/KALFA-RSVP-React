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
- [ ] 4.4 Owner decision on the admin-stop rounds (design, Open decisions).
