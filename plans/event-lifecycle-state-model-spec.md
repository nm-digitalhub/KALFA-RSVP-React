# KALFA — Event Lifecycle State Model (design spec)

> **Status:** DESIGN ONLY — no code, no migration written yet. This spec defines
> the rules + enforcement layers + phasing; implementation follows after approval
> via a separate plan.
> **Date:** 2026-06-30. **Author flow:** brainstorming → this spec → writing-plans.
> **Builds on:** P0 (billing-RPC lockdown), L0a (event-date INSERT/UPDATE guards),
> L1 (app `assertEventNotPast`), L2 (RSVP/billing RPC event_date guards). This
> workstream adds the **status × data state machine** on top of those date guards.

---

## 1. Problem (holes found in the flow audit)

The event lifecycle is currently **unmanaged**: `events.status` (`draft/active/closed`)
is a free dropdown the owner can set to any value, independently of `event_date`,
campaign state, or billing. Concretely (verified against code + live DB):

1. **`event_date` is editable in any status** (even `active`/`closed`) and is
   **REST-bypassable** (the `events` table has an ALL policy + full grants).
2. **Creation allows "today"** — the L0a INSERT trigger rejects only a *strictly
   past* date; Zod has **no date validation at all**.
3. **No event-status gate on campaigns** — a campaign can be created/activated on a
   `draft` event, but public RSVP requires `status='active'`, so outreach would send
   links that resolve to "closed". (Live: event `ec7c68d1` is `draft` yet has an
   `approved` campaign — this exact hole.)
4. **Status transitions are unrestricted** — an owner can reopen a `closed` event,
   jump `draft→closed`, revert `active→draft`, etc., with no coherence to the
   campaign/billing state. Reverting to `draft` would also defeat any date lock.

## 2. Goal

A single, enforceable **state machine** for events, driven by **status × data**
(date past/today/future, campaign state), enforced at the **DB layer first**
(because `events` is REST-writable) and mirrored in app/Zod/UI.

---

## 3. Definitions (one shared calendar rule — reused, not redefined)

All date logic uses the **calendar day in Asia/Jerusalem**, identical to L0a/L1/L2:

- `today_IL = (now() AT TIME ZONE 'Asia/Jerusalem')::date`
- `event_day_IL = (event_date AT TIME ZONE 'Asia/Jerusalem')::date`
- **"past"** (runtime guards, unchanged): `today_IL > event_day_IL`. An event **today
  is still valid** at runtime (`isPastEventDay` / L0a / L1 / L2 unchanged).
- **"≥ tomorrow"** (creation / publish only): `event_day_IL > today_IL`.

The asymmetry is intentional and was confirmed: **you may not create or publish an
event for today or earlier (no same-day setup), but an event already `active` rides
through its own day until end-of-day (Israel).**

---

## 4. The state machine

```
            publish (draft→active)            close (active→closed)
   ┌─────────┐  requires event_date ≥ tomorrow   ┌──────────┐
   │  draft  │ ────────────────────────────────► │  active  │ ──────► closed (terminal)
   └────┬────┘                                    └──────────┘
        │  abandon (draft→closed)                       ▲
        └───────────────────────────────────────────────┘  (no path back; no reopen)
```

**Allowed transitions (and ONLY these):**
- `draft → active` (publish)
- `draft → closed` (abandon a draft)
- `active → closed` (close)
- **no-op** (`X → X`, same status) — always allowed (re-saving an unchanged status
  must not error).

**Forbidden:** `active → draft`, `closed → *` (closed is terminal), and any other pair.

---

## 5. Rules (each with predicate + enforcement layers)

> Enforcement legend: **DB** = trigger/constraint (authoritative, REST-proof);
> **App** = server data-layer guard; **Zod** = boundary validation (UX);
> **UI** = presentational prevention. `events` is REST-writable ⇒ every event rule
> MUST have a DB layer. `campaigns` is not owner-REST-writable, but commercial
> rules still get a DB trigger as defense-in-depth (per requirement R9).

