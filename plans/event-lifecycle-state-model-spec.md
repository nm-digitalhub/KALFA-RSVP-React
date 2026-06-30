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

### R2b — `rsvp_deadline` must not be set in the past (WRITE-TIME rule, not a continuous invariant; ADDITIVE to the existing CHECK)
- **Found live (2026-06-30):** event `ec7c68d1` (draft, `event_date=2026-07-10`) had
  `rsvp_deadline=2026-06-29` saved while `today_IL=2026-06-30` — i.e. a deadline
  **already in the past at the moment it was saved**. The existing CHECK
  `events_rsvp_deadline_within_event` only bounds the deadline from **above**
  (`<= event_day_IL`, and requires `event_date IS NOT NULL` when a deadline is
  set); it has **no lower bound**, so this passed every layer (DB CHECK, the live
  `5aed01c` Zod refines, and the UI `max=eventDate`) without being rejected. Root
  cause: a missing rule, not a bypass of an existing one.
- **ARCHITECTURAL CORRECTION (2026-07-01, round 2): the CHECK
  `events_rsvp_deadline_within_event` is NOT touched, dropped, or superseded.**
  It stays the single, unchanged, authoritative enforcement for the two
  **value-based, immutable** invariants it already encodes:
  1. `rsvp_deadline` requires `event_date IS NOT NULL`;
  2. `rsvp_deadline <= event_day_IL` (the upper bound).
  These are intrinsic data-consistency rules (don't depend on the current
  instant), so a CHECK is the correct, simplest mechanism — no migration changes
  it. **R2b adds ONE NEW, SEPARATE, ADDITIVE trigger-only rule** for the single
  piece the CHECK structurally cannot express (a CHECK predicate must be
  IMMUTABLE; `now()`/`today_IL` is not):
  ```sql
  -- R2b's ENTIRE new obligation — nothing else:
  rsvp_deadline IS NULL OR rsvp_deadline >= today_IL
  ```
  Combined, the full effective range a deadline must satisfy is the CHECK's
  predicate **AND** R2b's: `rsvp_deadline IS NULL OR (event_date IS NOT NULL AND
  today_IL <= rsvp_deadline AND rsvp_deadline <= event_day_IL)` — but that
  combination is enforced by **two independent, coexisting mechanisms**, not one
  trigger reproducing the other. **Decision: `>= today_IL`, NOT `>= tomorrow_IL`**
  — a deadline of **today is legal until end of day (Israel)**; no mandatory
  buffer-before-the-event is enforced (buffer is RSVP etiquette advice, not a
  system constraint).
- **Evaluated at write-time only** — the new trigger logic fires on INSERT, on a
  `draft`-only change of `event_date` OR `rsvp_deadline` (the R5 lock-after-draft
  window), and on the `draft → active` publish transition (R3) — re-checked at
  publish because `today_IL` has moved forward since the deadline was set, even
  though R3 itself keeps the date values unchanged.
- **NOT a continuous invariant — this is the critical distinction.** The new
  lower-bound check is evaluated only at the write moments above. Once a deadline
  is validly set, it is allowed to **elapse naturally**: the event stays valid,
  and public RSVP simply closes when `today_IL > rsvp_deadline` (the existing
  `submit_rsvp` / `get_rsvp_by_token` deadline check — unchanged). **No rule here
  may block an unrelated, non-scheduling write** (renaming, venue edit, close,
  cancel, settle, etc.) merely because the event's deadline has since passed. R2b
  governs only the moment a date is being *set*, never a row that has since aged
  past it. (The CHECK's two invariants, by contrast, ARE continuously enforced —
  exactly as they already are today — because every row, at every instant,
  satisfies them by construction; that doesn't change.)
- **DB:** the existing CHECK `events_rsvp_deadline_within_event` is **UNCHANGED,
  KEPT, and remains authoritative** for invariants 1–2 above. A **NEW, additive**
  trigger-only check (`now()`/`today_IL` is non-immutable ⇒ cannot be a CHECK) is
  folded into the same `BEFORE INSERT` trigger as R1/R2 and the same
  `BEFORE UPDATE` status/date-transition trigger as R3/R5/R6/R7, so it fires at
  INSERT, at a draft date/deadline edit, and at `draft→active` — checking **only**
  the lower bound; it never re-validates the upper bound or the
  requires-event_date rule (the CHECK already guarantees those unconditionally on
  every write, so duplicating them in the trigger would be redundant). **App:**
  `createEvent`/`updateEvent` guard mirrors the lower bound only;
  `publishEvent` re-validates the live deadline against the live `today_IL` before
  flipping status. **Zod:** a new `rsvp_deadline` refine "may not be before today",
  **chained onto — not replacing —** the live `5aed01c` refines (deadline requires
  `event_date`; deadline `<= event_date`). **UI:** `rsvp_deadline` input
  `min = today_IL` (Israel); the live `5aed01c` `max = eventDate` coupling stays.

### R3 — `draft → active` requires a concrete future date, and is status-only
- **Predicate:** transition allowed only if
  `event_date IS NOT NULL AND event_day_IL > today_IL`.
- **No date change during publish:** the `draft→active` write MUST NOT also change
  `event_date` or `rsvp_deadline` — both must be `NEW IS NOT DISTINCT FROM OLD`.
  Dates are saved earlier **while `draft`**; publishing is a **status-only**
  operation. This blocks a combined REST `PATCH {status:'active', event_date:…}` that
  would set a date and publish in one request, and removes any ordering ambiguity
  with R5 (lock-after-draft).
- **DB:** status-transition trigger (see R6) checks both the future-date predicate
  and the no-date-change rule on `draft→active`. **App:** a `publishEvent` action
  sends **status only**. **UI:** the **Publish** button is disabled with an explainer
  until a valid future date is saved.

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
  **App:** `updateEvent` **omits `event_date`/`rsvp_deadline` from the patch entirely
  when not draft** (so R5 is unreachable from the app by construction; the DB trigger
  is the authority). **Zod:** n/a (cross-row). **UI:** date + deadline inputs disabled
  (read-only) when not draft.

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
  query `campaigns`; a CHECK may not). **The trigger MUST be `SECURITY DEFINER`** so
  its `public.campaigns` read is **independent of the writer's RLS** — cross-table
  enforcement has to be authoritative by construction, not "authoritative by RLS
  coincidence" (a future writer who can UPDATE `events` but not SELECT that event's
  `campaigns` would otherwise count 0 and close under a live campaign). **App:**
  `closeEvent` guard. **UI:** **Close** disabled with "close or cancel the campaign
  first" until satisfied.

### R8 — Campaign cancel transition (`draft` / `pending_approval` / `approved` → `cancelled`)
- **Rationale:** R7 requires winding a campaign down before the event can close. An
  owner with no UI path would be **stuck** behind a campaign — so a **minimal
  "cancel campaign" button SHIPS in this phase**. **`draft → cancelled` is included**
  because R7's blocking set contains `campaign.status='draft'`: without a
  `draft→cancelled` path a `draft` campaign would block event-close with **no
  self-service exit**. (A `draft` campaign **normally** has no hold/charge — but
  the no-financial-commitment predicate below is **always evaluated**, never
  assumed true for any state including `draft`; nothing is exempt from the check.)
- **Self-service cancel is allowed ONLY for a campaign with NO financial commitment.**
  The exact predicate, **fully NULL-safe** (a new campaign's `capture_status` and
  `charge_status` are NULL, so a bare `<>` / `NOT IN` would evaluate to NULL =
  not-true and wrongly reject — use `IS DISTINCT FROM` per value / `IS NULL`):
  ```sql
  status IN ('draft', 'pending_approval', 'approved')
  AND capture_status IS DISTINCT FROM 'authorized'
  AND capture_status IS DISTINCT FROM 'pending'
  AND capture_status IS DISTINCT FROM 'hold_review'
  AND charge_status IS NULL
  AND NOT EXISTS (SELECT 1 FROM billed_results b WHERE b.campaign_id = <campaign>)
  ```
  Result: `capture_status` NULL (no hold) **and** `hold_failed` ARE cancellable;
  `authorized` (money held), `pending` (hold in flight), `hold_review` (ambiguous)
  are NOT. Any non-NULL `charge_status`
  (`pending/charged/charge_failed/charge_review/nothing_to_charge`) blocks
  self-service cancel.
  > **Adjusted from the reviewer's literal clause:** `capture_status NOT IN
  > ('pending','hold_review')` is itself NOT null-safe (`NULL NOT IN (…)` → NULL →
  > not-true → a brand-new campaign would be un-cancellable). Rewritten as per-value
  > `IS DISTINCT FROM` to honor the stated intent (NULL / `hold_failed` cancellable).
- **Enforcement — DB-AUTHORITATIVE (cancel is a financial-operational transition):**
  the **RPC `cancel_campaign(campaign_id)`** (`SECURITY DEFINER SET search_path =
  ''`, service_role-only, every table reference `public.`-qualified) is **the app's
  path** — it re-checks the predicate inside the transaction with `… FOR UPDATE`
  and is what `cancelCampaign` calls. The **`BEFORE UPDATE` trigger
  `campaigns_guard_cancel`** (also `SECURITY DEFINER SET search_path = ''`, all
  refs `public.`-qualified) is the **authoritative DB-level gate for ANY direct
  `UPDATE … SET status='cancelled'`** — whether issued through the RPC, by
  service_role directly, or by any future code path — so the predicate cannot be
  bypassed regardless of caller. In short: **RPC = the intended app entry point;
  trigger = the backstop that makes the rule true unconditionally.** **App:**
  the RPC itself trusts the caller completely (service_role-only, no caller
  identity) — **ownership is therefore the app's job, BEFORE the RPC is ever
  called**: `cancelCampaign(campaignId)` must load the campaign's `event_id`,
  verify the current user owns/has access to that event (`requireOwnedEvent` /
  the appropriate campaign-management access check), and only then call
  `admin.rpc('cancel_campaign', …)`. The `campaignId` (and any `eventId`) is
  **never trusted from the browser** to imply authorization — it is always
  re-derived and re-checked server-side. **UI:** minimal Cancel button (rendered
  only when the predicate holds).
- **Model fit:** one-per-event is an **app convention, NOT a DB constraint** —
  `getCampaignForEvent` selects the event's campaign with `.neq('status','cancelled')`
  (**no partial-unique index exists in live**; only `campaigns_pkey`). So after a
  cancel, a **replacement** campaign can be created. A >1-non-cancelled row is
  informational data-quality, not a lifecycle violation.
- **Out of scope:** cancelling a financially-committed campaign (authorized hold /
  accrued usage / active charge) — needs a close / release / reconciliation path.

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
| R2b deadline ≥ today (write-time, not continuous) — **ADDITIVE** | ✅ CHECK `events_rsvp_deadline_within_event` (existing, UNCHANGED — requires-date + ≤event) **+ NEW trigger** (lower bound only) at INSERT + draft UPDATE + publish | ✅ createEvent/updateEvent/publishEvent | ✅ refine (chained onto `5aed01c`) | deadline `min`=today (max=eventDate stays) |
| R3 publish needs future date | ✅ transition (+ re-checks R2b) | ✅ publishEvent | — | Publish disabled |
| R4 today rides (runtime) | (unchanged L0a/L1/L2) | (unchanged) | — | — |
| R5 lock date+deadline after draft | ✅ UPDATE | ✅ updateEvent | — | inputs disabled |
| R6 one-way transitions + no-op | ✅ UPDATE | ✅ publish/close only | — | Publish/Close |
| R7 no close under live campaign | ✅ UPDATE cross-table | ✅ closeEvent | — | Close disabled |
| R8 cancel (draft/pending/approved→cancelled, no $ commitment) | ✅ cancel_campaign RPC + BEFORE UPDATE trigger (null-safe predicate) | ✅ cancelCampaign→RPC | — | ✅ minimal Cancel button |
| R9 commercial needs active event | ✅ campaigns + RPC | ✅ all commercial paths | — | entry gated |

---

## 7. S0 — Preflight for EXISTING data (must run before the triggers go live)

New triggers reject invalid writes; existing rows that already violate the
invariants must be reconciled first so legitimate edits don't get stuck and the
data stays coherent. **Query buckets (restructured, round 2):**

| code | scope | meaning |
|---|---|---|
| **V1a** | `draft` events with `event_date <= today_IL` | a stale draft date — would fail R2/R3 on next edit/publish attempt; informational until touched |
| **V1b** | `active` events with `event_date IS NULL` | should be structurally impossible post-R3 (publish requires a concrete future date) — a TRUE violation if found, flags pre-existing/legacy data |
| **V1c** | events whose `rsvp_deadline` already fails the **full** combined predicate (CHECK's two invariants **and** R2b's new lower bound together) | the comprehensive correctness check, independent of which mechanism (CHECK vs trigger) is responsible for which part |
| **V3** | operational-state campaign (`pending_approval/approved/scheduled/active/paused`) on a non-`active` event | R9 violation (unchanged from round 1) |
| **V4a** | `closed` events with a blocking-state campaign | a TRUE violation — under the new rules a closed event should never coexist with a non-terminal campaign |
| **V4b** | `active` events whose `event_date` is already past, with a blocking-state campaign | **NOT a violation right now** — R7 only fires on an attempted *close*; this is a **manual cleanup queue** (things that will need a decision when someone tries to close them), not a hard preflight gate |
| **V5** | >1 non-cancelled campaign per event | informational data-quality only (app convention, no DB constraint) — unchanged from round 1 |

**Note (explicit, was previously ambiguous):** a `closed` event with `event_date
IS NULL` is **NOT** a violation (unlike V1b for `active`) — legacy/pre-system
closed events may legitimately have no date on file; only `active` requires one,
because R3 enforces it at the moment of publishing.

**Live findings (2026-06-30 snapshot — re-run at execution time):**

| ref | bucket(s) | finding | decision |
|---|---|---|---|
| `ec7c68d1` | V3 + V1c | `draft`, `event_date=2026-07-10` (future) — an `approved` campaign `bac77347` exists on it (V3); its `rsvp_deadline=2026-06-29` already fails the combined predicate's new lower bound (V1c) | **MANUAL, NO auto-fix.** Branch: (a) test/no-commitment → cancel the campaign (R8); (b) real event → resave a deadline satisfying both the CHECK and R2b (`today_IL <= rsvp_deadline <= event_day_IL`) while still `draft`, **then** verify + publish. Never automatic. |
| `03733daf` | V4b | `active`, `event_date=2026-06-22` (already past) — a `pending_approval` campaign blocks any future close attempt | **Manual cleanup queue, not an immediate violation.** When ready to close this event, cancel the campaign via R8 first. |
| `00000000…` | V5 | `active`, `event_date=2026-07-22` (future) — 6 non-cancelled campaigns (2 `authorized`, 1 `active`, not `cancel_campaign`-able) | **Informational residual only.** Explicitly **NOT** part of S2.5 remediation work — these specific campaigns cannot be cancelled (financial commitment), and V5 is not a blocking lifecycle violation. |

**V1a / V1b currently empty** (no live hits found) — kept as standing defensive
preflight checks for data integrity, not because a violation is known to exist.

S0 deliverable: a **read-only preflight query set** (V1a/V1b/V1c/V3/V4a/V4b/V5)
plus a short runbook that **records an explicit human decision per TRUE
violation** (V1b, V1c, V3, V4a) and separately tracks V4b as a non-blocking
cleanup queue and V5 as a permanent informational residual. **S0 does NOT execute
any fix** — the cancel/publish mechanisms don't exist until S1/S2. The recorded
decisions are carried out in **S2.5**, through the tested R8/publish paths (never
ad-hoc SQL). S0 is reviewed and signed off **before** S1 is applied.

---

## 8. Phasing (forward-only; each phase independently verifiable)

> **Ordering invariant:** nothing executes a cancel/publish on real data until the
> R8/publish **mechanism exists and is tested**. S0 only *decides*; remediation runs
> in S2.5.

- **S0 — Preflight (READ-ONLY, decision only):** the violation query set + a manual
  human decision recorded per exception (esp. `ec7c68d1`, `03733daf`). **No
  remediation is executed here** — `cancelCampaign` / publish do not exist yet.
- **S1 — DB triggers (authoritative):** R1, R2, **R2b**, R3, R5, R6, R7 on `events`; R9 on
  `campaigns` + the event-active check in `try_record_billed_result`; **and the R8 DB
  guard** (`cancel_campaign` RPC + the `→cancelled` BEFORE UPDATE trigger). Supersedes
  the L0a UPDATE trigger. **Tested in an isolated PG16 cluster** (the L0a/L2 method),
  applied via `supabase db push --linked` after approval.
- **S2 — App + Zod:** `createEvent`/`updateEvent` guards; `publishEvent`/`closeEvent`
  actions; `cancelCampaign` (calls the R8 RPC); commercial guards (R9); Zod date
  refine. TDD.
- **S2.5 — Approved remediation of S0 exceptions:** apply each recorded human decision
  (e.g. `03733daf` → cancel via R8; `ec7c68d1` → cancel **or** explicit publish)
  **through the now-existing, tested R8/publish mechanisms** — never ad-hoc SQL.
- **S3 — UI:** replace the status **dropdown** with **Publish** / **Close** actions
  (state-aware, disabled with explainers); date + deadline inputs disabled when not
  draft; a **minimal "Cancel campaign" button** (R8) so an owner can clear a stuck
  campaign and then close the event; reuse the past-event banners. TDD where logic
  exists; build-verified.
- **S4 — Verify + final hole sweep:** isolated-PG trigger tests, lint/tsc/vitest/
  build, and a re-run of the S0 query set proving **zero BLOCKING R1–R9 violations**
  remain (every V3/V4 S0-decision handled or documented; **V5 stays informational**).

---

## 9. Testing strategy

- **DB triggers:** isolated PG16 cluster (TCP, short datadir) with a minimal faithful
  schema + enum labels from live; RED/GREEN assertions per rule (the L2 method,
  12/12 precedent). Critical cases: insert non-draft→forced draft; date today→reject,
  tomorrow→ok, null→ok; date/deadline edit when active→reject, when draft→ok;
  active→draft→reject, closed→active→reject, draft→active without date→reject,
  no-op→ok; close with operational campaign→reject, with cancelled→ok;
  campaign insert on draft event→reject; `pending_approval→cancelled`→ok;
  **`draft→cancelled` (no hold/charge)→ok**, and a `draft` campaign blocking a
  close→reject until cancelled then close→ok; cancel with `capture_status='authorized'`
  →reject (RPC `not_cancellable` + trigger blocks the direct UPDATE).
  **R2b — explicit cases, split by WHICH mechanism is responsible:**
  **(new trigger, lower bound only)** `rsvp_deadline = yesterday` → **reject** (at
  INSERT, at a draft date/deadline UPDATE, and at `draft→active`); `rsvp_deadline =
  today` → **accept** (the `>= today_IL`, not `>= tomorrow_IL`, boundary).
  **(existing CHECK `events_rsvp_deadline_within_event`, UNCHANGED — exercised as
  regression coverage, not new trigger logic)** `rsvp_deadline = event_day` →
  **accept** (upper-bound boundary); `rsvp_deadline` set **after** `event_date` →
  **reject** (upper bound); `rsvp_deadline` set with `event_date IS NULL` →
  **reject** (requires-date). And — the non-invariant guarantee — an **unrelated
  update on a row whose `rsvp_deadline` has already naturally elapsed** (e.g.
  renaming an `active` event whose deadline is now in the past) → **NOT blocked**
  (the new trigger never fires outside the write-time paths listed above; this
  case isn't even touching `event_date`/`rsvp_deadline` so R5's lock applies, and
  the CHECK is satisfied by the existing row regardless of elapsed time since it's
  not time-dependent).
- **App/Zod:** vitest, TDD (mirror the existing events/campaigns suites).
- **UI:** `next build` + reasoning; pure logic via `isPastEventDay`-style helpers.

---

## 10. Out of scope (YAGNI) / risks / rollback

- **Out of scope:** auto-closing past events (no `pg_cron`); cancelling a campaign
  with an authorized hold / accrued usage (needs a release/reconciliation path) and
  the wider cancel matrix (`scheduled/active/paused → cancelled`); reopening closed
  events; changing the runtime "today valid" rule.
- **Risk:** triggers rejecting legitimate existing edits → mitigated by **S0**.
- **Migration safety (B3):** renamed triggers are `DROP TRIGGER … / CREATE TRIGGER …`
  (there is **no** `CREATE OR REPLACE TRIGGER`). The S1 migration is **fail-safe-ordered**
  — the new guards are created **before** L0a is dropped, so a mid-migration failure
  leaves L0a (or L0a+new) active, **never an unguarded window**. It does **NOT** rely
  on an assumed `db push` transaction wrapper, and adds no explicit `begin/commit`.
- **Rollback:** forward-only; a follow-up migration re-creates the L0a triggers (in
  git history) and drops the new guards; no data rewrite in S1.
- **R2b simplification (round 2):** the CHECK `events_rsvp_deadline_within_event`
  is never touched by this migration (no drop, no recreate), so the
  CHECK-supersession risk surface from round 1 no longer exists — R2b is a purely
  additive new trigger for the lower bound only.

## 11. Definition of done

R1–R9 + R2b enforced at the DB layer (REST-proof) and mirrored in app/Zod/UI;
**S4's re-run of the S0 preflight shows V1b, V1c, V3, and V4a ACTUALLY AT ZERO —
every TRUE violation found in S0 must be genuinely resolved (cancelled/published/
fixed) through the built mechanisms, not merely "recorded" or "deferred."** A
documented human decision in the S0 runbook is the START of remediation, not the
finish — **"explicitly deferred" is a release BLOCKER, not a passing state of
S4.** `V4b` (non-blocking cleanup queue) and `V5` (permanent informational
residual) are the ONLY buckets allowed to remain non-empty. The status dropdown
is replaced by Publish/Close; lint/tsc/vitest/build green; isolated-PG trigger
tests green; spec + plan committed.

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
   only would strand owners). Cancel covers `draft→cancelled`, `pending_approval→cancelled`
   **and** `approved→cancelled` (`draft` added so R7's `draft` blocker can never
   deadlock a close), only with **no financial commitment**, enforced by the
   **NULL-safe predicate** in R8 (`IS DISTINCT FROM` per value + `charge_status IS
   NULL` + no `billed_results`) and made **DB-authoritative**: both
   `cancel_campaign` (the RPC, the app's entry point) and `campaigns_guard_cancel`
   (the `→cancelled` BEFORE UPDATE trigger, the unconditional backstop for any
   direct UPDATE) are `SECURITY DEFINER SET search_path = ''` with every table
   reference `public.`-qualified — not just App/UI.
4. **Expert-review fixes (2026-06-30) — RESOLVED:** **B1** the R7 cross-table read is
   `SECURITY DEFINER` (RLS-independent of the writer); **B2** one-per-event is an app
   convention (no partial-unique index) and a >1 row is *informational*, not a blocking
   violation — S4 requires zero *blocking* R1–R9; **B3** the S1 migration is
   fail-safe-ordered (new guards before L0a drop), not reliant on a tx wrapper. Plus:
   `updateEvent` omits dates when non-draft; `already_cancelled` = idempotent success;
   app R9 covers all commercial paths (sign/J5/send/worker) as defense-in-depth;
   `event_not_active` follows `event_passed`; `min=tomorrow` on the date input; V4 uses
   `HAVING>0`; `canCancel` uses the full R8 predicate (incl. `billed_results`).
5. **R2b — `rsvp_deadline` lower bound — RESOLVED (2026-07-01, found via live-data
   inspection of `ec7c68d1`; corrected round 2, same day):** the existing rule
   only bounded the deadline from above (`<= event_day_IL`); a deadline already in
   the past was silently writable at every layer. New rule: `rsvp_deadline >=
   today_IL`, checked **only at write-time** (create / draft date-or-deadline edit
   / `draft→active` publish) — **never** as a standing invariant, so a deadline
   that elapses naturally never blocks an unrelated later write. Lower bound is
   **`>= today_IL`** (NOT `>= tomorrow_IL`) — same-day deadlines remain legal
   until end of day (Israel); no mandatory pre-event buffer is enforced. **The
   live CHECK `events_rsvp_deadline_within_event` is NOT touched, dropped, or
   superseded** — it stays the sole, unchanged authority for "deadline requires
   `event_date`" and "deadline `<= event_day_IL`"; R2b's new trigger is purely
   **additive**, checking only the lower bound, folded into the same triggers as
   R1–R3/R5–R7. Chained onto, not replacing, the live `5aed01c` Zod refines and UI
   coupling. S0 gets a new **V1c** finding (`ec7c68d1` is the one live hit).
6. **Round-2 architectural corrections (2026-07-01) — RESOLVED:** (a) R2b is
   additive-only — the CHECK is never dropped (see #5, corrects the round-1
   "supersedes the CHECK" framing); (b) R8's `cancel_campaign` RPC and
   `campaigns_guard_cancel` trigger are both `SECURITY DEFINER SET search_path =
   ''` with `public.`-qualified table refs throughout, and `try_record_billed_result`'s
   new R9 check reads `public.events`; the RPC is the app's path, the trigger is
   the unconditional DB-level gate (not "the only path") — see #3; (c) the app
   layer (S2.3) must distinguish "key absent from the update input" (a disabled,
   non-draft date field — never sent by the browser) from "key present" (an
   explicit attempt to set it, legal only while `draft`) via `FormData.has(...)`,
   and must **REJECT** (not silently drop) a forged request that explicitly
   includes `event_date`/`rsvp_deadline` for a non-draft event; (d) S0's query set
   is restructured into V1a (stale draft date) / V1b (active+null date, a true
   violation) / V1c (full combined predicate) / V3 (unchanged) / V4a (closed+blocking,
   a true violation) / V4b (active-past+blocking, a non-blocking manual cleanup
   queue, not a violation) / V5 (unchanged, informational); a `closed` event with
   `event_date IS NULL` is explicitly NOT a violation; (e) `00000000…`'s campaigns
   are removed from S2.5's cancel-example list (B2 consistency — those specific
   campaigns are not `cancel_campaign`-able; `00000000…` is V5-informational only,
   never part of remediation work).
7. **Round-3 corrections (2026-07-01) — RESOLVED:** (a) **R8 ownership** —
   `cancelCampaign(campaignId)` is **not** authorization by itself (the RPC is
   `service_role`-only with no caller-identity check); the app MUST load
   `campaign.event_id` server-side, verify the current user owns/has access to
   that event, and only THEN call the RPC — `campaignId`/`eventId` from the
   browser are never trusted to imply authorization (see R8's "App:" bullet);
   (b) **phase-ordering precision** — S1 (applying the triggers) requires only
   S0 **sign-off** (decisions recorded), NOT that every legacy row already
   passes — triggers are write-time-only and are never retroactively scanned
   against existing rows, so deploying with known legacy exceptions is safe;
   S2.5 is what actually resolves V1b/V1c/V3/V4a through the new mechanisms;
   **S4 requires those four buckets to be GENUINELY EMPTY** — a "documented/
   deferred" decision is the **start** of remediation, not a passing state of
   S4 (see §11, corrected); V4b/V5 remain the only non-blocking buckets,
   unchanged; (c) **`createEvent` needs its own explicit data-layer guard**
   (not just the Zod refine) — `isBeforeTomorrowIL`, NULL allowed (a date-less
   draft), today/past rejected — mirroring `updateEvent`'s defense-in-depth
   pattern; (d) **`actions.ts` cleanup** — `status` must be removed from the
   `updateEventAction`'s Zod `safeParse` call, from its destructure, and from
   the `updateEvent` payload entirely (R6 already makes `publishEvent`/
   `closeEvent` the only legitimate writers of `status`; leaving it in the
   update-form payload would be a dead/contradictory parameter), alongside the
   `FormData.has()` presence mapping for `event_date`/`rsvp_deadline` (#6c).
