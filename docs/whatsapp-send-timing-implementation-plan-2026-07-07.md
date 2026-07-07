# WhatsApp send-timing — corrected implementation spec (P0 + P1a, one PR)

**Date:** 07.07.2026 · **Basis:** research `docs/whatsapp-send-timing-israel-2026-07-07.md` + owner review (`text.md`, 07-07). Supersedes the first draft. Cross-cutting messaging change → this is the agreed spec; implement in reviewable steps, verify, **no deploy without approval.**

## 0. What the review corrected (all incorporated below)
Not a wrapper around `touchpointTime`; a real **model change**. `nextSendSlot` → a **send|skip decision** taking `expiresAt`. hebcal needs an explicit **Location**. **P1a spread is mandatory** (deferral to one window-open would burst worse than today). A **second gate right before the real send**. **`plannedAt` persisted**, separate from `detId`/`startAfter`, with an **explicit re-planning path**. Policy in **one validated `app_settings` value**.

## 1. Model change — planned send time (replaces "event − hours")
The schedule lives in `campaigns.outreach_schedule` (jsonb `Touchpoint[]` = `{days_before, channel, message_key}`, read in `outreach-engine.ts:120`). The touchpoint keeps `days_before`; the **preferred time-of-day** comes from policy.

`plannedSendTime(eventDateIso, daysBefore, policy) → instantMs`:
1. `eventIlDate = israelCalendarDay(eventDate)` (reuse `event-date.ts`).
2. `targetDate = eventIlDate − daysBefore CALENDAR days` (string date math, not ×24h).
3. `hhmm = policy.preferredTime(daysBefore)` (e.g. 7d→`11:00`, 3d→`17:30`, default `11:00`).
4. `instant = Date.parse(ilWallTimeToIso(targetDate, hhmm))` — DST-correct, **reuses `event-date.ts:77`**.
So an event at 23:00 yields a reminder on the correct **business day** at the preferred hour — never "next day 09:00".

## 2. `resolveSendSlot` — decision, not a bare time (pure, injected deps)
`resolveSendSlot({ plannedMs, nowMs, expiresAtMs, policy, calendar, spread }) →`
`{ decision:'send', at:number } | { decision:'skip', reason:'expired'|'event_passed'|'no_window_before_expiry' }`
Algorithm: `t = max(plannedMs, nowMs)`; while `t` is blocked (`calendar.isBlocked`) or outside the local window → advance to the next window opening (`calendar.nextClear` for Shabbat/Yom-Tov; else next in-window minute). If `t > expiresAtMs` at any point → `skip`. Else apply **spread (§3)** and return `send`. `nowMs` is only a floor.

## 3. Deterministic spread (P1a) — mandatory, window-aware
- Planned time already inside the window → offset within `[0, policy.spreadSpanMs)` from a hash of `(campaignId, contactId, stepIndex)` (same construction as `detId`, `schedule.ts:75` → stable & idempotent).
- Planned time **deferred** to a new window opening → spread across the **new window's opening**, **bounded to that window's close** (so 1,000 msgs deferred from Fri/Shabbat do NOT all fire Sun 09:00:00). If the spread would cross the close → clamp / carry the remainder to the next open day (deterministic bucketing by hash).

## 4. Shabbat / Yom-Tov — `src/lib/outreach/jewish-calendar.ts` (@hebcal/core)
Explicit **`Location` = Jerusalem** default (candle-lighting/havdalah depend on coordinates; `il:true` only sets holiday *custom*, not location). Blocked interval = candle-lighting → havdalah **+1h**, hard-capped so a late motzash never pushes past the 21:00 cap. `isBlocked(ms)`/`nextClear(ms)`, built once per worker run for the next ~N days, injected into §2 (keeps §2 pure). **Future:** per-event venue city/coords on the event → per-event Location.

