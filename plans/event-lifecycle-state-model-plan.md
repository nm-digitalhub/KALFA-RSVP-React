# Event Lifecycle State Model — Implementation Plan (S0–S4)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `- [ ]` checkboxes.
> **Status:** PLAN ONLY. No code/migration/tests written yet. Each phase is approval-gated; implementation starts only after explicit "implement" approval.
> **Spec:** `plans/event-lifecycle-state-model-spec.md` @ `cd44198` (APPROVED). Read it first.

**Goal:** Enforce the `draft → active → closed` event state machine (status × date × campaign) — DB-authoritative, mirrored in app/Zod/UI — closing the lifecycle holes.

**Architecture:** `events` is REST-writable ⇒ every event rule is a Postgres trigger (authoritative) + app/Zod/UI on top. Campaign cancel is DB-authoritative (SECDEF RPC + `→cancelled` trigger). Reuses the deployed `event-date.ts` leaf + the already-live past-event UI wiring (`a8ac2ef`).

## Global Constraints (verbatim from spec + verified live)

- **Calendar rule:** `today_IL = (now() AT TIME ZONE 'Asia/Jerusalem')::date`; `event_day_IL = (event_date AT TIME ZONE 'Asia/Jerusalem')::date`. "past" = `today_IL > event_day_IL` (today valid, runtime). "≥ tomorrow" = `event_day_IL > today_IL` (create/publish only). NULL date never gates.
- **Live objects to supersede (verified):** triggers `events_reject_past_event_date_insert`, `events_reject_past_event_date_update` + function `public.events_reject_past_event_date` → DROP & replace. **KEEP** CHECK `events_rsvp_deadline_within_event` and trigger `trg_events_updated` (set_updated_at) — **BOTH completely unchanged/untouched by this migration** (round-2 architectural correction: R2b is purely additive and does NOT supersede, drop, or modify the CHECK — see next bullet).
- **R2b (NEW — found live 2026-07-01, inspecting `ec7c68d1`; ADDITIVE ONLY, round-2 corrected):** the live CHECK only bounds `rsvp_deadline` from above (`<= event_day_IL`) and requires `event_date IS NOT NULL` when a deadline is set; nothing stopped a deadline already in the past from being saved (`ec7c68d1`: `rsvp_deadline=2026-06-29` saved while `event_date=2026-07-10`, `today_IL=2026-06-30` — V1c in S0). **The CHECK stays the sole, unchanged authority** for those two invariants (both immutable/value-based — correctly expressed as a CHECK, no migration touches it). **R2b adds exactly ONE new, separate, trigger-only rule** — the one thing a CHECK structurally cannot express (`now()`-dependent, not IMMUTABLE): `rsvp_deadline IS NULL OR rsvp_deadline >= today_IL`. **Lower bound is `>= today_IL`, NOT `>= tomorrow_IL`** (same-day deadline legal until end of day Israel; no mandatory buffer). **WRITE-TIME ONLY, not a continuous invariant** — checked at INSERT, at a draft-only edit of `event_date`/`rsvp_deadline`, and at `draft→active` publish (re-checked there because `today_IL` moves forward even though R3 keeps the values unchanged); a deadline that elapses naturally on an `active`/`closed` event is NEVER re-validated and must NEVER block an unrelated write (rename, close, cancel, settle, …).
- **Verified columns:** `campaigns.capture_status text NULL`, `campaigns.charge_status text NULL`, `campaigns.status` enum NOT NULL, `campaigns.event_id uuid NOT NULL`. Enums: `event_status{draft,active,closed}`, `campaign_status{draft,pending_approval,approved,scheduled,active,paused,closed,awaiting_invoice,billed,paid,cancelled}`.
- **One-per-event is an APP CONVENTION, not a DB constraint** — `getCampaignForEvent` selects the event's campaign with `.neq('status','cancelled')` (campaigns.ts:210-219). **No partial-unique index exists in live** (only `campaigns_pkey`). Adding one is OUT OF SCOPE. A >1-non-cancelled-per-event row (V5) is **informational data-quality / tech-debt**, NOT a blocking R1–R9 lifecycle violation.
- **TDD, forward-only migrations**, applied via `supabase db push --linked` after isolated-PG16 testing. No `any`, no `@ts-ignore`. Hebrew user-facing strings, RTL.
- **Do NOT change** the runtime "today valid" rule (L0a/L1/L2 date guards) or remove L2's billing guards — only ADD the R9 event-active check to `try_record_billed_result`.
- **LIVE BASELINE (`5aed01c`, App/UX only — BUILD ON IT, never remove/duplicate):** `updateEventSchema` already carries two cross-field `rsvp_deadline` refines — **(a)** deadline requires `event_date`, **(b)** `rsvp_deadline <= event_date` (LC-2 mirror) — plus their tests in `schemas.test.ts` (`describe('updateEventSchema — rsvp_deadline vs event_date')`). `edit-event-form.tsx`'s two date inputs are **controlled** (`useState`) with `event_date min={rsvpDeadline}` / `rsvp_deadline max={eventDate}` coupling. This plan extends these; it must not rewrite or re-add them.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_event_lifecycle_state_model.sql` | create | R1/R2/**R2b** (additive, lower-bound only)/R3/R5/R6/R7 events triggers (supersede ONLY the two L0a triggers — CHECK `events_rsvp_deadline_within_event` is UNTOUCHED) + R9 campaigns trigger + R8 `cancel_campaign` RPC & `campaigns_guard_cancel` trigger (both `SECURITY DEFINER SET search_path=''`, `public.`-qualified) + R9 in `try_record_billed_result` (reads `public.events`) |
| `supabase/runbooks/event_lifecycle_s0_preflight.md` | create | S0 read-only queries + decision table |
| `src/lib/data/event-date.ts` | modify | add `isBeforeTomorrowIL` |
| `src/lib/validation/schemas.ts` | modify | ADD `event_date` ≥-tomorrow refine (create+update) + **ADD `rsvp_deadline ≥ today_IL` refine (R2b)** + drop `status` from `updateEventSchema` — **PRESERVE the live `5aed01c` LC-2 deadline refines (chain onto them)** |
| `src/lib/data/events.ts` | modify | `createEvent`/`updateEvent` guards (key-ABSENCE semantics, see S2.3); new `publishEvent`/`closeEvent` |
| `src/app/(customer)/app/events/[id]/actions.ts` | modify | `updateEventAction`: build the `updateEvent` input using `formData.has('event_date'\|'rsvp_deadline')` — key **present** in `FormData` (even if value is `''`) → include in the input object; key **absent** (disabled, non-draft input — never POSTed) → omit the key entirely. **NEVER map absent→`null`.** |
| `src/lib/data/campaigns.ts` | modify | R9 event-active guards (create/approve/activate); new `cancelCampaign`→RPC, **ownership-gated via `getCampaignForHold`→`requireOwnedEvent` BEFORE the RPC call (round-3)** |
| `src/app/(customer)/app/events/[id]/campaign/campaign-actions.ts` | modify | `publishEventAction`/`closeEventAction`/`cancelCampaignAction` |
| `src/app/(customer)/app/events/[id]/edit-event-form.tsx` | modify | remove status `<select>`; disable date+`rsvp_deadline` when status≠draft; raise `event_date min` to `max(tomorrow_IL, rsvpDeadline)`; **raise `rsvp_deadline min` to `today_IL` (R2b)** — **KEEP the live `5aed01c` controlled inputs + `rsvp_deadline max=eventDate` coupling** |
| `src/app/(customer)/app/events/[id]/event-status-actions.tsx` | create | client Publish/Close control |
| `src/app/(customer)/app/events/[id]/page.tsx` | modify | render Publish/Close; pass `hasBlockingCampaign` |
| `src/app/(customer)/app/events/[id]/campaign/[campaignId]/manage-client.tsx` | modify | minimal Cancel button (gated by `canCancel`) |
| `*.test.ts` (events/campaigns/schemas) + `scratchpad/l3_*.sql` | create/modify | tests |

