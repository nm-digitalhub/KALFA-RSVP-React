# Runbook — Event Lifecycle State Model: S0 Preflight (LIVE DB)

Plan: `plans/event-lifecycle-state-model-plan.md`, Phase S0 / Task S0.1.
Spec: `plans/event-lifecycle-state-model-spec.md`.
Target: the linked **live** Supabase project.
Status: **READ-ONLY preflight, sign-off recorded.** No schema/trigger/code change in
this step. One scoped, owner-approved data fix executed (see §3) — not part of the
migration itself.

---

## 1. Queries run (verbatim, via `supabase db query --linked`)

```sql
-- V1a: draft events with a STALE event_date (<= today)
select id, event_date from public.events
 where status='draft' and event_date is not null
   and (event_date at time zone 'Asia/Jerusalem')::date
         <= (now() at time zone 'Asia/Jerusalem')::date;

-- V1b: active events with event_date IS NULL
select id from public.events where status='active' and event_date is null;

-- V1c: draft events whose rsvp_deadline fails the FULL combined predicate
select id, status, event_date, rsvp_deadline from public.events
 where status='draft' and rsvp_deadline is not null
   and not (
     event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date <= rsvp_deadline
     and rsvp_deadline <= (event_date at time zone 'Asia/Jerusalem')::date
   );

-- V3 (R9): operational-state campaign on a non-active event
select c.id cid,c.status cstatus,e.id eid,e.status estatus from public.campaigns c
  join public.events e on e.id=c.event_id
 where c.status in ('pending_approval','approved','scheduled','active','paused') and e.status<>'active';

-- V4a: CLOSED events with a blocking-state campaign (TRUE violation)
select e.id, count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) blocking
  from public.events e join public.campaigns c on c.event_id=e.id
 where e.status='closed'
 group by e.id
having count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) > 0;

-- V4b: ACTIVE events whose event_date is already PAST, with a blocking campaign
-- (non-blocking manual cleanup queue, not a violation)
select e.id, e.event_date, count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) blocking
  from public.events e join public.campaigns c on c.event_id=e.id
 where e.status='active' and e.event_date is not null
   and (e.event_date at time zone 'Asia/Jerusalem')::date
         < (now() at time zone 'Asia/Jerusalem')::date
 group by e.id, e.event_date
having count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) > 0;

-- V5: one-per-event (APP convention, INFORMATIONAL only)
select event_id, count(*) from public.campaigns where status<>'cancelled' group by event_id having count(*)>1;
```

## 2. Live results (run 2026-07-01, before any remediation)

| bucket | rows | finding |
|---|---|---|
| V1a | 0 | — |
| V1b | 0 | — |
| **V1c** | 1 | `ec7c68d1-2494-4887-a644-7648dcd74b9a` — `event_date=2026-07-10`, `rsvp_deadline=2026-06-29` (already past at run time) |
| **V3** | 1 | campaign `bac77347-a2f4-4a6e-a825-933fcbd3d0c7` (`approved`) on event `ec7c68d1` (`draft`) |
| V4a | 0 | — |
| V4b | 1 (non-blocking) | event `03733daf-4610-44fc-a432-42970620bedf` — `active`, `event_date=2026-06-22` (past), 1 blocking campaign |
| V5 | 1 (informational) | event `00000000-0000-0000-0000-0000000000e1` — 6 non-cancelled campaigns |

All results match the findings already documented in the plan from prior investigation — no drift in live data.

## 3. Decisions (human, recorded 2026-07-01)

| ref | bucket(s) | finding | decision |
|---|---|---|---|
| `ec7c68d1` | V1c | `rsvp_deadline=2026-06-29`, already past | **Confirmed test data** (`name`="בדיקה מול טסט", `venue_name`="בדיקה", 1 guest, created 2026-06-28) — owner approved a direct, scoped fix: `update public.events set rsvp_deadline = null where id = 'ec7c68d1-2494-4887-a644-7648dcd74b9a'`. **Executed 2026-07-01** (see §4). Re-run of the V1c query after the fix returns 0 rows. This is a one-off, explicitly owner-approved exception to "remediate only via app mechanisms" — justified because (a) the event is confirmed non-production test data, (b) `updateEvent`'s app-level R2b validation does not exist yet (it ships in S2), so there is no live "built mechanism" this could have gone through instead. |
| `ec7c68d1` | V3 | campaign `bac77347` (`approved`) on a `draft` event | **Left as a recorded, deferred exception — NOT auto-cancelled.** There is currently no live `cancel_campaign` RPC (it ships in S1); nothing exists yet to remediate this through. Per the plan's round-3 phase-ordering precision, S1's apply-gate requires only this sign-off (recorded decision), not resolution — **S2.5 must actually resolve this (cancel or publish-path) before S4**, which requires it to be genuinely empty. |
| `03733daf` | V4b | `active`, event_date past, 1 blocking campaign | **Non-blocking manual cleanup queue (per spec/plan), not a gate.** No action required for S1/S2/S3/S4. Owner's call whenever they choose to close this event. |
| `00000000…e1` | V5 | 6 non-cancelled campaigns | **Informational only (B2) — explicitly excluded from remediation.** Never required to reach zero, at any phase. |

## 4. Data fix executed (scoped, owner-approved — not part of the S1 migration)

```sql
update public.events set rsvp_deadline = null
 where id = 'ec7c68d1-2494-4887-a644-7648dcd74b9a'
 returning id, event_date, rsvp_deadline, status;
-- → id=ec7c68d1…, event_date=2026-07-10, rsvp_deadline=NULL, status=draft
```

Verified: re-running the V1c query (§1) afterward returns 0 rows.

## 5. Sign-off

- [x] V1a/V1b/V4a confirmed empty live.
- [x] V1c resolved live via the scoped owner-approved fix above (was the only row).
- [x] V3 recorded as a deferred decision — to be resolved in S2.5 once `cancel_campaign` (S1) exists; tracked as a release blocker for S4.
- [x] V4b/V5 confirmed non-blocking/informational, require no action.
- **S0 sign-off: COMPLETE.** Phase S1 may proceed once separately approved (this runbook's existence is NOT itself approval to apply the S1 migration).