## 5. Pre-send gate — EXTEND the existing `stepGate` (reuse, don't duplicate)
`stepGate` (`outreach-engine.ts:151`) already re-checks: outreach enabled, campaign active, `close_at`, `isPastEventDay`, event active, `isContactReached`. `executeStep` already checks `removal_requested` + consent. **Add** to the gate, evaluated **immediately before `sendOneWhatsApp`**: time-window/Shabbat/holiday block, message **expiry**, (answered ≈ existing reach check). New `GateReason`s: `'window'` (defer) and `'expired'` (skip). The worker: on `'window'` **re-enqueue** at the next slot (NOT a job failure); on `'expired'`/`'stopped'` don't send. Rate-budget check is a P1b no-op hook here.

## 6. Idempotency & persistence — `detId` / `plannedAt` / `startAfter`
- **Migration:** add `outreach_state.planned_at timestamptz null` (the first-decided instant for the current step).
- On enqueue: if `planned_at` set for this step → reuse it as the planning basis (stable across re-arm); else compute (§1–§3), persist, then enqueue with `startAfter`. `detId` stays the logical key (ON CONFLICT DO NOTHING for the queue row), but correctness no longer *relies* on it papering over a recomputed time.
- **Explicit re-planning path:** on event-date edit / policy change / campaign cancel → clear `planned_at` for **future** steps (a targeted update) so they re-plan; past/in-flight steps are gated at send time. (Wire into the event-update + campaign-cancel actions.)

## 7. Config — one validated `app_settings` value `whatsapp_send_policy`
Single JSON: `{ weekday:[{start,end}|null ×7], fridayCutoff, hardCap:'21:00', motzashPlusMin:60, preferredTimeByDaysBefore:{...}, defaultPreferred:'11:00', spreadSpanMs, location:'jerusalem' }`. Seeded defaults (§8), **server-side Zod validation + safety bounds** (admin may *narrow* a window; opening night/Shabbat sends requires a conscious code change, not a settings edit). No `09:00`/`20:30`/`12:00`/span literals scattered across worker/actions/helpers — all read from here.

## 8. v1 default policy (owner-specified)
Sun–Thu 09:00–20:30 (hard cap 21:00) · Fri 09:00–12:00 (nothing after 12:00 even if candle-lighting is late) · Shabbat/Yom-Tov: blocked from entry until **havdalah+1h but never after 21:00**; if the renewal opens after 20:30 → defer to the next open day 09:00. (No contradictory "22:00 after Shabbat".)

## 9. Files
New: `src/lib/outreach/send-window.ts` (§1–§3 pure), `src/lib/outreach/jewish-calendar.ts` (§4), `src/lib/outreach/send-policy.ts` (§7 type+defaults+Zod). Migration: `outreach_state.planned_at` + `app_settings` seed. Edit: `worker/main.ts` (two enqueue sites → planned_at + resolveSendSlot; `'window'` re-enqueue), `outreach-engine.ts` (extend `stepGate`; re-planning helpers), event-update + campaign-cancel actions (clear future `planned_at`), `@hebcal/core` dep.

## 10. Tests — acceptance criteria (owner list) MUST pass
1. Event at 23:00 → reminder lands on the correct business day/hour, not next-day 09:00.
2. A reminder deferred from Shabbat is never sent before a legal window opens.
3. 1,000 recipients deferred to one morning do NOT share a `startAfter` (spread, bounded to window).
4. Double run → no duplicate message (claimStep + detId + planned_at).
5. Guest who answered / was removed after scheduling but before execution → not sent (gate).
6. Event-date change → future jobs explicitly re-planned.
Plus DST-boundary, Yom-Tov, and `resolveSendSlot` expiry unit tests. Verify `lint`/`tsc`/`build`/vitest.

## 11. Phasing
**This PR:** §1–§10 (P0 + P1a). **Separate P1b:** global token-bucket/rolling-window rate budget, capacity metrics, Meta overload-response handling.