---

## Phase S0 — Preflight (READ-ONLY; decisions only)

### Task S0.1 — Author + run the preflight, record decisions

**Files:** create `supabase/runbooks/event_lifecycle_s0_preflight.md`.

- [ ] **Step 1:** Put these read-only queries in the runbook (run each via `supabase db query --linked`):

```sql
-- V1a: draft events with a STALE event_date (<= today) — would fail R2/R3 on the
-- next edit/publish attempt; informational until the date is actually touched,
-- not an immediate violation (the trigger only re-validates on a CHANGE).
select id, event_date from public.events
 where status='draft' and event_date is not null
   and (event_date at time zone 'Asia/Jerusalem')::date
         <= (now() at time zone 'Asia/Jerusalem')::date;
-- V1b: active events with event_date IS NULL — should be structurally impossible
-- once R3 is live (publish requires a concrete future date); a TRUE violation if
-- any pre-existing/legacy row is found.
select id from public.events where status='active' and event_date is null;
-- V1c: events whose rsvp_deadline fails the FULL combined predicate — the
-- existing CHECK's two invariants (requires event_date; <= event_day_IL) TOGETHER
-- with R2b's new lower bound (>= today_IL) — a comprehensive correctness check,
-- independent of which mechanism (CHECK vs new trigger) is responsible for which
-- part. Scoped to draft (only draft rows are subject to write-time
-- re-validation going forward; an active/closed row's elapsed deadline is NORMAL,
-- never a violation per R2b's non-invariant rule).
select id, status, event_date, rsvp_deadline from public.events
 where status='draft' and rsvp_deadline is not null
   and not (
     event_date is not null
     and (now() at time zone 'Asia/Jerusalem')::date <= rsvp_deadline
     and rsvp_deadline <= (event_date at time zone 'Asia/Jerusalem')::date
   );
-- V3 (R9) operational campaign on a non-active event
select c.id cid,c.status cstatus,e.id eid,e.status estatus from public.campaigns c
  join public.events e on e.id=c.event_id
 where c.status in ('pending_approval','approved','scheduled','active','paused') and e.status<>'active';
-- V4a: CLOSED events with a blocking-state campaign — a TRUE violation (a closed
-- event should never coexist with a non-terminal campaign under the new rules).
select e.id, count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) blocking
  from public.events e join public.campaigns c on c.event_id=e.id
 where e.status='closed'
 group by e.id
having count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) > 0;
-- V4b: ACTIVE events whose event_date is already PAST, with a blocking-state
-- campaign — NOT a violation right now (R7 only fires on an attempted close);
-- a manual cleanup queue for when someone eventually tries to close them.
select e.id, e.event_date, count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) blocking
  from public.events e join public.campaigns c on c.event_id=e.id
 where e.status='active' and e.event_date is not null
   and (e.event_date at time zone 'Asia/Jerusalem')::date
         < (now() at time zone 'Asia/Jerusalem')::date
 group by e.id, e.event_date
having count(c.*) filter (where c.status in
  ('draft','pending_approval','approved','scheduled','active','paused')) > 0;
-- V5 one-per-event (APP convention, INFORMATIONAL — not a blocking R1–R9 violation)
select event_id, count(*) from public.campaigns where status<>'cancelled' group by event_id having count(*)>1;
-- NOTE (explicit, not a query): a CLOSED event with event_date IS NULL is NOT a
-- violation (unlike V1b for active) — legacy closed events may legitimately have
-- no date on file; only `active` requires one (R3 enforces it at publish time).
```

- [ ] **Step 2:** Record the live decision table (snapshot 2026-06-30 — re-run at execution time, data may change). **Buckets, by severity:** V1b/V1c/V3/V4a = TRUE violations needing a recorded human decision; V4b = a non-blocking manual cleanup queue (acted on whenever the owner chooses to close that event, not a gate); V5 = permanent informational residual, never part of remediation.

| ref | bucket(s) | finding | decision (human) |
|---|---|---|---|
| `ec7c68d1` | V3 + V1c | `bac77347` (approved campaign) on this draft event; **AND** its `rsvp_deadline=2026-06-29` already fails the combined predicate's lower bound | **MANUAL, no auto-fix.** test/no-commitment → `cancel_campaign` in S2.5; real event → before `publishEvent`, **first re-save a valid `rsvp_deadline`** (satisfying both the CHECK and the new lower bound, or clear it to NULL) while still `draft`, **then** verify date/details and publish. |
| `03733daf` | V4b | `active`, `event_date` already past, `pending_approval` campaign — would block a close attempt | **Manual cleanup queue, NOT a gate.** When the owner is ready to close this event: `cancel_campaign` the pending_approval campaign first, then close. Not required before S1 ships. |
| `00000000…` | V5 | 6 non-cancelled campaigns; 2 `authorized` + 1 `active` → genuinely NOT `cancel_campaign`-able | **INFORMATIONAL ONLY (B2) — explicitly EXCLUDED from S2.5 remediation.** Leave as a documented residual (or rebuild the seed event out of band, out of scope here). **No** partial-unique index, **no** hardcoded-UUID exclusion, **no** artificial "zero residual"; S4's DoD never requires this to reach zero. |

- [ ] **Step 3:** Commit the runbook (`docs(events): S0 preflight + decisions`). **No data changed in S0.**

---

## Phase S1 — DB migration (authoritative)

### Task S1.1 — Create the migration; supersede L0a safely

**Files:** create `supabase/migrations/<ts>_event_lifecycle_state_model.sql` (via `supabase migration new event_lifecycle_state_model`).