### R1 — An event always starts as `draft`
- **Predicate:** on INSERT, `status` is forced to `draft` regardless of input.
- **DB:** `BEFORE INSERT` trigger sets `NEW.status := 'draft'` (or rejects a
  non-draft insert). **App:** `createEvent` never sends `status`. **UI:** no status
  field in the create form.

### R2 — `event_date` is NULL or ≥ tomorrow (Israel), settable only while `draft`
- **Predicate (INSERT & draft UPDATE):**
  `event_date IS NULL OR event_day_IL > today_IL`.
- **DB:** extend the L0a INSERT trigger from "not past" to "≥ tomorrow"; the draft
  UPDATE path enforces the same when `event_date` changes. `now()` is non-immutable
  ⇒ trigger, not CHECK. **App:** `createEvent`/`updateEvent` guard. **Zod:**
  `event_date` refine "must be at least tomorrow". **UI:** date picker `min` =
  tomorrow.

### R3 — `draft → active` requires a concrete future date
- **Predicate:** transition allowed only if
  `event_date IS NOT NULL AND event_day_IL > today_IL`.
- **DB:** status-transition trigger (see R6) checks this on `draft→active`.
  **App:** a `publishEvent` action guards it. **UI:** the **Publish** button is
  disabled with an explainer until a valid future date is set.

### R4 — An `active` event rides through its own day
- **Predicate:** runtime "past" stays `today_IL > event_day_IL` (today valid). **No
  rule change** to L0a/L1/L2 — documented here only to fix the boundary against R2/R3
  ("no new publishing for today" vs "an already-active event today is still open").

### R5 — `event_date` AND `rsvp_deadline` are locked once status ≠ `draft`
- **Predicate:** on UPDATE, if `OLD.status <> 'draft'` then
  `NEW.event_date = OLD.event_date AND NEW.rsvp_deadline = OLD.rsvp_deadline`
  (NULL-safe via `IS NOT DISTINCT FROM`); otherwise RAISE. Other fields stay editable.
- **DB:** `BEFORE UPDATE` trigger (supersedes the L0a `UPDATE OF event_date`
  trigger; now covers `rsvp_deadline` too and keys on status, not on "past").
  **App:** `updateEvent` rejects date/deadline changes when not draft. **Zod:** n/a
  (cross-row). **UI:** date + deadline inputs disabled (read-only) when not draft.

### R6 — Only the allowed transitions; closed is terminal; no-op allowed
- **Predicate:** `OLD.status = NEW.status` → allow. Else allow only
  `(draft→active, draft→closed, active→closed)`; everything else RAISE.
- **DB:** `BEFORE UPDATE` status-transition trigger. **App:** `publishEvent` /
  `closeEvent` are the only writers of `status` (the free dropdown is removed).
  **UI:** explicit **Publish** / **Close** actions (no status dropdown).

### R7 — Cannot close an event while a campaign is still operational
- **Predicate — keyed on `campaign.status` ONLY** (never `charge_status` /
  `order.status`): `→closed` is blocked if any campaign of the event is in a
  **blocking** state:
  `{draft, pending_approval, approved, scheduled, active, paused}`.
  **Non-blocking** (the event may close): `{closed, awaiting_invoice, billed, paid,
  cancelled}`.
  The billing tail (`awaiting_invoice/billed/paid`) is **not** an active-outreach
  state — it is *not* accounting-final, but the event may close while a document,
  charge, or reconciliation is completed **afterwards**. (The existing
  `closeCampaignAndCharge()` already treats close and charge as separate operations.)
- **DB:** cross-table check inside the R6 status-transition trigger (a trigger MAY
  query `campaigns`; a CHECK may not). **App:** `closeEvent` guard. **UI:** **Close**
  disabled with "close or cancel the campaign first" until satisfied.

### R8 — Campaign cancel transition (`pending_approval` / `approved` → `cancelled`)
- **Rationale:** R7 requires winding a campaign down before the event can close. An
  owner with no UI path would be **stuck** behind a campaign — so a **minimal
  "cancel campaign" button SHIPS in this phase** (not data-layer only).
