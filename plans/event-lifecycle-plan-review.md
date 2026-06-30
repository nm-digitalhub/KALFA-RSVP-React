# Expert review — Event Lifecycle State Model plan

> Independent adversarial review by the `LifecyclePlanReviewer` agent (senior
> Postgres/Supabase + Next.js, read-only) of `plans/event-lifecycle-state-model-plan.md`
> against the approved spec (`cd44198`) and the live code + DB. 2026-06-30.

**Verdict: NEEDS-FIXES.** Architecturally sound, correctly grounded in the live schema, and the trigger/RPC logic is — with the exceptions below — provably correct. Three issues to fix before/during implementing; the rest are improvements. Nothing rises to MAJOR-REWORK.

## Live-DB facts verified (read-only, linked)
- **L0a supersede targets exact:** `events_reject_past_event_date_insert` (BEFORE INSERT), `events_reject_past_event_date_update` (BEFORE UPDATE OF event_date, `WHEN old.event_date IS DISTINCT FROM new.event_date`), function `public.events_reject_past_event_date()` — all present. **KEEP** list correct: CHECK `events_rsvp_deadline_within_event` (`rsvp_deadline IS NULL OR (event_date IS NOT NULL AND rsvp_deadline <= (event_date AT TIME ZONE 'Asia/Jerusalem')::date)`) + `trg_events_updated` (set_updated_at, BEFORE UPDATE).
- **Columns/enums:** `campaigns.capture_status`/`charge_status` `text` NULL; `campaigns.status` `campaign_status` NOT NULL default `'draft'`; `event_id` uuid NOT NULL; `events.status` NOT NULL default `'draft'`. Enums exactly as plan: `event_status{draft,active,closed}`, `campaign_status{draft,pending_approval,approved,scheduled,active,paused,closed,awaiting_invoice,billed,paid,cancelled}`.
- **No partial-unique on campaigns** — only `campaigns_pkey`. One-per-event is app-only (confirmed).
- **`try_record_billed_result` live body == the L2 migration verbatim** — reproduce-and-add-R9 is feasible.
- **`campaigns` RLS:** `camp_owner_select` (SELECT, `owns_event`) + `camp_admin_all` (ALL, admin). Owners cannot write campaigns via REST → writes go through service_role; R8/R9 triggers are correct defense-in-depth.
- **No code writes `status='cancelled'`** (grep: only label maps + generated types). **No DB function does `UPDATE events SET`**. So the new triggers break no existing write.
- **`billed_results.campaign_id` exists** (R8 `NOT EXISTS` predicate valid).
- **S0 exceptions reproduce live:** V3 returns exactly `bac77347`(approved, capture/charge NULL) on `ec7c68d1`(draft, 2026-07-10); `03733daf`(active, past 2026-06-22) + `e8fb3d07` pending_approval (capture/charge NULL → R8-cancellable); `00000000…e1`(active, 2026-07-22) has **6 non-cancelled campaigns including two `authorized` and one `active`** — see B2.

---

## BLOCKING ISSUES

### B1 — R7's cross-table count is `SECURITY INVOKER` → authoritative only by RLS coincidence
`events_guard_update` is `security invoker` (plan line 107) but its R7 check reads another table:
```sql
select count(*) into blocking from public.campaigns c where c.event_id=new.id and c.status in (...);
```
Under invoker that SELECT is subject to `campaigns` RLS (`camp_owner_select USING owns_event`). It's correct **today** only because every writer of `events.status` is owner or admin — i.e. authoritative *by RLS coincidence*, not by construction, which contradicts the spec's R7 intent ("DB, REST-proof"). The moment a writer can update `events` but not SELECT that event's campaigns (the pending org-multitenancy phases widen event access but not `campaigns` RLS), R7 silently counts 0 and **allows a close under a live campaign**.
**Fix (one word):** declare `events_guard_update` `security definer set search_path = ''`. The R2/R3/R5/R6 OLD/NEW logic is unaffected (OLD/NEW come from the trigger mechanism); only the `public.campaigns` read becomes RLS-independent — exactly what R7 wants. Also makes it consistent with the R9 campaigns trigger (already definer). No privileged write in the function → standard, safe.

