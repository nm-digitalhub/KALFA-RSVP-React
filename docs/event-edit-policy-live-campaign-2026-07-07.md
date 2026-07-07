# Event-edit policy while a campaign is live (2026-07-07)

## Goal

The event-edit form must let an owner edit freely, never block them by mistake,
and — critically — **never let a "free" edit silently break a pending campaign
send.** The send path is fail-closed: `buildBodyParams` (template-spec.ts)
returns `{ missing }` for any absent required parameter, and the engine records
`params_incomplete` and **advance-skips** the touchpoint (no retry). So removing
a value the next send binds does not error — it silently drops that message.

## What every pending send binds (verified against the live schedule)

The one-per-event RSVP campaign stores its touchpoints in
`campaigns.outreach_schedule` (`Touchpoint{days_before, channel, message_key}`),
NOT `campaigns.steps`. `outreach_state.current_step_index` indexes that array,
and all times derive from the **live `event_date`** (schedule.ts).

For a brit the pending `reminder_1` → `buildBritTradReminderParams` binds:

| Ingredient | Source field | Required? |
|---|---|---|
| first-person reminder line | `celebrants.host_composition` | yes |
| weekday / Hebrew + Gregorian date / time | `event_date` | yes |
| venue line `{{…}}` | **`venue_name`** (address appended if present) | **yes** |

Generic/wedding invites/reminders bind the same venue line `{{7}}`, celebrant
names, and `event_date`. The gift template binds `gift_payment_url` — but only
when a gift touchpoint is scheduled (not the case for the current campaigns).

## Policy — "may change, must not remove / re-type"

"Live" is the **operational** (non-terminal) campaign-status set — the single
source of truth `OPERATIONAL_CAMPAIGN_STATUSES` in `campaign-status.ts`
(`draft, pending_approval, approved, scheduled, active, paused`), which also
drives the event-close block (R7). A `cancelled` or otherwise terminal campaign
never locks the form. While an **operational** campaign exists for an event:

1. **`event_type` — locked.** The template family, param contract, and pricing
   are bound to the type. (`EVENT_TYPE_LOCKED_ERROR`)
2. **`celebrants` — must stay COMPLETE** for the type (host signature +
   composition for brit). Changing the values is fine; emptying a required one
   is not. (`CELEBRANTS_LOCKED_ERROR`)
3. **`venue_name` — must stay non-empty.** It is bound into every invite/reminder
   venue line; emptying it drops the next send. Changing it is fine.
   (`VENUE_REQUIRED_WHILE_CAMPAIGN_ERROR`)
4. **`event_date` / `event_time` — already lifecycle-locked post-publish** (the
   form disables them; `updateEvent` rejects a forged date key).
5. **Everything else is free:** `venue_address`, gift link, invitation image,
   meal-preference toggle, and the celebrant *values* (as long as they stay
   complete). These either aren't bound into a pending send or are optional there.

The misleading pre-fix message ("cannot DELETE celebrant details…") is replaced
by accurate, actionable text, and the old false-positive — where editing an
unrelated field on an event whose `host_composition` was never stored tripped
the lock because the empty `<select>` re-submitted an incomplete shape — is
fixed by marking the completeness-required fields `required` in the form.

## Enforcement (defense in depth)

- **Server authority** — `updateEvent` (events.ts): takes the stored type from the
  ownership read (`cur.event_type`, no extra query), then queries the campaign
  (keyed off `OPERATIONAL_CAMPAIGN_STATUSES`) only when a lock could trip; throws
  the specific actionable error. The action (`actions.ts`) surfaces all three.
- **Form UX** — `edit-event-form.tsx` (driven by `hasOperationalCampaign`, which
  the page derives from its already-loaded campaign via `isOperationalCampaignStatus`):
  locks the `event_type` select (value rides in a hidden input), and marks the
  required celebrant fields + `venue_name` as `required` so the browser blocks an
  emptying save before it is sent.

## Isolation from the running worker (why this is safe to ship mid-campaign)

- The changed modules (`updateEvent`, the edit form/action/page) are **not** in
  the worker's import graph (`worker/main.ts` → outreach-engine → template-spec).
- The one pre-existing shared file, `schemas.ts`, only gained a **new** export
  (`CELEBRANT_REQUIRED_FIELD_KEYS_BY_KIND`); the 4 exports template-spec.ts uses
  are untouched. The new SSOT leaf `campaign-status.ts` is imported only by
  `events.ts` + `page.tsx` — never by the worker graph.
- No DB migration, no data change, no deploy/PM2 restart as part of this change.
  The scheduled 07-10 reminder is already enqueued in pg-boss, independent of the
  source. This policy only *prevents* an owner from causing a `params_incomplete`
  drop; it never changes how a send is built.

## Consistency & scope of the single source of truth

The lock question — "does this event have at least one **operational** campaign?"
— is answered by the **∃-operational** quantifier at every app layer:

| Layer | Source | Decision |
|---|---|---|
| UI edit-form lock + close block | `page.tsx` → `hasAnyOperationalCampaign(allCampaigns)` | ∃ operational (over ALL campaigns) |
| Server field lock | `updateEvent` → `campaigns … .in(OPERATIONAL…).limit(1)` | ∃ operational |
| DB event-close guard | `events_guard_update` (R7) → `count(*) … in (…6…) > 0` | ∃ operational |

`OPERATIONAL_CAMPAIGN_STATUSES` (`campaign-status.ts`) is the single TypeScript
definition of the 6-status set, imported by both the server guard and the UI. The
UI no longer derives the lock from `getCampaignForEvent` (newest non-cancelled) —
a weaker quantifier that would disagree when a newer terminal campaign sits ahead
of an older operational one.

**Scope of the claim — read carefully:**

- **TypeScript tier:** the 6-status set has ONE source (`OPERATIONAL_CAMPAIGN_STATUSES`)
  and the lock decision uses ONE quantifier (`hasAnyOperationalCampaign`).
- **NOT a system-wide SSOT.** The DB trigger `events_guard_update` **hardcodes the
  same 6 statuses independently** in PL/pgSQL — a hand-synced second copy that can
  drift from the TS constant. The application source is aligned with the DB trigger
  **only for the event-close status set**, by convention, not by generation.
- **The DB does NOT enforce the field locks at all.** `events_guard_update` guards
  only event status transitions (R6/R7) and the `event_date`/`rsvp_deadline` lock
  (R5); it never inspects `event_type`, `celebrants`, or `venue_name`. Those locks
  live solely in `updateEvent` (the only app writer of those columns) — a direct /
  service-role `UPDATE events` would bypass them, with no DB backstop.

## Follow-up (separate — no migration in this change)

`campaigns` has **no** partial-unique on `event_id` (only `campaigns_pkey`). The
"one non-cancelled campaign per event" invariant is app-level only (createCampaign's
create-or-continue early return — a racy check-then-insert). Before adding a DB
constraint, decide whether the business model truly requires "≤1 non-cancelled
campaign per event across ALL lifecycle stages", and how to handle existing data
and the createCampaign race. Until then, the ∃ quantifier above keeps UI/server/DB
consistent even if a second non-cancelled row ever appears.

## Verification

`tsc --noEmit`, `eslint`, full `vitest`, and an isolated `next build` all green.
Tests cover: event_type-lock reject + no-campaign pass, venue-empty reject +
venue-change pass, the unrelated-edit regression, and (campaign-status.test.ts)
the 11 enum values + the ∃ quantifier (`active`+`paid` both orders → true).