- **Allowed transitions:** `pending_approval → cancelled` **and** `approved →
  cancelled`, but ONLY when the campaign carries **no financial commitment**:
  `capture_status <> 'authorized'` **AND** no `billed_results` rows **AND** no final
  charge / active charge state. A campaign with an authorized J5 hold or accrued
  usage is **not** cancellable by a normal click — it needs a close / release /
  reconciliation path (**out of scope** here).
- **Model fit:** campaigns start `pending_approval`; `cancelled` is excluded from the
  one-per-event partial UNIQUE (`WHERE status <> 'cancelled'`), so a **replacement**
  campaign can be created later. **Scope:** `cancelCampaign` data fn + server action
  (race-safe optimistic guard, ownership-gated, financial-commitment check) + a
  minimal Cancel button. Wider cancel (`scheduled/active/paused → cancelled`) stays
  out of scope unless requested.

### R9 — Every commercial campaign action requires `event.status = 'active'`
- **Predicate:** creating a campaign, and transitioning it into/within the
  operational states (`pending_approval/approved/scheduled/active`), and recording a
  billed result, all require the parent `event.status = 'active'`.
- **DB:** `BEFORE INSERT/UPDATE` trigger on `campaigns` rejecting operational states
  when the parent event isn't `active`; the `try_record_billed_result` RPC also
  checks `event.status='active'` (it already derives the campaign's event in L2).
  **App:** guards in `createCampaign`/`approveCampaign`/`activateCampaign`/
  `recordSignedAgreement`/hold + send paths. **UI:** campaign entry shown only for
  `active` events (the past-event UI from the prior phase is reused/extended).
  > Cancel/close/settle are **not** commercial-forward actions and remain allowed
  > regardless of event status (wind-down + settlement).

---

## 6. Enforcement matrix (summary)

| Rule | DB trigger | App guard | Zod | UI |
|---|---|---|---|---|
| R1 start draft | ✅ INSERT force | ✅ | — | no status field |
| R2 date ≥ tomorrow / draft-only | ✅ INSERT + draft UPDATE | ✅ | ✅ refine | date `min`=tomorrow |
| R3 publish needs future date | ✅ transition | ✅ publishEvent | — | Publish disabled |
| R4 today rides (runtime) | (unchanged L0a/L1/L2) | (unchanged) | — | — |
| R5 lock date+deadline after draft | ✅ UPDATE | ✅ updateEvent | — | inputs disabled |
| R6 one-way transitions + no-op | ✅ UPDATE | ✅ publish/close only | — | Publish/Close |
| R7 no close under live campaign | ✅ UPDATE cross-table | ✅ closeEvent | — | Close disabled |
| R8 cancel (pending/approved→cancelled, no $ commitment) | (state allowed) | ✅ cancelCampaign + checks | — | ✅ minimal Cancel button |
| R9 commercial needs active event | ✅ campaigns + RPC | ✅ all commercial paths | — | entry gated |

---

## 7. S0 — Preflight for EXISTING data (must run before the triggers go live)

New triggers reject invalid writes; existing rows that already violate the
invariants must be reconciled first so legitimate edits don't get stuck and the
data stays coherent. Live snapshot (2026-06-30):

| event | status | date | campaign | violation | remediation |
|---|---|---|---|---|---|
| `ec7c68d1` | draft | 2026-07-10 (future) | approved | R9 (approved campaign on a draft event) | **MANUAL exception — NO auto-fix.** Branch by judgement: (a) test data / no financial commitment → **cancel the campaign** (R8); (b) a real event meant to continue → **explicitly publish to `active`** only after verifying the date + details. Never auto-publish and never auto-cancel. |
| `03733daf` | active | 2026-06-22 (past) | pending_approval | un-closable (R7) until the campaign is cancelled | use R8 `pending_approval→cancelled`, then the event may be closed |
| `00000000…` | active | 2026-07-22 (future) | active | none (test/seed data) | none |

S0 deliverable: a **read-only preflight query set** that lists every event/campaign
violating R1–R9, plus a short remediation runbook. **No destructive auto-fix — every
case is reviewed and remediated by an explicit human decision** (esp. `ec7c68d1`).
S0 runs and is signed off **before** S1 is applied.

---

## 8. Phasing (forward-only; each phase independently verifiable)

- **S0 — Preflight (read-only):** the violation query set + remediation runbook;
  reconcile existing rows (esp. `ec7c68d1`, `03733daf`).
- **S1 — DB triggers (authoritative):** R1, R2, R3, R5, R6, R7 on `events`; R9 on
  `campaigns` + the event-active check in `try_record_billed_result`. Supersedes the
  L0a UPDATE trigger. **Tested in an isolated PG16 cluster** (the L0a/L2 method),
  applied via `supabase db push --linked` after approval.
- **S2 — App + Zod:** `createEvent`/`updateEvent` guards; `publishEvent`/`closeEvent`/
  `cancelCampaign` actions; commercial guards (R9); Zod date refine. TDD.
- **S3 — UI:** replace the status **dropdown** with **Publish** / **Close** actions
  (state-aware, disabled with explainers); date + deadline inputs disabled when not
  draft; a **minimal "Cancel campaign" button** (R8) so an owner can clear a stuck
  campaign and then close the event; reuse the past-event banners. TDD where logic
  exists; build-verified.
- **S4 — Verify + final hole sweep:** isolated-PG trigger tests, lint/tsc/vitest/
  build, and a re-run of the S0 query set proving zero violations remain.

---

## 9. Testing strategy

- **DB triggers:** isolated PG16 cluster (TCP, short datadir) with a minimal faithful
  schema + enum labels from live; RED/GREEN assertions per rule (the L2 method,
  12/12 precedent). Critical cases: insert non-draft→forced draft; date today→reject,
  tomorrow→ok, null→ok; date/deadline edit when active→reject, when draft→ok;
  active→draft→reject, closed→active→reject, draft→active without date→reject,
  no-op→ok; close with operational campaign→reject, with cancelled→ok;
  campaign insert on draft event→reject; `pending_approval→cancelled`→ok.
- **App/Zod:** vitest, TDD (mirror the existing events/campaigns suites).
- **UI:** `next build` + reasoning; pure logic via `isPastEventDay`-style helpers.

---

## 10. Out of scope (YAGNI) / risks / rollback

- **Out of scope:** auto-closing past events (no `pg_cron`); cancelling a campaign
  with an authorized hold / accrued usage (needs a release/reconciliation path) and
  the wider cancel matrix (`scheduled/active/paused → cancelled`); reopening closed
  events; changing the runtime "today valid" rule.
- **Risk:** triggers rejecting legitimate existing edits → mitigated by **S0**.
- **Rollback:** forward-only migrations; each trigger is `CREATE OR REPLACE` /
  `DROP TRIGGER IF EXISTS` re-creatable; no data rewrite in S1.

## 11. Definition of done

R1–R9 enforced at the DB layer (REST-proof) and mirrored in app/Zod/UI; S0 shows
zero residual violations; the status dropdown is replaced by Publish/Close;
lint/tsc/vitest/build green; isolated-PG trigger tests green; spec + plan committed.

---

## 12. Resolved decisions (review 2026-06-30)

1. **R7 billing tail — RESOLVED:** event-close is gated on **`campaign.status` only**
   (not `charge_status`/`order.status`). Blocking = `{draft, pending_approval,
   approved, scheduled, active, paused}`; non-blocking = `{closed, awaiting_invoice,
   billed, paid, cancelled}`. The billing tail does not block close; settlement may
   finish afterwards.
2. **S0 `ec7c68d1` — RESOLVED:** no auto-fix. Marked a manual S0 exception — cancel
   the campaign if it's test/no-commitment data, or explicitly publish to `active`
   after verifying the real date/details. Never auto-publish or auto-cancel.
3. **R8 — RESOLVED:** ship a minimal "cancel campaign" button this phase (data-layer
   only would strand owners). Cancel covers `pending_approval→cancelled` **and**
   `approved→cancelled`, only when there is no financial commitment
   (`capture_status<>'authorized'`, no `billed_results`, no active/final charge).