### B2 — DoD "zero residual violations" is unmeetable for V5 on the seed event
S4/DoD requires the S0 preflight to re-run to zero. But `00000000…e1` has two campaigns with `capture_status='authorized'` (`7b2ba5f3` approved, `4c736788` active) — `cancel_campaign` returns `'not_cancellable'` for all three (authorized capture / `active` status fall outside R8's `{draft,pending_approval,approved}` + null-capture predicate), and the plan adds **no** partial-unique index. So V5 (one-per-event) on this event can **never** reach zero via the shipped mechanisms; the plan's S0 row "cancel the extras (or leave — test data)" is partly infeasible and the gate is unsatisfiable as written.
**Fix:** explicitly scope V5-on-`00000000` as an accepted residual in S0/S2.5/S4 (it's app-only, not DB-enforced — plan line 16 already says so), or rebuild the seed event. State which violations are *blocking* (V3 `ec7c68d1`, R7-unclosable `03733daf` — both R8-cancellable) vs *informational* (V5 on test data).

### B3 — "single transaction / no live gap" is asserted, not verified, and the swap is DROP+CREATE
Plan line 83 claims `db push` runs the file atomically. The new triggers are renamed, so it's necessarily `DROP TRIGGER …; CREATE TRIGGER …` (no `CREATE OR REPLACE TRIGGER`). If the file isn't tx-wrapped there's a sub-second window where `events` accepts a write with no R1/R2 guard.
**Fix:** confirm `supabase db push` wraps the migration file in a transaction (or wrap the body in explicit `begin;`/`commit;`, or apply via the Mgmt-API query batch). Then the "no gap" claim is true.

---

## NON-BLOCKING IMPROVEMENTS
- **`updateEvent` patch — drop the round-trip dependency (sharpens S2.3 + the deploy window).** The "old-form no-op submits pass" reasoning (plan line 311) holds **only because** every live `event_date` is midnight-UTC (`…00:00:00+00`, confirmed) and the session is UTC, so `slice(0,10)`→re-cast lands on the same instant under `IS DISTINCT FROM`. Instead, have the new `updateEvent` **omit** `event_date`/`rsvp_deadline` from the patch entirely when `status !== 'draft'` — removes the TZ/storage fragility and makes R5 unreachable from the app by construction. Document the UTC-midnight dependency either way.
- **`cancel_campaign` `'already_cancelled'`** (RPC returns it, plan line 200) isn't handled in S2.4's `cancelCampaign` mapping — treat as idempotent success.
- **R9 app-layer coverage** is narrower than spec R9: S2.4 guards create/approve/activate but spec also lists `recordSignedAgreement` + hold/send. The DB trigger covers those writes, so it's defense-in-depth-only — say so rather than leaving it an apparent omission.
- **`try_record_billed_result` R9:** place the new `event_not_active` check *after* the existing `event_passed` block (past event keeps the more specific reason); copy the current live body verbatim and diff `pg_get_functiondef` before/after. (Confirmed: `recordReached` and both call sites — `outreach-engine.writeReach:293`, `webhook-processing:108` — only special-case `'billed'`, so `event_not_active` is passed through harmlessly.)
- **`cancel_campaign` RPC uses `search_path='public'`** while the new triggers use `''`. For a new SECDEF function, `''` + fully-qualified names is stronger and consistent; the revoke/grant lockdown is already correct.
- **S3 UI:** add `min=tomorrow` on the date input (spec R2 UI) — S3.1 only disables it.
- **V4 preflight query** lists every event; add `having blocking>0` so it reads as a violations list.

---

## CONFIRMED-CORRECT (survived scrutiny)
- `events_guard_update` logic traced exhaustively — no-op (X→X), publish (draft→active status-only), abandon (draft→closed), close (active→closed), draft date-edit, locked non-draft date-edit, combined publish+date-change, NULL-date publish: every branch matches R2/R3/R5/R6/R7. R3 status-only + R5 lock + R2 draft-edit don't double-fire or conflict; `IS DISTINCT FROM` NULL-safety correct; fire order `events_guard_update` → `trg_events_updated` benign.
- `search_path=''` resolution fine: all table refs schema-qualified; `now()`/`AT TIME ZONE`/`::date` are pg_catalog; enum literals resolve via target column/var type (matches the working L2 pattern).
- R8 RPC ↔ `campaigns_guard_cancel` trigger non-conflicting; predicate genuinely NULL-safe (`IS DISTINCT FROM` per capture value + `charge_status IS NULL` + no `billed_results`); RPC uses `SELECT … FOR UPDATE`; revoked from public/anon/authenticated, granted to service_role; `db query` (postgres/owner) can still execute it in S2.5.
- `campaigns_require_active_event` (R9) fires only for operational target statuses → never blocks cancel/close/settle; SECURITY DEFINER appropriate (single indexed PK read, no recursion, no privileged write). Coexists cleanly with `trg_campaigns_updated`.
- Create form has no status field (`CreateEventInput` has no `status`); the status `<select>` lives only in `edit-event-form.tsx` (R1 UI satisfied).

**Net:** fix B1 (the real correctness defect), tighten B2/B3 wording, fold in the `updateEvent`-patch + `already_cancelled` refinements — then it's ready to implement.