**Fail-safe L0a replacement order (B3 — do NOT rely on an assumed `db push` transaction wrapper; do NOT add explicit `begin/commit`). Round-2 correction: the CHECK `events_rsvp_deadline_within_event` is NEVER touched by this migration — only the two L0a triggers are replaced.** Renamed triggers force `DROP TRIGGER … / CREATE TRIGGER …` (there is no `CREATE OR REPLACE TRIGGER`). Order the migration so a mid-failure leaves **double protection, never a gap**: (1) create the new functions (R2b's lower-bound-only rule is folded in here); (2) **create the new triggers while L0a stays active in parallel** — both fire; the new rules are strictly stricter (a superset), so coexistence is harmless; (3) **only now** `drop trigger if exists` the two L0a triggers; (4) `drop function if exists public.events_reject_past_event_date()`. KEEP `trg_events_updated` AND the CHECK, both completely unchanged — neither is part of this migration's drop/replace sequence at all. (If it fails before step 2 → L0a still guards; after step 2 → L0a+new both guard until the drop succeeds.)

- [ ] **Step 1 — R1+R2+R2b BEFORE INSERT on events** (force draft + date ≥ tomorrow + deadline lower bound ONLY — the CHECK still covers requires-date + upper bound):

```sql
create or replace function public.events_before_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare today_il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  new.status := 'draft';  -- R1
  if new.event_date is not null
     and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
    raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';  -- R2
  end if;
  -- R2b: LOWER BOUND ONLY. The CHECK events_rsvp_deadline_within_event (existing,
  -- UNCHANGED, untouched by this migration) already enforces "rsvp_deadline
  -- requires event_date" + "rsvp_deadline <= event_day_IL" unconditionally on
  -- every row — this trigger must NOT duplicate that, it adds only the one
  -- now()-dependent piece a CHECK cannot express.
  if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
    raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
  end if;
  return new;
end; $$;
```

- [ ] **Step 2 — R3+R5+R6+R7+R2b BEFORE UPDATE on events** (status machine + locks + deadline re-check):

```sql
-- B1: SECURITY DEFINER so the R7 cross-table read of public.campaigns is
-- independent of the WRITER's RLS (authoritative by construction, not by RLS
-- coincidence). No privileged write in the body; OLD/NEW come from the trigger.
create or replace function public.events_guard_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare blocking int; today_il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if new.status is distinct from old.status then  -- a real transition
    if not ( (old.status='draft' and new.status in ('active','closed'))
          or (old.status='active' and new.status='closed') ) then
      raise exception 'illegal event status transition % -> %', old.status, new.status using errcode='check_violation';  -- R6
    end if;
    if old.status='draft' and new.status='active' then  -- R3
      if new.event_date is null
         or (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
        raise exception 'cannot publish: event_date must be set and >= tomorrow' using errcode='check_violation';
      end if;
      if new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
        raise exception 'publish must not change event_date/rsvp_deadline (save dates first)' using errcode='check_violation';
      end if;
      -- R2b RE-CHECK at publish time: the date values are unchanged (checked
      -- above), but `today_il` has moved forward since the deadline was saved
      -- while draft — a deadline valid then can be stale now. Upper bound need
      -- not be re-checked (event_date is unchanged too, so it still holds).
      if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then
        raise exception 'rsvp_deadline has elapsed — set a new deadline before publishing' using errcode='check_violation';
      end if;
    end if;
    if new.status='closed' then  -- R7 (campaign.status only)
      select count(*) into blocking from public.campaigns c where c.event_id=new.id
        and c.status in ('draft','pending_approval','approved','scheduled','active','paused');
      if blocking>0 then raise exception 'cannot close event: % operational campaign(s)', blocking using errcode='check_violation'; end if;
    end if;
  end if;
  if old.status<>'draft' then  -- R5 lock
    if new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
      raise exception 'event_date/rsvp_deadline are locked once the event leaves draft' using errcode='check_violation';
    end if;
  elsif new.event_date is distinct from old.event_date or new.rsvp_deadline is distinct from old.rsvp_deadline then
    -- draft edit touching EITHER date: re-validate R2 (event_date) + R2b
    -- (deadline LOWER BOUND ONLY — the CHECK events_rsvp_deadline_within_event,
    -- existing and UNCHANGED, already covers "requires event_date" +
    -- "<= event_day_IL" unconditionally on every row; do not duplicate it here).
    -- Broadened from event_date-only so editing JUST the deadline (the common
    -- case) is re-validated too — the original draft only fired on event_date.
    if new.event_date is distinct from old.event_date  -- R2
       and new.event_date is not null
       and (new.event_date at time zone 'Asia/Jerusalem')::date <= today_il then
      raise exception 'event_date must be at least tomorrow (Asia/Jerusalem)' using errcode='check_violation';
    end if;
    if new.rsvp_deadline is not null and new.rsvp_deadline < today_il then  -- R2b
      raise exception 'rsvp_deadline must be today or later (Asia/Jerusalem)' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
```

- [ ] **Step 3 — wire the events triggers + drop L0a (the CHECK is NOT touched):**

```sql
-- (a) create the NEW guards FIRST — L0a is still active → double protection, no gap:
create trigger events_before_insert before insert on public.events for each row execute function public.events_before_insert();
create trigger events_guard_update before update on public.events for each row execute function public.events_guard_update();
-- (b) ONLY AFTER the new guards exist, drop the L0a triggers + function:
drop trigger if exists events_reject_past_event_date_insert on public.events;
drop trigger if exists events_reject_past_event_date_update on public.events;
drop function if exists public.events_reject_past_event_date();
-- (no step (c) — events_rsvp_deadline_within_event is never dropped; round-2 correction)
```

- [ ] **Step 4 — R9 BEFORE INSERT/UPDATE on campaigns** (operational states require active event):

```sql
create or replace function public.campaigns_require_active_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ev public.event_status;
begin
  if new.status in ('pending_approval','approved','scheduled','active','paused') then
    select status into ev from public.events where id=new.event_id;
    if ev is distinct from 'active' then
      raise exception 'campaign requires event.status = active (got %)', ev using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists campaigns_require_active_event on public.campaigns;
create trigger campaigns_require_active_event before insert or update on public.campaigns for each row
  execute function public.campaigns_require_active_event();
```

- [ ] **Step 5 — R8 `→cancelled` guard trigger + `cancel_campaign` RPC** (null-safe predicate, incl. `draft`; **both `SECURITY DEFINER SET search_path=''`, every table reference `public.`-qualified — round-2 completion**):

```sql
-- SECURITY DEFINER (not INVOKER) so this trigger is the AUTHORITATIVE gate for
-- ANY direct UPDATE to status='cancelled' — by the RPC, by service_role, or by
-- any future writer — independent of the writer's RLS (mirrors the B1 reasoning
-- for events_guard_update). RPC = the app's path; this trigger = the
-- unconditional backstop that makes the rule true regardless of caller.
create or replace function public.campaigns_guard_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    if not ( old.status in ('draft','pending_approval','approved')
      and old.capture_status is distinct from 'authorized'
      and old.capture_status is distinct from 'pending'
      and old.capture_status is distinct from 'hold_review'
      and old.charge_status is null
      and not exists (select 1 from public.billed_results b where b.campaign_id=new.id) ) then
      raise exception 'campaign cannot be cancelled: financial commitment or wrong state' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists campaigns_guard_cancel on public.campaigns;
create trigger campaigns_guard_cancel before update on public.campaigns for each row execute function public.campaigns_guard_cancel();

create or replace function public.cancel_campaign(p_campaign uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.campaigns;
begin
  select * into v from public.campaigns where id=p_campaign for update;
  if not found then return 'no_campaign'; end if;
  if v.status='cancelled' then return 'already_cancelled'; end if;
  -- Predicate is ALWAYS evaluated here too — never assumed true for 'draft' or
  -- any other state; this re-check (separate from the trigger above) is what
  -- lets the RPC return a precise outcome instead of a raw constraint error.
  if not ( v.status in ('draft','pending_approval','approved')
    and v.capture_status is distinct from 'authorized'
    and v.capture_status is distinct from 'pending'
    and v.capture_status is distinct from 'hold_review'
    and v.charge_status is null
    and not exists (select 1 from public.billed_results b where b.campaign_id=v.id) ) then
    return 'not_cancellable';
  end if;
  update public.campaigns set status='cancelled' where id=p_campaign;
  return 'cancelled';
end; $$;
revoke all on function public.cancel_campaign(uuid) from public, anon, authenticated;
grant execute on function public.cancel_campaign(uuid) to service_role;
```

- [ ] **Step 6 — R9 inside `try_record_billed_result`:** `CREATE OR REPLACE` reproducing the L2 body **verbatim** (diff `pg_get_functiondef` before/after to prove no drift), adding the check **immediately after the existing `event_passed` block** (so a past event keeps its more-specific reason) and before the insert:

```sql
  -- R9: never bill for a campaign whose event is not active. public.-qualified
  -- (round-2 completion) regardless of the function's own search_path.
  if (select status from public.events where id = v_event_id) is distinct from 'active' then
    return 'event_not_active';
  end if;
```
(Document the new outcome `'event_not_active'` in `src/lib/data/billing.ts`'s recordReached comment in S2.)

### Task S1.2 — Isolated PG16 trigger tests (RED/GREEN; no live contact)

**Files:** create `scratchpad/l3_schema.sql` (extend the L2 harness: `events`, `campaigns` + `capture_status text`, `charge_status text`, `billed_results`, enums) + `scratchpad/l3_tests.sql`.

- [ ] **Step 1:** Build the cluster (L2 method: `/usr/lib/postgresql/16/bin`, TCP `127.0.0.1`, short `/tmp` datadir). **Step 2:** `psql -f` the migration → clean parse. **Step 3:** assertions (got vs want):

```
R1 insert status=active            -> stored 'draft'
R2 insert date today               -> reject ; tomorrow -> ok ; null -> ok
R6 active->draft / closed->active  -> reject ; draft->active(+future date) -> ok ; X->X no-op -> ok ; draft->closed -> ok
R3 draft->active null date         -> reject ; draft->active with changed date -> reject (status-only)
R5 event_date edit when active     -> reject ; rsvp_deadline edit when active -> reject ; draft edit date->tomorrow ok
R7 close + pending_approval camp   -> reject ; close + only cancelled -> ok
R9 insert campaign pending on draft event -> reject ; on active -> ok
R8 cancel draft (no hold/charge)   -> 'cancelled' ; cancel pending_approval(NULL capture) -> 'cancelled'
   cancel capture_status='authorized' -> 'not_cancellable' + direct UPDATE->cancelled trigger-rejects
   cancel capture_status='hold_failed' -> 'cancelled' ; charge_status not null -> 'not_cancellable'
R2b [NEW TRIGGER, lower bound only] insert deadline=yesterday -> reject ; deadline=today -> ok
R2b [NEW TRIGGER] draft edit: change ONLY rsvp_deadline to yesterday -> reject ; to today -> ok (event_date untouched)
R2b [NEW TRIGGER] publish (draft->active): event_date+rsvp_deadline unchanged but rsvp_deadline is now
   < today_il (set while draft on an earlier day) -> reject ('elapsed — set a new deadline before publishing')
R2b [EXISTING CHECK events_rsvp_deadline_within_event, UNCHANGED — regression coverage only, no new
   logic exercised] insert deadline=event_day -> ok ; deadline=event_day+1 -> reject (upper bound) ;
   deadline without event_date -> reject (requires-date)
R2b NOT an invariant: an event whose rsvp_deadline has naturally elapsed (active, deadline<today_il) ->
   an UNRELATED update (e.g. venue_name change, no event_date/rsvp_deadline in the patch) -> ok, not blocked
   (neither the new trigger nor the CHECK re-fires — the CHECK is satisfied by the existing row
   regardless of elapsed time, since it isn't time-dependent)
```

- [ ] **Step 4:** Run; confirm every `got=want`; tear down + remove cluster. **Step 5:** commit the migration (`feat(db): event lifecycle state model — triggers + cancel_campaign RPC (tested isolated PG16)`).

> **APPLY GATE (round-3 precision):** `supabase db push --linked` ONLY after explicit approval + after S0 **sign-off** — meaning a recorded human decision exists for every TRUE violation (V1b/V1c/V3/V4a), **NOT** that every existing row already satisfies the new rules. The triggers are write-time-only and are **never retroactively scanned** against existing data, so deploying with known, decided-but-not-yet-executed legacy exceptions (e.g. `ec7c68d1`) is safe — those rows simply can't be re-saved/published until S2.5 remediates them (see Risks). Then live-verify: triggers present, L0a dropped, `cancel_campaign` anon/auth-revoked, advisors clean.

---

## Phase S2 — App + Zod

### Task S2.1 — `event-date.ts`: `isBeforeTomorrowIL`
**Files:** modify `event-date.ts`; test `events.test.ts`.
- [ ] RED test (today→true, yesterday→true, tomorrow→false, null→false, fixed `nowMs`); implement reusing `israelCalendarDay`; GREEN; commit. Signature: `isBeforeTomorrowIL(eventDate: string|null, nowMs?: number): boolean`.

### Task S2.2 — Zod: date ≥ tomorrow + deadline ≥ today (R2b) + drop status (PRESERVE the live `5aed01c` LC-2 refines)
**Files:** modify `validation/schemas.ts`; extend `schemas.test.ts`.
- **Baseline (`5aed01c`, live):** `updateEventSchema` is already a `z.object({…}).refine(deadline-requires-date).refine(deadline<=event_date)` and `schemas.test.ts` already has the `updateEventSchema — rsvp_deadline vs event_date` describe. **Do NOT remove, rewrite, re-add, or duplicate these — chain onto them.**
- **`rsvp_deadline ≤ event_date` — wording + semantics (CONFIRMED, enforce in EVERY state):** keep `≤` — a deadline **on the event day is allowed** (boundary); do **NOT** change to `<`. The refine message MUST read **EXACTLY**: «המועד האחרון לאישור הגעה חייב לחול עד יום האירוע, כולל.» — the live `5aed01c` string is «…עד יום האירוע» (missing «, כולל») → fix that one string at implementation.
- **R2b — `rsvp_deadline ≥ today_IL` (NEW, found live on `ec7c68d1`; ADDITIVE):** add a **third** `.refine` to the live `5aed01c` chain — `!v.rsvp_deadline || v.rsvp_deadline >= todayIL()` (Israel calendar day; lexical `YYYY-MM-DD` compare, same pattern as the existing `<= event_date` refine), message «המועד האחרון לאישור הגעה לא יכול להיות בעבר.» on `path:['rsvp_deadline']`. **Lower bound is `>= today`, NOT `>= tomorrow`** — same-day legal. **The REST-proof authority for the upper bound was ALWAYS the CHECK `events_rsvp_deadline_within_event` and stays exactly there, unchanged** — this new refine is Zod's UX-only mirror of the NEW lower-bound trigger ONLY (round-2 correction: nothing "moves" or is superseded; the CHECK never changes). `createEventSchema` has no `rsvp_deadline` field, so R2b applies to `updateEventSchema` only.
- [ ] RED: `createEventSchema` rejects a past/today literal `event_date`, accepts `''`; `updateEventSchema` rejects a past/today `event_date`; `updateEventSchema` rejects `rsvp_deadline` = yesterday, accepts `rsvp_deadline` = today; the existing LC-2 refine tests still pass unchanged.
- [ ] Implement ON TOP of the live schema: add a `≥ tomorrow` `.refine` on `event_date` to **both** `createEventSchema` and `updateEventSchema`; add the `rsvp_deadline ≥ today` `.refine` to `updateEventSchema` only (append after the existing `5aed01c` `.refine(...)` chain — keep all of them in place, in order); **remove `status`** from `updateEventSchema` + `UpdateEventInput`. **Tests:** keep the live LC-2 cases; add the `≥ tomorrow` cases (past/today reject, tomorrow ok, '' ok); add the R2b cases (yesterday reject, today ok, event-day ok — already covered by the kept LC-2 boundary test). GREEN (new + preserved); commit.

### Task S2.3 — `events.ts`: key-PRESENCE semantics + guards + `publishEvent`/`closeEvent`
**Files:** modify `events.ts`; test `events.test.ts`.
- **`UpdateEventInput` type — KEY PRESENCE carries meaning, not just the value (round-2 design):**
  ```ts
  export interface UpdateEventInput {
    name: string;
    event_type: EventType;
    venue_name: string | null;
    venue_address: string | null;
    // OPTIONAL keys: omitting the key entirely means "do not touch this field"
    // (the only legal shape when the event is not draft — a disabled <input>
    // is never POSTed by the browser, so the key never reaches here for a
    // locked event under normal UI use). Including the key (value: string |
    // null) means "set/clear it" — legal only while draft. NEVER collapse
    // "absent" and "null" into the same thing.
    event_date?: string | null;
    rsvp_deadline?: string | null;
  }
  ```
- **`createEvent` app-level guard (round-3 correction, explicit task — was previously only implied by the File Structure table):** `createEvent` must apply the SAME `isBeforeTomorrowIL` (S2.1) data-layer guard as `updateEvent`'s draft path, mirroring R2 at the app layer (defense-in-depth; the DB trigger `events_before_insert`, S1.1, stays the REST-proof authority). `event_date` is **optional on create** (a date-less draft is legal) — `null`/omitted → no guard runs; a present `event_date` that is today or in the past → `throw new Error('מועד האירוע חייב להיות החל ממחר')` **before** the insert. `rsvp_deadline` is not accepted by `createEventSchema` (S2.2), so no R2b check belongs in `createEvent`.
- [ ] RED tests for `createEvent` (own block, dedicated unit tests — not folded into the `updateEvent` list below):
  1. `event_date: null` (or key omitted) → insert proceeds, no throw.
  2. `event_date` = today (Israel calendar day) → throws `'מועד האירוע חייב להיות החל ממחר'`, **no insert performed** (mock the insert call and assert `.not.toHaveBeenCalled()`).
  3. `event_date` = yesterday → throws, same as above.
  4. `event_date` = tomorrow → insert proceeds, no throw.
  5. Inserted row's `status` is always `'draft'` regardless of input (R1, regression — already covered live, re-assert here for completeness).
  - Implement: call `isBeforeTomorrowIL(input.event_date)` inside `createEvent` before the insert when `input.event_date` is present; GREEN; commit.
- **Produces:** `publishEvent(eventId): Promise<void>` (loads event; throw `'יש להגדיר מועד עתידי לפני פרסום'` if `event_date` null/≤today; **R2b mirror:** if `rsvp_deadline` is set and already `< todayIL()`, throw `'המועד האחרון לאישור הגעה כבר חלף — קבעו מועד חדש לפני הפרסום'` — app-level pre-check of the same condition the DB trigger re-validates at publish time; update `{status:'active'}` `.eq('status','draft')`); `closeEvent(eventId): Promise<void>` (update `{status:'closed'}`; on DB raise → throw `'יש לסגור או לבטל את הקמפיין לפני סגירת האירוע'`).
- [ ] RED tests for `updateEvent`:
  1. `updateEvent` no longer writes `status`.
  2. On a **non-draft** event, when the input has **NEITHER** the `event_date` nor `rsvp_deadline` KEY (the legitimate disabled-input case) → the built Supabase patch has those keys **ABSENT** (not `null`) — asserted via `Object.keys(patch)`, not via the value.
  3. **On a non-draft event, when the input DOES contain `event_date` and/or `rsvp_deadline` as an explicit key (a forged request bypassing the disabled UI)** → `updateEvent` **THROWS** `'לא ניתן לשנות מועד לאחר פרסום האירוע'` **before touching the DB** — this is a behavior CHANGE from round 1 (silently omitting a forged attempt is replaced with an explicit reject, so a bug or attack attempt is never silently swallowed).
  4. On a **draft** event with the `event_date` key present and a past/today value → throws `'מועד האירוע חייב להיות החל ממחר'`.
  5. `publishEvent` updates status-only.
  - Implement: drop `status` from the patch; `const cur = await requireOwnedEvent(eventId)`; `const datesPresent = 'event_date' in input || 'rsvp_deadline' in input;`. **If `cur.status !== 'draft'`:** if `datesPresent` → `throw new Error('לא ניתן לשנות מועד לאחר פרסום האירוע')`; else build the patch **without** the `event_date`/`rsvp_deadline` keys at all (never set to `null`). **If `cur.status === 'draft'`:** validate `if ('event_date' in input) ...isBeforeTomorrowIL...` and `if ('rsvp_deadline' in input) ...` (R2b mirror), then include whichever keys were present in the patch. Document the UTC-midnight storage dependency. GREEN; commit.

### Task S2.3a — `actions.ts`: `FormData.has()` presence mapping (the OTHER half of the contract S2.3 depends on)
**Files:** modify `src/app/(customer)/app/events/[id]/actions.ts`; test (extend the existing action test file, or `events.test.ts` if actions are tested there).
- **The bug this fixes:** the live `updateEventAction` currently maps `event_date: event_date ? event_date : null` — i.e. ANY falsy form value (including a field that was never rendered because the input is disabled) collapses to `null`, which is exactly the "absent vs explicit-null" ambiguity S2.3's type design exists to prevent. A disabled `<input>` is never included in `FormData` at all — `formData.get('event_date')` would return `null` for it too, indistinguishable from a draft owner explicitly clearing the field.
- **`status` removal (round-3 correction, explicit — companion to the `FormData.has()` fix above):** S2.2 already drops `status` from `updateEventSchema`/`UpdateEventInput`, but `actions.ts` itself must be updated in lockstep, in THREE distinct places, or it will fail to compile / silently desync from the schema:
  1. **The Zod `safeParse` call** — remove `status` from whatever object is passed to `updateEventSchema.safeParse(...)` (it's currently read from `formData.get('status')` and included there).
  2. **The destructure of the parsed result** — remove `status` from `const { name, event_type, ..., status } = parsed.data;` (or equivalent).
  3. **The `updateEvent` call's payload** — remove `status` from the `UpdateEventInput` object built and passed to `updateEvent(...)`.
  Status transitions go exclusively through `publishEventAction`/`closeEventAction` (S2.5a) from this point on — `updateEventAction` must never read or forward a `status` value, even if a stale client somehow still posts one (the field simply has nowhere to go: `UpdateEventInput` has no `status` key after S2.2, so a leftover `formData.get('status')` read would be dead code, not a silent passthrough).
- [ ] RED: with a `FormData` that does **NOT** include an `event_date` entry (simulating a disabled, non-draft input), `updateEventAction` calls `updateEvent` with an input object that has **NO** `event_date` key (`'event_date' in input === false`) — NOT `event_date: null`. With a `FormData` that DOES include `event_date` (even as `''`, simulating a draft owner clearing it), the input object **HAS** the key (`event_date: null` or the trimmed string). **Additional RED (round-3):** even if a `FormData` includes a `status` entry (simulating a stale client), the `UpdateEventInput` object passed to `updateEvent` has **NO** `status` key (`'status' in input === false`) — assert this via `Object.keys(input)`, not just via the absence of an effect.
- [ ] Implement: replace the unconditional `event_date: event_date ? event_date : null` mapping with conditional key inclusion keyed on `formData.has(...)`, AND remove `status` from the `safeParse` input, the destructure, and the `updateEvent` payload (the three places above):
  ```ts
  const input: UpdateEventInput = {
    name,
    event_type,
    venue_name: venue_name ? venue_name : null,
    venue_address: venue_address ? venue_address : null,
    ...(formData.has('event_date')
      ? { event_date: trimmedOrNull(formData.get('event_date')) }
      : {}),
    ...(formData.has('rsvp_deadline')
      ? { rsvp_deadline: trimmedOrNull(formData.get('rsvp_deadline')) }
      : {}),
  };
  ```
  (`trimmedOrNull` = a small helper — add it if `actions.ts` doesn't already have an equivalent — that trims a `FormDataEntryValue` and returns `null` for an empty string; verify against the live file at implementation time before assuming it's new.) GREEN; commit.

### Task S2.4 — `campaigns.ts` + commercial paths: R9 app guards + `cancelCampaign`
**Files:** modify `campaigns.ts`, `agreements.ts` (recordSignedAgreement), `app/api/campaigns/[id]/authorize/route.ts` (J5 hold), `outreach.ts` (sendCampaignWhatsApp), `outreach-engine.ts` (stepGate); tests `campaigns.test.ts`/`agreements.test.ts`/`outreach.test.ts`/`outreach-engine.test.ts`.
- **R9 app coverage = ALL commercial paths** (the DB trigger stays authoritative; these are defense-in-depth + better UX, NOT to be left out): `createCampaign`, `approveCampaign`, `activateCampaign`, **`recordSignedAgreement`**, **the J5 hold route**, **`sendCampaignWhatsApp`**, and the **worker `stepGate`** — each rejects/short-circuits when `event.status !== 'active'` (mirroring the existing past-event guard's style + return shape per site: throw / `{ok:false}` / redirect / `{sent:0}` / `reason:'stopped'`).
- **Produces:** `cancelCampaign(campaignId: string): Promise<void>` — **explicit ownership contract (round-3 correction; REUSE the established pattern, don't duplicate)**, mirroring how `authorize/route.ts` (J5 hold) and `whatsapp-send/route.ts` already gate themselves via `getCampaignForHold(campaignId)` → `requireOwnedEvent(campaign.event_id)`:
  1. **Load the campaign** via the admin client to get its `event_id` — reuse `getCampaignForHold(campaignId)` (already exists, returns `id/event_id/status/capture_status/charge_status`) rather than writing a new accessor.
  2. **Not found** → `notFound()` (404) — **before any RPC call**.
  3. **`await requireOwnedEvent(campaign.event_id)`** — verifies the CURRENT AUTHENTICATED USER owns that event (or, if campaign management is later opened to org members, the equivalent `requireEventAccess`-style check) — throws/404s if not. **`campaignId` and `event_id` are NEVER trusted from the browser to imply authorization** — both are always re-derived from the DB row and re-checked against the session server-side.
  4. **ONLY THEN:** `admin.rpc('cancel_campaign', { p_campaign: campaignId })`.
  `'cancelled'` **and `'already_cancelled'` = idempotent success**; throw `'לא ניתן לבטל קמפיין זה'` on `'not_cancellable'`/`'no_campaign'`.
- [ ] RED tests:
  1. **Ownership gate (round-3, test FIRST):** a campaign whose event the calling user does **NOT** own → `cancelCampaign` throws / `notFound()`s via `requireOwnedEvent`'s existing behavior, **AND `admin.rpc` is asserted NEVER called** (mock the RPC call and assert `.not.toHaveBeenCalled()`).
  2. **Ownership gate, positive case:** a campaign whose event the user DOES own → `requireOwnedEvent` resolves, and `admin.rpc('cancel_campaign', { p_campaign: campaignId })` **IS** called with the correct id.
  3. `createCampaign` throws `'יש לפרסם את האירוע לפני אישורי הגעה'` when `requireOwnedEvent` returns a non-active event.
  4. Once ownership has passed: `cancelCampaign` resolves on `'already_cancelled'` and throws `'לא ניתן לבטל קמפיין זה'` on `'not_cancellable'`.
  - Implement the R9 checks at every path above (using the already-loaded event where present); add `cancelCampaign` with the ownership-before-RPC contract above; GREEN; commit.

### Task S2.5a — actions
**Files:** modify `campaign-actions.ts`.
- [ ] Add `publishEventAction`/`closeEventAction`/`cancelCampaignAction` (bind ids, try/catch with `isNextSignal` re-throw, surface `err.message`, `revalidatePath`). `tsc`+`lint`; commit.

---

## Phase S2.5 — Remediate S0 exceptions (via the built mechanisms only)

### Task S2.5b — execute recorded decisions
- [ ] Re-run S0 preflight live; confirm against the signed-off table.
- [ ] For the V3+V1c `cancel` decision: `select public.cancel_campaign('<bac77347-id>')` (service_role via `db query`) → expect `'cancelled'`. For the V4b `03733daf` cleanup-queue item: optional, owner's call — `cancel_campaign` the pending campaign whenever they're ready to close that event (not required for S1/S2/S3 to ship). For the V1c `publish` alternative (`ec7c68d1` if real): **first** re-save a valid `rsvp_deadline` (satisfying both the CHECK and R2b's lower bound, or NULL) via `updateEvent` while still `draft`, **then** `publishEvent` via the app path after verifying date ≥ tomorrow — never raw SQL. **`00000000…`'s campaigns are explicitly OUT of this step (B2)** — they are V5-informational only and are never cancelled here.
- [ ] Re-run preflight → **zero BLOCKING violations** (V1b/V1c/V3/V4a); V4b items remain a live, non-blocking queue; V5 stays a permanent informational residual. Record outcomes in the runbook; commit.

---

## Phase S3 — UI

### Task S3.1 — Publish/Close + remove status dropdown + lock date inputs
**Files:** create `event-status-actions.tsx`; modify `edit-event-form.tsx`, `page.tsx`.
- [ ] `edit-event-form.tsx` — **build on `5aed01c`'s controlled inputs + min/max coupling; do NOT revert them.** Remove the status `<select>` (lines ~86-98) + the now-unused `EVENT_STATUSES` import. When `event.status!=='draft'`, set `disabled` on both date inputs with hint "נעול לאחר פרסום". On the **draft** path, combine the invariants: **`event_date` input `min = max(tomorrow_IL, rsvpDeadline)`** (raise the existing `min={rsvpDeadline}` coupling up to tomorrow) and **`rsvp_deadline` input `min = today_IL` (R2b, NEW) `max = eventDate` (kept, `5aed01c`)** — both bounds on the same input. (The status field disappearing means `updateEventSchema` no longer receives `status` — aligns with S2.2.)
- [ ] `event-status-actions.tsx` (client, mirror `manage-client.tsx` `ActionButton`): **Publish** (draft + valid future date) → `publishEventAction`; **Close** (active; disabled with explainer when `hasBlockingCampaign`) → `closeEventAction`; `<FormError>`/`<FormNotice>`.
- [ ] `page.tsx`: compute `hasBlockingCampaign` server-side (campaign list, blocking set) + render `<EventStatusActions>`. `npm run build`; commit.

### Task S3.2 — minimal Cancel-campaign button
**Files:** modify `manage-client.tsx` (+ `campaign/[campaignId]/page.tsx` passes `canCancel`).
- [ ] Page computes `canCancel` **server-side via the FULL R8 predicate** = `status∈{draft,pending_approval,approved}` ∧ `capture_status IS DISTINCT FROM {authorized,pending,hold_review}` ∧ `charge_status==null` ∧ **`count(billed_results where campaign_id=…) === 0`** (query `billed_results` directly — **NOT** `summary.reachedCount`, which is a derived figure, not the authoritative row count). This mirrors the DB predicate exactly; the RPC re-checks authoritatively. Render Cancel `ActionButton` (danger, confirm "לבטל את הקמפיין?") → `cancelCampaignAction`. `npm run build`; commit.

---

## Phase S4 — Verification + final hole sweep

### Task S4.1
- [ ] **Test coverage (explicit):** the live `5aed01c` LC-2 `updateEventSchema` tests (`rsvp_deadline vs event_date`) are **preserved and still green**; NEW tests added — `event_date ≥ tomorrow` on create+update (S2.2); the **non-draft date key-ABSENCE → omitted patch** case (S2.3); the **non-draft date key-PRESENCE → REJECTED (forged-request defense)** case (S2.3, behavior change from round 1); the `actions.ts` `FormData.has()` presence-mapping cases (S2.3a).
- [ ] **R2b test coverage (explicit, split by mechanism — DB trigger vs DB CHECK vs Zod vs app):**
  - **[new trigger]** `rsvp_deadline = yesterday` → **rejected** (insert, draft edit, and re-checked at `draft→active` publish). `rsvp_deadline = today` → **accepted** (the `>= today_IL`, not `>= tomorrow_IL`, boundary).
  - **[existing CHECK `events_rsvp_deadline_within_event`, UNCHANGED — regression only]** `rsvp_deadline = event_day` → **accepted**; `rsvp_deadline` set **after** `event_date` → **rejected**; `rsvp_deadline` set with `event_date IS NULL` → **rejected**.
  - **Non-invariant guarantee:** an event whose `rsvp_deadline` has naturally elapsed (e.g. `active`, deadline now in the past) accepts an **unrelated update** (name/venue change, no `event_date`/`rsvp_deadline` in the patch) **without being blocked** — confirms R2b's new trigger is write-time-only, not a standing row-level invariant.
- [ ] `npx tsc --noEmit` clean · `npm run lint` clean · `npx vitest run` all green · `npm run build` ok · re-run the isolated-PG harness green · re-run S0 preflight live (V1a/V1b/V1c/V3/V4a/V4b/V5) → **V1b, V1c, V3, AND V4a MUST ALL BE GENUINELY EMPTY (zero rows) — round-3 precision: "explicitly deferred" / "recorded in the S0 decision table" is NOT a passing state of S4, it is a RELEASE BLOCKER.** Every TRUE violation (incl. both of `ec7c68d1`'s findings) must be ACTUALLY resolved via S2.5's mechanisms before S4 can be marked done — re-run the preflight again after S2.5 and confirm zero, don't just point at the decision table. **V4b stays a live non-blocking cleanup queue** (the ONLY bucket besides V5 allowed to remain non-empty — not required to be empty, ever); **V5 remains informational** (app-only one-per-event; no artificial "zero") · `supabase db advisors --linked --type security` → no new findings, `cancel_campaign` AND `campaigns_guard_cancel` confirmed `SECURITY DEFINER`, `cancel_campaign` anon/auth-revoked · authed browser smoke (create draft → publish → run campaign → cancel → close; attempt a forged non-draft date PATCH → confirm rejected; attempt `cancelCampaign` on a campaign belonging to an event the test user doesn't own → confirm denied, RPC never called). Report SHAs.

---

## 7. Risks · Rollback · Deploy order

**Risks & mitigations**
- **Existing rows are NEVER retroactively scanned by the new triggers (round-3 precision)** — S1's apply-gate requires only **S0 sign-off** (a recorded decision per TRUE violation), not that those rows already pass. The triggers are write-time-only, so a legacy row with a decided-but-not-yet-executed exception does not block S1/S2/S3 from deploying — it just can't be re-saved/published until remediated. **S2.5 is what actually EXECUTES those decisions** (`cancel_campaign`/`publishEvent`) for the TRUE violations: `ec7c68d1`'s V3+V1c findings. **`03733daf`'s V4b is a separate, permanently optional cleanup-queue item** — never required to reach zero, at S1 or at S4. **`00000000…`'s campaigns are explicitly EXCLUDED (B2)** — V5-informational only, never remediated. **Critical: S4's gate (unlike S1's) DOES require V1b/V1c/V3/V4a to be genuinely empty** — see S4.1 and §11 DoD; "decided" is sufficient for S1, "resolved" is required for S4.
- **S1 itself never opens a gap** — the fail-safe order (new guards created BEFORE L0a dropped) means a mid-migration failure leaves L0a-only or L0a+new active. No reliance on a `db push` transaction wrapper; no `begin/commit` added.
- **Window between S1 (triggers live) and S2/S3 (new app deployed):** the OLD edit form posts `status` + `event_date` together. **Unchanged** re-submits pass (R6 no-op + R5 `IS DISTINCT FROM` unchanged — relies on event_date being midnight-UTC, confirmed live); only an actual status/date CHANGE via the old form would 4xx. The new `updateEvent` (S2.3) **omits** dates when not draft, shrinking this further. Mitigation: deploy S2/S3 immediately after S1 (back-to-back).
- **`try_record_billed_result` rewrite** must reproduce the L2 body exactly + only add the R9 check (placed after `event_passed`, reads `public.events`) — verify by diffing the live `pg_get_functiondef` before/after in the isolated cluster.
- **No partial-unique index added** (would fail on `00000000`); one-per-event stays an app convention — documented, not a regression. V5 is informational (B2).
- **R2b is purely additive (round-2 simplification) — the CHECK-supersession risk from round 1 no longer exists.** `events_rsvp_deadline_within_event` is never dropped, never modified, never part of this migration's drop sequence — there is no window, gap, or proof-of-replacement concern for it at all. The only new risk surface is the NEW lower-bound trigger itself, covered by the existing S0/S2.5 process for `ec7c68d1` (its V1c finding).

**Rollback points** (forward-only; each is independently revertible by a follow-up migration/deploy)
- S1: renamed triggers are `DROP TRIGGER … / CREATE TRIGGER …` (no `CREATE OR REPLACE TRIGGER`). A follow-up forward migration can `DROP` the new triggers/RPC and re-`CREATE` the L0a triggers (kept in git history) — no data was rewritten.
- S2/S3: revert the app deploy (`pm2` + previous `.next`); DB triggers stay (still safe — old app's no-op submits pass).
- S2.5: cancellations are state-only and reversible only by creating a replacement campaign (by design); review each before running.

**Exact deploy order**
1. **S0** sign-off (read-only).
2. **S1** → isolated-PG test green → **approval** → `supabase db push --linked` (fail-safe-ordered: new guards created before L0a dropped → no gap even without a tx wrapper) → live-verify (triggers/RPC present, L0a dropped, advisors clean).
3. **S2 + S3** built together → single `npm run deploy` (data-layer + actions + Zod + UI in one build) — back-to-back with S1.
4. **S2.5** → run the recorded remediations via `cancel_campaign` / `publishEvent`.
5. **S4** → full gate + live smoke + zero-residual preflight.

---

## Self-review (plan vs spec)
- **Coverage:** R1→S1.1; R2→S1.1+S1.2+S2.2; **R2b (additive)→S1.1(insert lower-bound+draft-edit lower-bound+publish-recheck)+S1.2+S2.2+S2.3+S2.3a+S3.1+S4.1**; R3→S1.1; R4→(unchanged, constraints); R5→S1.1+S2.3; R6→S1.1; R7→S1.1+S2.3+S3.1; R8 (incl. draft, both fns SECURITY DEFINER)→S1.1+S2.4+S3.2; R9→S1.1(camp trigger + try_record, `public.events`-qualified)+S2.4. S0→S0.1 (V1a/V1b/V1c/V3/V4a/V4b/V5); S2.5→S2.5b; UI Publish/Close/Cancel→S3; error messages (incl. forged-request reject)→S2.3/S2.3a/S2.4/S3. ✅
- **Live-grounded:** L0a drop targets, campaign columns, app-only one-per-event, S0 findings (`ec7c68d1` V3+V1c, `03733daf` V4b, `00000000…` V5) — all verified against live DB/code. **R2b finding (2026-07-01):** `ec7c68d1`'s `rsvp_deadline=2026-06-29` confirmed already-past live, both bounds of its predicate independently evaluated (CHECK's upper bound=true, the NEW lower bound=false) — root-caused to a missing rule, not a bypass.
- **CHECK `events_rsvp_deadline_within_event` — ROUND-2 CORRECTION (supersedes the round-1 "corrected to DROP it" framing, which was itself wrong):** the CHECK is **KEPT, UNCHANGED, never touched** by this migration. It remains the sole authority for "requires `event_date`" + "`<= event_day_IL`". R2b is a **separate, additive, NEW trigger** for ONLY the lower bound (`>= today_IL`) — the one piece a CHECK cannot express. Nothing is dropped, superseded, or reproduced.
- **R8 round-2 completion:** `campaigns_guard_cancel` is now `SECURITY DEFINER` (was `INVOKER` — inconsistent with its role as an unconditional gate); `cancel_campaign`'s `search_path` is now `''` (was `'public'`) with every table reference explicitly `public.`-qualified, consistent with all other SECDEF functions in this migration. Reframed "RPC = only path" → "RPC = app's path; trigger = the authoritative DB-level gate for any direct write" (the trigger was always what made it actually unconditional — the RPC alone can't prevent a direct UPDATE by a sufficiently privileged writer).
- **S2.3/S2.3a round-2 completion:** `UpdateEventInput`'s date fields are now optional keys (presence-based, not value-based); `updateEvent` REJECTS (not silently omits) an explicit date/deadline key on a non-draft event; `actions.ts`'s `FormData.has()` mapping is now an explicit task (was previously unaddressed — the live code's `field ? field : null` mapping conflated "absent" and "empty").
- **S0 round-2 restructure:** V1/V2 retired; V1a (stale draft date) / V1b (active+null date, true violation) / V1c (full combined predicate) / V4a (closed+blocking, true violation) / V4b (active-past+blocking, non-blocking cleanup queue — `03733daf`'s new home) added. `closed`+`event_date IS NULL` explicitly documented as NOT a violation.
- **B2 consistency:** `00000000…` removed from every S2.5 "cancel" example throughout this document (it was never actually cancellable for 2 of its 3 relevant campaigns); it appears ONLY as a V5-informational note. S4's DoD requires zero BLOCKING violations, explicitly not V4b or V5.
- **Placeholders:** none — SQL is concrete; `<ts>` = `supabase migration new` timestamp.
- **R8 round-3 completion (ownership contract):** `cancelCampaign`'s spec previously never stated who verifies the caller may act on `campaignId` — the RPC is `service_role`-only with no caller-identity check, so authorization was entirely unstated app-side. Now explicit in S2.4: load via `getCampaignForHold(campaignId)` (reused, not duplicated) → `requireOwnedEvent(campaign.event_id)` → only then `admin.rpc('cancel_campaign', …)`, mirroring the EXISTING pattern already used by `authorize/route.ts` (J5 hold) and `whatsapp-send/route.ts`. `campaignId`/`event_id` are never trusted from the browser to imply authorization. Two new RED tests added (negative: not-owned → RPC never called; positive: owned → RPC called with the correct id) ahead of the pre-existing `createCampaign`/idempotent-cancel tests.
- **S0/S1/S4 round-3 precision (sign-off vs resolved):** the plan previously conflated "S1 may deploy" with "violations must already be fixed," and S4's own gate line said "all clear **or explicitly deferred**" — which wrongly treated a recorded-but-unexecuted decision as a pass condition. Corrected throughout (S1.2's apply gate, the Risks §7 bullet, and S4.1's gate line): **S1 requires only S0 sign-off** (every TRUE violation has a recorded decision) — triggers are write-time-only and never retroactively scan existing rows, so deploying with known, decided-but-not-yet-executed legacy exceptions (`ec7c68d1`) is safe. **S4 requires V1b/V1c/V3/V4a to be GENUINELY EMPTY** (zero rows, re-verified live after S2.5) — "decided"/"deferred" satisfies S1 only, never S4. V4b and V5 remain the only buckets allowed to stay non-empty at any phase.
- **S2.3 round-3 addition (`createEvent` guard):** the plan previously only implied a `createEvent` guard via the File Structure table row; now an explicit dedicated task with its own 5 RED tests (`null`/omitted → ok, today/yesterday → throw before insert, tomorrow → ok, `status` always forced to `'draft'`), reusing `isBeforeTomorrowIL` (S2.1) the same way `updateEvent`'s draft path does.
- **S2.3a round-3 addition (`status` cleanup in `actions.ts`):** explicit instruction added to remove `status` from the Zod `safeParse` input, the destructure of the parsed result, and the `UpdateEventInput` payload built for `updateEvent` — companion to S2.2's schema-level `status` removal, which `actions.ts` must mirror in lockstep or risk dead/desynced code. New RED test: a stale client posting `status` in `FormData` must not result in a `status` key reaching `updateEvent`.
- **Implementation approval (round-3):** the user granted conditional approval to begin implementation — *"לאחר כל התיקונים אתה רשאי להתחיל"* (after all corrections, you may begin) — contingent on completing the 3 round-3 correction items above first. With this Self-review entry, all round-3 corrections are applied to both spec and plan; **Phase S0 may now begin** (read-only preflight only — still no schema/code change until S0 sign-off is reviewed and S1 is separately approved).
