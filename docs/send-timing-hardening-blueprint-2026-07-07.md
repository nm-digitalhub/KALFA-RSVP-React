# Send-Timing Consistency Hardening — Implementation Blueprint

Date: 2026-07-07
Status: UNDERSTAND-only design. **No product code was changed to produce this document.**
Scope: `beta/`. Every anchor below is `file:line` in the live tree, read directly.

Grounding sources (all read in full unless noted):
- `worker/main.ts` (277 lines)
- `src/lib/data/outreach-engine.ts` (396 lines)
- `src/lib/outreach/send-window.ts`, `schedule.ts`, `send-policy.ts`, `jewish-calendar.ts`
- `src/lib/data/outreach-config.ts`, `src/lib/data/event-date.ts`
- `src/lib/queue/queues.ts`
- `src/lib/data/events.ts` (`updateEvent`), `src/lib/data/campaigns.ts` (`cancelCampaign`/`closeCampaign`/`pauseCampaign`)
- migrations `202606290032_outreach_state.sql`, `20260707120000_whatsapp_send_timing.sql`, `20260630223635_event_lifecycle_state_model.sql` (`cancel_campaign` RPC)
- pg-boss v12.25.1 probe findings (empirical, isolated schema) — quoted inline as **[PROBE]**.

---

## 0. The gap, stated precisely

Every scheduled step job is enqueued under a **deterministic id** `detId(campaignId, contactId, stepIndex)` (`src/lib/outreach/schedule.ts:75-89`) with `startAfter = slot.at` computed from `policy + calendar + event_date` at *arm time* (`worker/main.ts:129-137`, `:197-210`).

Because the id is deterministic and pg-boss inserts with `INSERT … ON CONFLICT DO NOTHING` **[PROBE: `send` returns the id on insert, `null` on `(name,id)` conflict, no throw]**, re-arming an already-queued step is a **no-op**. That idempotency is the system's strength — and the exact source of the staleness gap:

> Once a step job for `(campaign, contact, step)` sits in the queue with an old `startAfter`, **no plan change re-times it**. A later policy edit, schedule edit, or (draft) event-date edit recomputes a different `slot.at`, but the re-arm collides on the same det id and returns `null`, leaving the stale job in place.

The execution-time **pre-flight** gate (`worker/main.ts:97-112`) partially compensates: it re-derives a legal instant from `now` and *defers* a job that fires inside night/Shabbat/chag. But it re-plans from `plannedMs: now` (`:98`), i.e. it only asks "is *now* legal?" — it never asks "is the plan this job was built under still the current plan?". So a job that fires at a *legal* instant under a *stale* plan is sent as-is.

Additional smaller gaps confirmed by reading:
1. `setPlannedAt` runs **unconditionally** after every `boss.send` in `handleArm` (`worker/main.ts:212-216`), including when `send` returned `null` (a conflict — the job already existed), clobbering the real job's anchor. Its `{ error }` is ignored (`outreach-engine.ts:221-232`) — silent failure.
2. `planned_at` is only written on the arm path, never on schedule-next (`worker/main.ts:129-137`) — so the audit/replan anchor is missing for chained steps.
3. `eventDayEndMs` returns **23:59 local** (`send-window.ts:65-67`), not the exclusive next-midnight; a slot at 23:59:30 is "before" a 23:59 expiry yet effectively the event day is over.
4. The pre-flight defer uses an **id-less** fresh job (`worker/main.ts:110`); two arm-fired duplicates that both defer create **two** id-less jobs (only `claimStep` saves us downstream).
5. Skip reasons from `resolveSendSlot` (`'expired' | 'no_window_before_expiry'`) and opt-out/consent skips (`outreach-engine.ts:283-289`) are **not preserved** into `outreach_state.status`/`stop_reason` — the opt-out path returns `{action:'skipped'}` and leaves the row `active`.

The hardening closes these with: **(A)** a deterministic *plan revision* folded into the job id + stored per contact, **(B)** a single `enqueueStepJob` contract, **(C)** a deterministic defer-successor id, **(D)** an exclusive event-day end + guarded calendar range, **(E)** skip-reason preservation, **(F)** a web→DB-only replan signal.

---

## 1. PLANNING IDENTITY / REVISION

### 1.1 Do existing fields already carry a plan revision? — **No clean one exists.**

Fields that change on a plan-affecting edit today:

| Field | Anchor | Changes when… | Usable as plan revision? |
|---|---|---|---|
| `campaigns.updated_at` | types.ts campaigns row; `set_updated_at` trigger | **any** campaign column write (e.g. `capture_status`, `charge_status`) | **No** — too coarse; bumps on billing writes unrelated to timing |
| `events.updated_at` | types.ts events row | any event column write | **No** — coarse; also on a different table than the campaign |
| `app_settings.updated_at` | types.ts app_settings row | any settings write | **No** — coarse; global |
| `events.event_date` | `outreach-engine.ts:110`, hashed indirectly | the planning input itself | Partial — an input, not an identity; **immutable post-publish** (see §6.1) |
| `outreach_state.planned_at` | `20260707120000_whatsapp_send_timing.sql:41-42` | best-effort, arm-path only | **No** — nullable, not written on all paths, `{error}` ignored |
| `outreach_state.current_step_index` | DDL `:18` | on advance (`claimStep`) | Detects *step* change, **not** *plan* change of the same step |

Critically, the three planning inputs live on **three different tables**: `events.event_date`, `campaigns.outreach_schedule`, and the **global** `app_settings.whatsapp_send_policy`. No single existing column reflects a global policy edit against a specific campaign's queued job. So a bare counter on one table cannot be the whole identity.

### 1.2 Recommended design — a deterministic **plan fingerprint** folded into the job id (PRIMARY), with an optional explicit counter (belt).

The plan of one step is fully determined by four live inputs, all already loaded in `getCampaignContext` + `getSendPolicy`:

```
planInputs(stepIndex) = {
  eventDateIL:  israelCalendarDay(Date.parse(ctx.eventDate)),   // event-date edits (draft only)
  touchpoint:   ctx.schedule[stepIndex],                        // {days_before, channel, message_key}
  policyHash:   sha1(canonicalJSON(policy)),                    // any whatsapp_send_policy edit
  planRevision: campaign.plan_revision                          // explicit belt lever (default 0)
}
planRev(stepIndex) = sha1short(canonicalJSON(planInputs(stepIndex)))   // 12 hex chars
```

`planRev` changes **iff** an input that affects the slot changes — so the det id changes automatically, no web→worker coupling required. `campaign.plan_revision` is an escape hatch for a forced replan that leaves the hashed inputs unchanged (rare); web actions may bump it (§6) as defense-in-depth.

**Fold `planRev` into the deterministic id.** Extend `detId` by appending an optional segment (keeps existing 3-arg callers valid at TS level only if we add an overload; cleaner to make it required and update the two call sites):

```ts
// src/lib/outreach/schedule.ts — EXTEND (design)
export function detId(
  campaignId: string,
  contactId: string,
  stepIndex: number,
  planRev: string,          // NEW — '' preserves the legacy id for migration windows
): string  // UUIDv5 over `${campaignId}:${contactId}:${stepIndex}:${planRev}`
```

Because it is a UUIDv5 with correct version/variant nibbles (`schedule.ts:85-86`) it satisfies the project's strict `z.uuid()` validator **[MEMORY: zod4-uuid-version-strict]** and Postgres' `uuid` column **[PROBE: a string-suffixed id throws 22P02; only real uuids insert]**.

Effect: an edit that changes `planRev` yields a **new** det id → the arm sweep enqueues a *fresh* job at the new slot; the old-plan job (if any) is caught by the pre-flight stale check below and never sends the stale content. **[PROBE: re-sending the OLD det id after the plan changed is irrelevant — the new id is a different `(name,id)`, so it inserts cleanly; the old row's presence never blocks the new one.]**

### 1.3 Migration (minimal). Flow = migration → apply → `supabase gen types typescript --linked` → diff → wire. **Never hand-edit `types.ts`.**

New migration `supabase/migrations/<ts>_send_timing_plan_revision.sql`:

```sql
begin;

-- Explicit forced-replan lever (belt; the fingerprint is the primary signal).
alter table public.campaigns
  add column if not exists plan_revision integer not null default 0;

-- Global policy revision — bumped by the future admin policy-edit action so a
-- policy change forces a replan even if the JSON canonicalises identically.
alter table public.app_settings
  add column if not exists send_policy_revision integer not null default 0;

-- Per-contact: which step + plan the currently-queued job was built under.
-- Lets the worker detect a stale queued job atomically (see §1.4). planned_at
-- already exists (20260707120000); add the identity it refers to.
alter table public.outreach_state
  add column if not exists planned_step_index integer,
  add column if not exists plan_rev           text;

comment on column public.campaigns.plan_revision is
  'Forced send-timing replan lever; folded into the outreach job id.';
comment on column public.outreach_state.plan_rev is
  'planRev fingerprint the queued job for planned_step_index was built under.';

commit;
```

`send_policy_revision` is read once per arm sweep and folded into `policyHash` input (or concatenated into `planInputs`), so a policy edit that an admin makes intentionally (bumping the counter) forces a new `planRev` on every step of every campaign — global, exactly as policy is global.

### 1.4 How the worker gates on the revision **atomically vs `outreach_state`**

Same compare-and-set discipline as `claimStep` (`outreach-engine.ts:180-197`) — a single conditional `UPDATE … RETURNING` so the minute-arm and an in-flight handler cannot both re-plan:

```ts
// design: outreach-engine.ts
export async function recordPlan(
  campaignId, contactId, stepIndex, planRev, plannedAtIso,
): Promise<'recorded' | 'stale'> {
  const { data, error } = await admin.from('outreach_state')
    .update({ planned_step_index: stepIndex, plan_rev: planRev, planned_at: plannedAtIso })
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .eq('current_step_index', stepIndex)        // step must not have advanced
    .select('id').maybeSingle();
  if (error) throw new Error('רישום תזמון השליחה נכשל');   // SURFACE, not silent
  return data ? 'recorded' : 'stale';
}
```

Staleness is then detectable two ways, both O(1) against the cursor row:
- **Arm sweep**: compute `planRev`; if `row.plan_rev !== planRev` for `row.current_step_index`, the queued job is stale → enqueue the new det id (§2) and (optional cleanup) `boss.cancel(QUEUES.step, oldDetId)`.
- **Pre-flight (execution time)**: recompute `planRev` from live `ctx + policy` for the job's `stepIndex`; if it differs from the `planRev` embedded in the job's own id (or from the stored `plan_rev`), the running job is **stale** → do not send; re-enqueue the current step under the new `planRev`, return. `claimStep` still guarantees at-most-once even if the old and new both reach `executeStep`.

---

## 2. `enqueueStepJob(...)` — the SINGLE enqueue path

Today four `boss.send(QUEUES.step, …)` sites exist with divergent options (arm `:197`, schedule-next `:129`, paused re-check `:74`, pre-flight defer `:110`). Collapse the *scheduling* sites (arm, schedule-next, pre-flight-defer, replan) behind one function; keep the paused-poll (`:74`) as-is (it is a global-gate poll, not a plan point — see §7).

### 2.1 Signature + return union

```ts
// design: src/lib/outreach/enqueue.ts (new, pure-ish; takes boss + admin writer injected)
export type EnqueueResult =
  | { outcome: 'scheduled';        jobId: string; at: number; planRev: string }
  | { outcome: 'already_scheduled' }                         // boss.send -> null (det conflict)
  | { outcome: 'deferred';         at: number }              // slot pushed to a future legal instant
  | { outcome: 'skipped';          reason: SkipReason }      // computeStepSlot decision 'skip'
  | { outcome: 'stale' };                                    // step/revision moved under us

export async function enqueueStepJob(boss: PgBoss, args: {
  campaignId: string; contactId: string; eventId: string; stepIndex: number;
  ctx: CampaignContext; policy: SendPolicy; calendar: BlockedCalendar; nowMs: number;
  planRevInputs: { planRevision: number; policyRevision: number };
}): Promise<EnqueueResult>
```

### 2.2 Rules, each mapped to a PROBE finding

1. **Uniform `STEP_RETRY`** on every real scheduled send (`src/lib/queue/queues.ts:15-20`). **[PROBE: per-job options override queue defaults via `COALESCE`; queues here are created with bare names/defaults, so retry+dead-letter come only from the spread — so it must be uniform.]** (The call-request send `worker/main.ts:145` omitting `STEP_RETRY` is a *separate* known gap, out of scope here but noted.)
2. **Deterministic id** `detId(campaignId, contactId, stepIndex, planRev)`. **[PROBE: same id ⇒ `ON CONFLICT DO NOTHING` ⇒ at-most-once enqueue; uniqueness is per queue (PK `(name,id)`), so the call-request namespace offset `100000+stepIndex` at `:146` stays collision-free.]**
3. **Compute the slot** with `computeStepSlot` (`send-window.ts:78-98`). Map its result:
   - `decision:'send'` → attempt `boss.send`.
   - `decision:'skip'` → return `{outcome:'skipped', reason}` (caller maps to status, §5). **Never** enqueue.
4. **Write `planned_at`/`plan_rev` ONLY when `boss.send` returned a real id** (non-null). **[PROBE: `send` resolves to the id string on insert, `null` on conflict.]** On `null` → return `{outcome:'already_scheduled'}` and **do not** touch `planned_at` — the existing job already owns the anchor. This fixes the unconditional `setPlannedAt` at `worker/main.ts:212-216`.
5. **Guard the anchor write on `current_step_index` AND `plan_rev`** via `recordPlan` (§1.4). If it returns `'stale'` → return `{outcome:'stale'}`; the caller must not overwrite. This prevents the minute-arm and an in-flight defer from racing the anchor.
6. **Check `{ error }` from Supabase and surface/log it** (Hebrew user-safe message thrown; the worker logs `e.message` only, never PII — matches `worker/main.ts:238`). No silent success (fixes `setPlannedAt` ignoring `{error}`).
7. **Return `'stale'` instead of overwriting** whenever the step index or revision changed between slot computation and the anchor write.

### 2.3 Decision → outcome table

| computeStepSlot / send result | recordPlan | EnqueueResult |
|---|---|---|
| `skip` (`expired`/`no_window_before_expiry`) | — | `skipped{reason}` |
| `send`, `boss.send` → id | `recorded` | `scheduled{jobId,at,planRev}` |
| `send`, `boss.send` → id | `stale` | `stale` (job created but cursor moved; a later arm cleans up) |
| `send`, `boss.send` → `null` | (skipped) | `already_scheduled` |
| slot pushed to future by pre-flight | `recorded` | `deferred{at}` |

Callers (`handleArm`, `handleStep` schedule-next, pre-flight, replan) branch on the union instead of open-coding options. Nothing depends on the returned job id beyond logging **[PROBE P3: worker never inspects `send`'s id today; the null case is intentionally fine]**.

---

## 3. DEFER-SUCCESSOR IDENTITY

Problem: when a job fires under the pre-flight and must defer to a future legal instant (`worker/main.ts:109-112`), the **original det-id job is `active`** (the handler is running it). **[PROBE: re-sending the SAME det id while it is `active` returns `null` — the self-duplicate guard; a handler cannot re-enqueue its own in-flight id.]** So the successor MUST use a different, still-deterministic id.

### 3.1 The scheme

```
deferId(campaignId, contactId, stepIndex, planRev, targetSlotMs) =
  UUIDv5 over `${campaignId}:${contactId}:${stepIndex}:${planRev}:pf:${targetSlotMs}`
```

- **Deterministic, not random, not timestamp-of-now.** **[PROBE: a deterministic derived uuid yields exactly ONE successor under two concurrent racing sends — winnersCount=1, rowCount=1; a random/`now()`-based id would create duplicates.]**
- **Keyed on `targetSlotMs`** (the computed next legal instant, `pf.at`), so two old jobs that both defer to the **same** next instant collapse to **one** successor (PK conflict → 1 winner, 1 `null`), while a genuinely different next instant gets its own id. This is the "exactly one successor" guarantee the task requires.
- **Not a string suffix on the parent uuid.** **[PROBE: `DET+'_d1'` throws 22P02 `invalid input syntax for type uuid`; the id column is `uuid`-typed.]** We hash into a fresh UUIDv5 (correct version nibble) so both Postgres and the strict `z.uuid()` validator accept it.

### 3.2 Releasing the original claim

**[PROBE: the defer-from-active pattern is — enqueue the successor under the derived id, then `complete` the original normally; `boss.complete(queue, DET)` returned `{requested:1, affected:1}` and left DET `completed`; the successor insert is independent of completing the original.]**

Concretely in `handleStep`: on `pf.at > now`, call `enqueueStepJob`-style logic with `deferId(...)` and `startAfter: new Date(pf.at)`, then **return** (the handler resolving = pg-boss auto-`complete`s the original active job — the worker never calls `boss.complete` manually today; resolution is enough). The original det id becomes `completed`; its row remains until maintenance archives it **[PROBE: completed rows stay until retention/maintenance; while present they still conflict, which is fine — we no longer target that id]**.

### 3.3 Successor lifecycle

When the successor fires at `pf.at`, it re-enters `handleStep` → gate → pre-flight. If still early (rare re-block), it defers again under `deferId(..., newTargetSlotMs)` — a new id because `targetSlotMs` advanced, so no self-collision. `claimStep` (`outreach-engine.ts:180-197`) is the terminal at-most-once guarantee: even if a stale original and a fresh successor both reach `executeStep`, only the first `UPDATE … WHERE current_step_index = stepIndex` wins.

---

## 4. `eventDayExclusiveEndMs` + calendar range

### 4.1 Replace `eventDayEndMs` (23:59) with an **exclusive next-midnight**

```ts
// design: send-window.ts — replaces eventDayEndMs (:65-67)
export function eventDayExclusiveEndMs(eventDateIso: string): number {
  const eventDayIL = israelCalendarDay(Date.parse(eventDateIso));   // 'YYYY-MM-DD'
  return localInstant(addDays(eventDayIL, 1), 0);                   // 00:00 IL of the NEXT day
}
```

`localInstant` (`send-window.ts:47-51`) routes through `ilWallTimeToIso` (`event-date.ts:78-88`), which looks up the **actual UTC offset** for that instant — so the boundary is **DST-correct** (02:00 vs 03:00 shift handled by ICU, no hand-rolled offset).

`resolveSendSlot` is already **end-exclusive** on the expiry: `if (t >= expiresAtMs) skip` (`send-window.ts:132`) and `if (at >= expiresAtMs) skip` (`:174`). With the exclusive next-midnight, any slot at/after the day rollover is correctly rejected, and the `expired` vs `no_window_before_expiry` split (`:135`) stays meaningful.

### 4.2 Calendar range = `[now, expiry]`, skip **before** building

Today both build sites use `Date.parse(ctx.eventDate) + DAY_MS` (`worker/main.ts:90`, `:182`). Replace with `eventDayExclusiveEndMs(ctx.eventDate)` and **guard before building**:

```ts
// design: handleStep / handleArm
const nowMs = Date.now();
const expiryMs = eventDayExclusiveEndMs(ctx.eventDate);
if (nowMs >= expiryMs) {                     // event day already over — no reverse range
  // handleStep: setOutreachStatus(...,'exhausted','expired'); return.
  // handleArm:  skip this contact.
}
const cal = buildJewishCalendar(nowMs, expiryMs);
```

Reasons:
- **No reverse range** into `buildJewishCalendar(fromMs, toMs)`. It pads `±3d` (`jewish-calendar.ts:44-51`); a `from > to` range would still call `HebrewCalendar.calendar` with an inverted window and yield an empty/garbage interval set → the pre-flight could mis-classify. Guarding first avoids it.
- Mirrors the existing `isPastEventDay` semantics (`event-date.ts:27-35`) and the gate's L1 check (`outreach-engine.ts:168`), keeping "past event day" defined once.

---

## 5. Skip reasons preserved into `status` / `stop_reason`

`outreach_state.status ∈ {active, reached, stopped, exhausted, not_eligible}` (DDL `:17`); `stop_reason` is free text (DDL `:24` documents `reached|closed|removal_requested|consent_revoked`). Extend the vocabulary and **always** persist a reason on a terminal or deferred-out outcome. Required mapping (task list: expired / no_window_before_expiry / stale / guest_responded / opted_out / campaign_inactive):

| Source condition | Anchor today | New terminal write |
|---|---|---|
| `resolveSendSlot` `reason:'expired'` (planned already past expiry) | `send-window.ts:135` | `status='exhausted'`, `stop_reason='expired'` |
| `resolveSendSlot` `reason:'no_window_before_expiry'` | `send-window.ts:135,175,179` | `status='exhausted'`, `stop_reason='no_window_before_expiry'` |
| Plan changed under a queued/running job | §1.4 | **non-terminal**: re-plan; `stop_reason` untouched. If the re-plan itself yields `skip`, cascade to the row above. Audit via `plan_rev` change + `planned_at`. |
| Contact reached (billed) | gate `outreach-engine.ts:174`; `handleStep:82` | `status='reached'`, `stop_reason='reached'` (a.k.a. **guest_responded**) — already done |
| `contact.removal_requested` OR WhatsApp `!whatsapp_consent_at` | `outreach-engine.ts:283-286` currently returns silent `{skipped}` | **NEW**: `status='stopped'`, `stop_reason='removal_requested'` / `'consent_revoked'` (**opted_out**) — make terminal + audited instead of silently leaving `active` |
| Gate `stopped` (campaign not active / closed / paused / event not active) | `handleStep:78`; gate `:162-173` | `status='stopped'`, `stop_reason='campaign_inactive'` (refine from the current blanket `'closed'`) |

Implementation note: the opt-out terminalization must run **before** `claimStep` so a removed contact is stopped without advancing the cursor, and it must be idempotent (`setOutreachStatus` updates by `(campaign, contact)` only, `:214-215`, so it can flip from any state — safe to re-run).

---

## 6. WEB replan (web mutates DB only; worker reacts — **no web→pg-boss calls**)

### 6.1 `updateEvent` — event-date change is **structurally impossible for a live campaign**

`updateEvent` throws `'לא ניתן לשנות מועד לאחר פרסום האירוע'` for any non-draft event (`events.ts:339-342`); the `event_date` branch (`:345-350`) is reachable **only on `status='draft'`**. A campaign only runs when `event.status='active'` (gate R9, `outreach-engine.ts:173`; `stepGate` returns `stopped` otherwise). Therefore **a live campaign's `event_date` cannot drift** — the stale-plan risk from event-date is bounded to the pre-publish window when no active outreach exists.

Consequence for the design: no web→worker coupling is needed for event-date; `event_date` is a hashed input to `planRev` (§1.2), so on the (draft) edit the fingerprint changes automatically, and by the time outreach arms, the fresh event date is already in `getCampaignContext`. **Optional belt**: in the `event_date` branch (`events.ts:349`), also `update campaigns set plan_revision = plan_revision + 1 where event_id = ? and status <> 'cancelled'` — harmless (there is no active campaign on a draft) but keeps the lever consistent if the lifecycle ever loosens.

### 6.2 Policy change — bump `send_policy_revision`

Grep confirms **no web action writes `whatsapp_send_policy` today** — it is read-only in `outreach-config.ts:45-59` and seeded by migration `20260707120000_whatsapp_send_timing.sql:18-36`. When the future admin policy-edit action (P1b) lands, it MUST, in the same statement that writes the JSON, `update app_settings set send_policy_revision = send_policy_revision + 1`. The worker folds `send_policy_revision` into `planRev` (§1.2), so the next arm sweep (≤1 min) re-times every queued step under the new policy. `getSendPolicy` already fail-safes to `DEFAULT_SEND_POLICY` on invalid input (`outreach-config.ts:45-59`), so a bad edit never opens night/Shabbat.

### 6.3 Campaign cancel / close / pause

- `cancelCampaign` (`campaigns.ts:750-767`) via the `cancel_campaign` RPC only transitions `draft|pending_approval|approved` and only when **not** authorized/pending/hold_review and `charge_status is null` (RPC body, migration `20260630223635…:11-19`). An **active** campaign returns `'not_cancellable'`. So cancel is a pre-activation path; it does not touch `outreach_state` and cannot strand active jobs.
- `closeCampaign` / `pauseCampaign` (`campaigns.ts:734-740`, `:728-730`) flip `status` to `closed`/`paused`. `stepGate` reads live campaign status and returns `stopped` (`outreach-engine.ts:162`), so **the gate is the primary guard** — the running job self-terminates to `status='stopped'` (§5). No pg-boss call from the web.

### 6.4 Worker-side detection + replan (the primary guard)

1. **Arm sweep** (`handleArm`, every minute `worker/main.ts:258`): recompute `planRev` for each active contact's `current_step_index`; if `row.plan_rev !== planRev` → the queued job is stale. Enqueue via `enqueueStepJob` (new det id at the new slot). **Optional cleanup only**: `boss.cancel(QUEUES.step, oldDetId)` **[PROBE: `cancel` is an UPDATE; the cancelled row still conflicts on the PK, so it will not resurrect; skipping the cancel is safe because the old-plan job is neutralised by the pre-flight stale check + `claimStep`]**.
2. **Pre-flight** (`handleStep`): recompute `planRev`; on mismatch, re-enqueue the current step under the new `planRev` (deferred id if the new slot is future) and **return without sending** — the stale content never goes out.
3. **`claimStep`** remains the terminal backstop so even a missed detection cannot double-send.

`gate + planRev` is the primary guarantee; `boss.cancel` is optional latency reduction. This honours "NO web→pg-boss direct calls": the web only writes DB rows; the worker converges within one arm cycle.

---

## 7. The paused-poll is NOT a plan point (unchanged)

`worker/main.ts:72-75` re-queues an **id-less** fresh job with `startAfter: 300` when the *global* `outreach_enabled` switch is off (gate `paused`, `outreach-engine.ts:159`). This is a global-gate poll, not per-contact timing; it must stay id-less and retry-less so it cannot dedupe-collide with the real det job. **Leave it as-is.** It is categorically distinct from the plan/defer mechanism above and carries no `planRev`.

---

## 8. TEST PLAN

Existing suites to extend: `send-window.test.ts` (16 tests), `schedule.test.ts`, `send-policy.test.ts`, `jewish-calendar.test.ts`, plus new `enqueue.test.ts` and an isolated pg-boss integration harness (pattern: the probe script in scratchpad — a disposable schema `pgboss_test`, `DROP SCHEMA … CASCADE` in teardown, never touch real `pgboss`).

### 8.1 The 12 acceptance cases → tests

Cases 1–6 are the owner list in `docs/whatsapp-send-timing-implementation-plan-2026-07-07.md:47-59`; 7–12 are the hardening additions this blueprint introduces.

| # | Acceptance case | Kind | Test asserts | Anchor exercised |
|---|---|---|---|---|
| 1 | Event at 23:00 → reminder lands on the correct business day/hour, not next-day 09:00 | unit | `plannedSendTime` uses event **calendar date − N days** at preferred time, independent of the 23:00 time-of-day | `send-window.ts:54-62` |
| 2 | A reminder deferred from Shabbat is never sent before a legal window opens | unit | `resolveSendSlot` with `plannedMs` inside a candle→havdalah interval returns `at ≥ havdalah + motzashPlusMin` and inside a weekday window | `send-window.ts:140-144`; `jewish-calendar.ts:88-96` |
| 3 | 1,000 recipients deferred to one morning do NOT share a `startAfter` | unit | distinct `spreadKey` per `(campaign,contact,step)` ⇒ spread across `[t, usableEnd)`; bounded to window/expiry | `send-window.ts:111-121,168-177` |
| 4 | Double run → no duplicate message | unit+integration | two `executeStep` on same step: second `claimStep` returns `false`; two `enqueueStepJob` on same `planRev`: second `boss.send` → `null` | `outreach-engine.ts:180-197`; **[PROBE conflict→null]** |
| 5 | Guest who answered / was removed after scheduling but before execution → not sent | unit | gate `reached` (`isContactReached`) and `removal_requested`/consent skip terminalize (§5) and never call `sendOneWhatsApp` | `outreach-engine.ts:174,283-286` |
| 6 | Event-date change → future jobs explicitly re-planned | unit+integration | changing `event_date` changes `planRev` ⇒ new det id, new slot; stale job detected in arm + pre-flight | §1.2, §6.1 |
| 7 | Policy narrowing (e.g. Fri end 12:00→11:00) re-times queued jobs | integration | bump `send_policy_revision`; arm recomputes `planRev`; stale detected; new job at narrowed slot | §6.2 |
| 8 | `eventDayExclusiveEndMs` is next IL midnight, DST-correct; a slot at 23:59:30 is expired | unit | expiry = 00:00 next IL day; `resolveSendSlot` `t ≥ expiry` skips; verify across a DST boundary date | §4.1; `send-window.ts:132,174` |
| 9 | `now ≥ expiry` skips before building the calendar (no reverse range) | unit | guard returns skip/exhausted; `buildJewishCalendar` never called with `from > to` | §4.2 |
| 10 | Defer-from-active produces EXACTLY ONE successor under a race | integration (isolated pg-boss) | hold DET active via `boss.fetch`; two defers to same `targetSlotMs` → one derived row, one `null`; then original completes | **[PROBE defer/race: winnersCount=1, rowCount=1, complete affected:1]**; §3 |
| 11 | Skip/stop reasons persisted | unit | each branch writes the exact `status`/`stop_reason` in the §5 table; opt-out is terminal, not silent | §5; `outreach-engine.ts:199-216` |
| 12 | `planned_at` written only on real insert; `{error}` surfaced; write guarded on step+rev | unit | `boss.send`→`null` ⇒ no `recordPlan`; `recordPlan` returns `'stale'` when `current_step_index`/`plan_rev` moved; Supabase `{error}` throws | §1.4, §2.2 rules 4-7 |

### 8.2 Isolated pg-boss integration harness (cases 4, 6, 7, 10)

Mirror the probe methodology exactly:
- `new PgBoss({ …, schema: 'pgboss_test' })`; `boss.start()` creates the schema.
- Create `QUEUES.step`; drive `enqueueStepJob` / defer logic against a stub `outreach_state` (either a real temp table or an injected in-memory writer).
- Assert row counts in `pgboss_test.job` by `(name, id)` after: same-id resend (expect `null`, 1 row), derived-id defer race (expect 1 row), plan-rev change (expect a **new** id row).
- Teardown: `DROP SCHEMA pgboss_test CASCADE`; assert `pgboss` (real) untouched.

### 8.3 Verification gate (per CLAUDE.md "Definition of Done")

`npm run lint` · `npx tsc --noEmit` · `next build --webpack` **[MEMORY: build-webpack-not-found-fix]** · focused vitest (`send-window`, `schedule`, `enqueue`, integration) then full suite. After the migration: `supabase gen types typescript --linked` → diff `src/lib/supabase/types.ts` (do not hand-edit) → wire.

---

## 9. Change surface summary (for the implementing PR — not done here)

| File | Change |
|---|---|
| `supabase/migrations/<ts>_send_timing_plan_revision.sql` | new: `campaigns.plan_revision`, `app_settings.send_policy_revision`, `outreach_state.planned_step_index`+`plan_rev` |
| `src/lib/supabase/types.ts` | regenerated via `gen types` (never hand-edited) |
| `src/lib/outreach/schedule.ts` | `detId` gains `planRev`; add `planRev(inputs)` fingerprint helper |
| `src/lib/outreach/send-window.ts` | `eventDayEndMs` → `eventDayExclusiveEndMs` (exclusive next-midnight) |
| `src/lib/outreach/enqueue.ts` | new: `enqueueStepJob` + `EnqueueResult` + `deferId` |
| `src/lib/data/outreach-engine.ts` | `recordPlan` (guarded); terminalize opt-out/consent; reason mapping; replace `setPlannedAt` uses |
| `worker/main.ts` | arm/schedule-next/pre-flight route through `enqueueStepJob`; exclusive-end guard; stale detection; deferId |
| `src/lib/data/events.ts` (optional) | `updateEvent` event_date branch bumps `campaigns.plan_revision` (belt) |
| future admin policy action (P1b) | bumps `app_settings.send_policy_revision` |

## 10. Open questions / limitations

1. **Explicit counter vs pure fingerprint.** The fingerprint alone (§1.2) closes every observed gap with zero web→worker coupling; the two counters are belts for forced replans. If the team prefers no schema growth, ship `plan_rev`/`planned_step_index` on `outreach_state` only and drop the two counters (fold a policy hash instead of `send_policy_revision`).
2. **`outreach_state.next_run_at`** (DDL `:21`) is unused in code (grep: only in generated types). It could hold `planned_at`'s role, but `planned_at` is the documented anchor (`20260707120000…:44-45`); leaving `next_run_at` unused is intentional — do not repurpose without a separate decision.
3. **Retention vs re-fire** remains bounded by `claimStep` + terminal `status`, not by pg-boss row lifetime **[PROBE: a det id becomes re-insertable only after the row is physically deleted/archived; by then the cursor has advanced or the contact is terminal]**. No change needed, but the integration test in §8.2 should include a "delete then resend same id re-inserts" assertion to lock the invariant.

---

## 11. BINDING implementation conditions (v2 — owner-approved; OVERRIDE earlier text on conflict)

Approved: **fingerprint-primary**. These are implementation REQUIREMENTS, not options. Principle: **fingerprint = protection; deterministic UUIDs = idempotency; `claimStep` = final double-send defense.**

### 11.1 `planRev` = full correctness identity (supersedes §1.2 `sha1short`)
- A `SEND_TIMING_ALGORITHM_VERSION` constant (start `1`) lives in code; a future change to the timing ALGORITHM (even with identical event-date/schedule/policy) bumps it → new `planRev` → old jobs invalidated.
- `planRev = sha256hex( canonicalJSON({ v: SEND_TIMING_ALGORITHM_VERSION, eventDateIL, touchpoint, policy }) )` — **FULL SHA-256 (64 hex, ≥128-bit)**, never a 12-char tag.
- `policy` = the **parsed + normalized** `SendPolicy` (from `parseSendPolicy`), NOT raw DB JSON. `canonicalJSON` = a dedicated helper with **recursive key sort** + stable serialization; do NOT `JSON.stringify` raw DB JSON.
- `touchpoint = {days_before, channel, message_key}` (canonicalized). The full `planRev` is folded into the UUIDv5 material for `detId`/`deferId` AND carried verbatim in the payload (§11.2).

### 11.2 `planRev` carried in every `StepData` payload (never inferred from the job id)
- `StepData` gains `planRev: string` and `mode: 'plan' | 'defer' | 'replan'` (+ `planVersion` if kept separate). Payload stays IDs-only — `planRev/mode/version` are non-PII.
- **Pre-flight**: recompute `currentPlanRev` from LIVE ctx+policy for the job's `stepIndex`; compare to `data.planRev`. Mismatch ⇒ **stale**: do NOT send, do NOT defer under the old plan, do NOT touch `planned_at`; re-enqueue ONLY the current step under `currentPlanRev` (mode `'replan'`), then return.
- **Legacy jobs from the previous deploy with NO `planRev` in payload ⇒ fail-closed stale**: no send; at most ONE job under the current `planRev`; dedicated integration test.

### 11.3 No dormant counters (supersedes §1.3)
- Migration adds ONLY `outreach_state.planned_step_index int` + `outreach_state.plan_rev text` (`planned_at` already exists). **DROP** `campaigns.plan_revision` and `app_settings.send_policy_revision` — no dead schema; add them only when a real, atomic, tested writer exists.

### 11.4 `enqueueStepJob` mode is EXPLICIT (supersedes §2/§3 inference)
- `enqueueStepJob({ mode, … })`. `mode='plan'|'replan'` → `detId(c,ct,step,planRev)`. `mode='defer'` → `deferId(c,ct,step,planRev,targetSlotMs)`. The helper NEVER infers the id from the slot.
- Pre-flight defer passes explicit `mode:'defer'` + the computed `targetSlotMs (=pf.at)`. Every successor payload preserves the SAME `planRev`. A re-blocked successor gets a NEW deterministic `deferId` keyed on the NEW `targetSlotMs`.

### 11.5 `boss.send` ↔ `recordPlan` atomicity gap (NEW, mandatory)
- send OK but `recordPlan` FAILS → log a clear operational event (no PII) and return an outcome that is NOT full success. On the retry `boss.send`→`null` (job exists) must not leave a job with no anchor and no recovery.
- **Reconciliation**: when a job EXISTS **verified** for the SAME `(detId, planRev, start_after)` but `planned_at` is missing, recover it via compare-and-set. NEVER write `planned_at` on a blind `null`; only after verifying the existing job IS the current-identity job AND its `start_after` matches.
- Integration test: send OK + `recordPlan` fail + retry→`null` + reconciliation restores the correct `planned_at` OR reports a clear failure — no misleading anchor.

### 11.6 `recordPlan` is a real compare-and-set (supersedes §1.4)
- Guards ≥ campaign_id, contact_id, `status='active'`, `current_step_index=expectedStepIndex`, AND plan identity. Atomic SQL/RPC taking `(expectedStepIndex, expectedCurrentPlanRev, nextPlanRev, plannedAt)`.
- The `plan_rev` condition must NOT block replacing an OLD plan with a NEW one (match `expectedCurrentPlanRev`, set `nextPlanRev`). Result: `recorded | stale | missing | error`. `stale` is NOT a normal error and must NOT overwrite state.

### 11.7 pause is REVERSIBLE — do NOT terminalize (supersedes §5 pause row) — VERIFIED
- `activateCampaign` transitions `paused→active` (`campaigns.ts:717-726`); `listActiveCampaigns` arms only `status='active'` (`outreach-engine.ts:72-83`); `stepGate` currently lumps `status!=='active'` into `'stopped'` (`outreach-engine.ts:162`).
- Fix: `ctx.status==='paused'` ⇒ reversible ⇒ **re-queue-poll** (like the global `outreach_enabled`-off `'paused'` path: id-less, `startAfter:300`), KEEP `outreach_state` `active`. NEVER `'stopped'`.
- **Terminal ONLY**: closed, cancelled, opt-out (removal/consent), reached, expired, no_window_before_expiry, event-past, event-not-active. Split `stepGate`'s blanket `status!=='active'⇒stopped` into paused (reversible) vs closed/cancelled (terminal).

### 11.8 Everything else remains binding
migration→apply→`supabase gen types typescript --linked`→verify diff (NEVER hand-edit `types.ts`); `eventDayExclusiveEndMs`=next IL midnight; guard before `buildJewishCalendar`; `deferId` deterministic by `planRev`+`targetSlotMs`; uniform `STEP_RETRY` on every real job; `claimStep` = backstop only; the 300s paused-poll stays OUTSIDE `enqueueStepJob`; no web→pg-boss; **NO commit/deploy/PM2 restart.**
Added tests: legacy job missing `planRev`→stale/no-send/one-replan; policy JSON same content, different key order→SAME `planRev`; `SEND_TIMING_ALGORITHM_VERSION` change→new `planRev`/new job; send OK+`recordPlan` fail+retry→reconciliation; pause→resume per the verified semantics.

### 11.9 `enqueueStepJob` union MUST distinguish TERMINAL conflicts (refines §11.5) — PROBE-grounded
`boss.send(queue, data, {id})` returns `null` for **ANY** existing `(name,id)` row — created/scheduled/active/retry **AND completed/failed/cancelled** **[PROBE]**. So `null` ≠ "a valid future job exists". The `EnqueueResult` union MUST include, beyond `scheduled|deferred|skipped|stale`:
- `already_scheduled{jobId}` — the id maps to a **NON-terminal** job (created/scheduled/retry/active) = a real pending queue entry.
- `terminal_conflict{jobId,state}` — the id maps to a **completed/failed/cancelled** row: NOT a pending queue, NOT proof of a future send. Surface it; never treat it as `already_scheduled`.
- `reconciliation_failed{reason}` — the send↔`recordPlan` gap (§11.5) could not be safely reconciled.
Distinguishing them requires **querying `pgboss.job` state by `(name,id)`** — never inferring from `null` alone.
**Reconciliation of `planned_at` after `send→null` is ALLOWED ONLY after verifying ALL of:** the existing job is NON-terminal (state ∈ created/scheduled/active/retry) **AND** its payload identity matches `(campaignId, contactId, stepIndex, planRev)` **AND** its `start_after` equals the intended slot. Any check fails → `reconciliation_failed` (or re-plan), NEVER a blind `planned_at` write. **completed/failed/cancelled MUST NOT reconcile.**

### 11.10 pg-boss integration tests — STRICT isolation (refines §8.2)
- Each run creates a **UNIQUE** schema (e.g. `pgboss_test_<runToken>`), passed as the PgBoss `schema` — NEVER the real `pgboss`.
- `try/finally`: the `finally` MUST `DROP SCHEMA <unique> CASCADE` even on failure/throw.
- End-of-run assertion: **verify NO leftover `pgboss_test_%` schema remains**.
- ABSOLUTE PROHIBITION: tests never connect to / read / write the real `pgboss` schema.

### 11.11 Schema state — VERIFIED live before Implement (do NOT re-touch)
- History clean: `20260706154252` / `165113` / `20260707120000` / `130000` repaired→applied; `20260707140000_record_step_plan_invoker` applied via `db push`; `db push --dry-run` = *Remote database is up to date*.
- `record_step_plan` is **SECURITY INVOKER**, `search_path=''`, EXECUTE `{postgres,service_role}` only; `service_role` has `USAGE(public)`+`UPDATE`/`SELECT(outreach_state)`; a real service_role PostgREST rpc call returned `"missing"` (INVOKER verified end-to-end).
- Implement MUST NOT alter or re-run ANY applied migration. Further schema changes = a NEW migration + `db push` only (NEVER `db query`).
- Integration tests MUST include a real `createAdminClient().rpc('record_step_plan', …)` call with isolated data + cleanup (SECURITY INVOKER is not "verified" without it).

---

## 12. ARCHITECTURE DECISION GATE — cursor ⇄ schedule-next coherence (DESIGN-ONLY; STOP for approval)

**Status: design only. No code, no migration until an architecture is explicitly approved.** §12 supersedes the `handleStep` ordering described in §0/§2 and `worker/main.ts` — it is a structural fix, not a follow-up.

### 12.0 The invariant breach (VERIFIED against code)
| # | Fact | Anchor |
|---|---|---|
| 1 | `claimStep` advances the cursor **only** `stepIndex → stepIndex+1` (sequential, atomic, `WHERE current_step_index = stepIndex`) | `outreach-engine.ts:180-197` |
| 2 | `nextTouchpointIndex` can return `nextIdx > stepIndex+1` when intermediate touchpoints' times have passed (skips) | `schedule.ts:22-38` |
| 3 | `nextIdx > stepIndex+1` ⇒ schedule-next enqueues `nextIdx`, but the cursor only reaches `stepIndex+1` ⇒ the `nextIdx` job's `claimStep` **fails** until the arm walks intermediates late ⇒ **cursor ⇄ pg-boss divergence** | `worker/main.ts:114-137` |
| 4 | Even when `nextIdx = stepIndex+1`: `record_step_plan` requires `current_step_index = p_expected_step`, but schedule-next-FIRST runs **before** the cursor advances ⇒ recordPlan for the next step returns **`stale`**. MUST NOT be papered over by weakening the CAS | §11.6; `worker/main.ts:114` before `:143` |
| 5 | `nextTouchpointIndex` eligibility uses **`touchpointTime`** (event − N×24h, `schedule.ts:24-26`) while the slot uses **`plannedSendTime`** (calendar-days). Two time models — forbidden | `schedule.ts:40,63` vs `send-window.ts:54-62` |
| 6 | pre-flight defer `return`s **before** schedule-next (`worker/main.ts:109-112`) ⇒ downstream scheduling is serialized behind the defer; a defer past a later touchpoint's time needs an **explicit catch-up policy** — NOT blanket `expired` | `worker/main.ts:109-112` |

`expired` (event day passed) MUST be distinguished from `superseded_by_later_touchpoint` / `missed_touchpoint` / `no_window_before_next_touchpoint` (event still future).

### 12.1 Two coherent architectures — pick EXACTLY ONE (no mixing)

**Option A — full serial flow, cursor is the SINGLE source of truth (no multi-plan).**
- `outreach_state.current_step_index` is the only "next step" authority. **Never** enqueue a `stepIndex > cursor`. **No** schedule-next-FIRST.
- Step lifecycle: evaluate → (send | skip | terminal) → **atomic sequential advance (+1)** → enqueue the step the cursor now points at. recordPlan's `expected = cursor` therefore always matches (fact #4 dissolved).
- Defer always re-schedules the **same** step (same cursor). On wake, the **same evaluator** re-checks relevance; a superseded step is marked `skipped{reason}`, cursor advances +1, and the walk continues to the first schedulable step. **No i→j jump without recording every intermediate skip.**
- Resilience: the 1-minute arm sweep (`worker/main.ts:258`) re-enqueues the cursor step — this IS the self-heal that schedule-next-FIRST hand-rolled, so schedule-next-FIRST becomes redundant.
- Cost: ≤1-min latency between a step finishing and the next enqueue (next slot is hours/days away — irrelevant); the cursor is walked through superseded steps (each an explicit, audited skip).

**Option B — true parallel planning (keep schedule-next-FIRST / >1 logical job per contact).**
- A NEW application-owned table `outreach_step_plans(campaign_id, contact_id, step_index, plan_rev, job_id, mode, planned_at, state, created_at, updated_at)` with deterministic uniqueness on the logical plan identity. `outreach_state` stays cursor + execution state ONLY; existing `planned_at`/`planned_step_index`/`plan_rev` become **summary/cache**, not sole truth.
- `enqueueStepJob` / defer / reconciliation / terminal_conflict operate against the plan record, THEN `pgboss.job`. A stale job doesn't send because its plan is no longer current.
- Cost: a whole plan lifecycle + three-way sync (plan ⇄ cursor ⇄ pgboss.job) — new complexity + a new migration/table/RLS. Justified ONLY if concurrent/ahead-of-cursor scheduling is genuinely required.

### 12.2 RECOMMENDATION — Option A
The domain is a **strictly sequential, at-most-once, arm-swept** reminder chain (one campaign per event; touchpoints ordered by days_before). The cursor is already the natural single truth, and the 1-min arm sweep already provides the resilience schedule-next-FIRST was hand-rolling. **Option A eliminates the entire cursor⇄queue divergence class with the least machinery and dissolves all six facts directly.** Option B buys concurrency the product does not need and introduces a three-way sync that is itself a new source of the inconsistency we are removing. Choose B ONLY if a hard requirement to schedule ahead of the cursor emerges.

### 12.3 Cross-cutting requirements (BOTH options)
1. **Single evaluator** replaces `nextTouchpointIndex`/`touchpointTime`. Every eligibility+timing decision flows through ONE function using: IL-normalized event date, `plannedSendTime`, `eventDayExclusiveEndMs`, parsed+normalized policy, the Jewish calendar, `now`, and an explicit missed/superseded policy.
2. **Explicit skip reasons** — never `expired` for a passed-but-future-event touchpoint. Use `superseded_by_later_touchpoint` / `missed_touchpoint` / `no_window_before_next_touchpoint` per the chosen policy.
3. **pause/resume (binding):** a paused job may NOT make the cursor/plan terminal; after resume there is NO stuck `terminal_conflict`, NO double-send, and a legal continuation or replan exists.
4. **terminal_conflict:** completed/failed/cancelled are NOT `already_scheduled` and NOT permission to resend. Classify against the app source-of-truth (cursor / execution state / plan identity, per option). An invariant breach emits a **deduplicated operational signal** — never a random-UUID resend, never a blind resend.
5. **pg-boss access:** NO PostgREST against `pgboss.job`. Use a **verified worker-only adapter** over pg-boss's existing direct connection (or its authenticated API).
6. **Mandatory §12 tests:** (a) `[7d,3d,1d]`, step 0 wakes 2 days pre-event → no no-op job for step 2, no silent late "3-day" send without an explicit policy; (b) `nextIdx=stepIndex+1` → no silent `recordPlan` stale, no misleading `planned_at`; (c) defer past a later touchpoint's time → proven catch-up policy, no reversed order, no dup; (d) DST → eligibility & slot from the SAME model; (e) pause→resume → no stuck terminal, no double-send; (f) stale/replan → at most one valid job per plan identity; (g) terminal_conflict → not `already_scheduled`, no blind resend.

### 12.4 Disposition of the halted partial code (decided AFTER approval)
v2 partially wrote `schedule.ts`/`send-window.ts`/`enqueue.ts` (05:08-09) on the pre-§12 architecture; inert (uncommitted, unbuilt, undeployed). Under A: `enqueue.ts` + schedule-next paths are rewritten around the cursor-first flow. Under B: kept + extended with the plan ledger. Reconciled at implementation time, not now.

### 12.5 Gate
After the architecture is explicitly approved: NEW migration if needed → `db push` → `gen types` to a temp file → verify diff → THEN implementation. No touching already-applied migrations. No commit/deploy/PM2/destructive live-DB tests.

---

## 12.6 DESIGN ADDENDUM — claim ⇄ advance separation (Option A APPROVED; DESIGN-ONLY; STOP for approval)

**The defect in the current `claimStep`:** it does `current_step_index = stepIndex + 1` — advancing the cursor **before** the send (`outreach-engine.ts:188-192`, called at `:292` before the send at `:296+`). Consequence: a provider failure **after** the claim leaves the step consumed with **no retry** → the nudge is lost. Option A must SEPARATE the two concerns.

### 12.6.1 Two distinct variables (linearization)
| Variable | Meaning | Advances when |
|---|---|---|
| `current_step_index` (i) — **the linearization variable** | the next UNRESOLVED step | ONLY on a durable FINAL outcome of step i (sent / skipped / terminal) |
| `dispatched_step_index` (NEW) + `dispatched_at` (NEW) | step i is RESERVED for an in-flight send attempt | set by the reserve-CAS; cleared on definite failure; consumed on advance |

Verified: outreach_state today has NEITHER a dispatch/claim marker nor any field separating "attempting i" from "cursor at i" → **a minimal new field is REQUIRED** (this is the §12.5 migration trigger). Skip-reason audit reuses the existing per-step path (`recordTemplateFailure`-style) — no new audit schema.

### 12.6.2 Per-job protocol (job for cursor i, planRev)
```
1. ARRIVE (det-id job for i, planRev)
2. GATE: paused→re-poll (cursor stays i); closed/cancelled→terminal; reached→terminal
3. EVALUATE (single evaluator: plannedSendTime + policy + calendar + now + missed/superseded policy)
   • defer      → re-enqueue SAME i (deferId, planRev); cursor stays i; NO reserve, NO advance; return
   • superseded → audit skip{superseded_by_later_touchpoint}; ADVANCE i→i+1 (CAS); enqueue i+1; return
     /missed       (walk ONE step at a time; never i→j jump)
   • expired    → terminal exhausted{expired} (event day passed); return
   • send        → step 4
4. RESERVE (claim) — atomic CAS:
     UPDATE … SET dispatched_step_index=i, dispatched_at=now
      WHERE status='active' AND current_step_index=i AND dispatched_step_index IS DISTINCT FROM i
     0 rows → concurrent duplicate / stale → skip; return    ← blocks CONCURRENT double-send
5. SEND WhatsApp (external, non-idempotent)
6. COMMIT:
   • DEFINITE SUCCESS (providerId returned):
        ADVANCE CAS: SET current_step_index=i+1, whatsapp_sent_count++, dispatched_step_index=i
                     WHERE current_step_index=i AND dispatched_step_index=i
        enqueue i+1 (det-id, planRev)                          ← cursor advances = FINAL outcome
   • DEFINITE FAILURE (provider error → KNOWN not delivered):
        RELEASE: SET dispatched_step_index=NULL WHERE current_step_index=i AND dispatched_step_index=i
        cursor stays i; STEP_RETRY / arm re-drives i → re-reserve + re-send   ← RETRY, no loss, no dup
   • UNKNOWN / CRASH (die between 5 and 6, ambiguous timeout):
        reservation dispatched_step_index=i persists, cursor=i (NOT advanced)
        recovery job sees current=i AND dispatched=i → AT-MOST-ONCE policy:
          advance i→i+1 WITHOUT re-sending; audit skip{dispatch_outcome_unknown}  ← never re-send
7. enqueue i+1 ONLY after a successful advance; if enqueue dies after advance → arm re-enqueues i+1 (det-id dedups)
```

### 12.6.3 State diagram + where each state lives
```
             ┌─ defer ───────────────► pending(i)         [pg-boss: re-queued deferId; DB cursor=i]
pending(i) ──┼─ superseded/missed ───► skipped ──advance──► pending(i+1)   [DB: cursor i→i+1 + audit]
             ├─ expired/closed/reached► terminal           [DB: status/stop_reason]
             └─ send ──reserve(CAS)──► claimed(i)          [DB: dispatched_step_index=i, cursor=i]
claimed(i) ──┬─ provider success ────► sent ──advance────► pending(i+1)    [DB: cursor i→i+1, sent_count++]
             ├─ provider fail (known)─► pending(i)         [DB: dispatched=NULL, cursor=i] → RETRY
             └─ crash/unknown ────────► claimed(i) ─recover► pending(i+1)  [at-most-once: advance, no resend]
```
- **Cursor (`current_step_index`)** = the single linearization point; the ONLY authority for "next step"; advances exactly once per resolved step.
- **Reservation (`dispatched_step_index`/`dispatched_at`)** = the execution claim; exists only between reserve and commit; never authorizes "next step".
- **`status`/`stop_reason`** = terminal outcomes. **Audit (recordTemplateFailure-style)** = per-step skip reasons.

### 12.6.4 The four required proofs
1. **Provider fails after claim:** DEFINITE failure → release reservation, cursor stays i → retriable. (No consumed-and-lost step, unlike current claimStep.)
2. **Retry still possible:** STEP_RETRY on the job + the 1-min arm both re-drive cursor i after a released reservation → re-reserve + re-send.
3. **No send lost:** definite-failure case retries until delivery or expiry. The ONLY loss window is crash-mid-send-with-unknown-outcome (rare) — and it is covered by the multi-touchpoint schedule (a later touchpoint reminds the same contact). Bounded + self-covered, stated honestly.
4. **No double-send:** the reserve-CAS (step 4) serialises concurrent duplicates to one winner; the advance-CAS (step 6) is idempotent (only the reserving attempt advances); the crash-unknown branch NEVER re-sends (it advances). Under every interleaving, at most one send. ✓

**Honest tradeoff (non-idempotent external send, no provider idempotency key):** exactly-once is impossible; this design gives **retry-on-definite-failure + no-double-ever + at-most-once only in the rare crash-unknown window (schedule-covered).** That is the strongest correct guarantee available.

### 12.6.5 Minimal schema + atomic ops (the §12.5 migration, IF approved)
- NEW migration: `alter table public.outreach_state add column dispatched_step_index integer, add column dispatched_at timestamptz;` (nullable; no backfill — idle = NULL).
- Atomic reserve + advance + release as guarded `UPDATE … RETURNING` (or a small `SECURITY INVOKER` RPC alongside `record_step_plan`, service_role-only, per §11.11 conventions). recordPlan's `expected = cursor` now always matches because enqueue-of-next happens AFTER advance (fact #4 dissolved).
- Skip-reason audit: reuse the existing per-step audit path — no new table.

### 12.6.6 Gate
STOP here for explicit approval of §12.6. On approval: `migration new` (dispatched_step_index/at + reserve/advance RPC) → `db push` → `gen types` to temp → verify diff → THEN implement Option A (single evaluator, cursor-first flow, claim⇄advance, explicit skip reasons, pause/resume-safe, worker-only pgboss.job adapter) + the §12.3 mandatory tests. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

## 12.7 §12.6 REVISED (per the 6 binding conditions — SUPERSEDES §12.6.1–12.6.5)

### 12.7.1 Reservation = THREE job-scoped fields
| Field (NEW, nullable) | Meaning |
|---|---|
| `dispatched_step_index int` | step reserved for an in-flight attempt |
| `dispatched_at timestamptz` | reservation timestamp — **audit only; NEVER a recovery trigger** |
| `dispatched_job_id uuid` | the pg-boss job that OWNS the reservation |
- **reserve** requires `dispatched_step_index IS NULL AND dispatched_job_id IS NULL`.
- **advance / release** clear ALL THREE.
- reserve / advance / release / recovery are guarded by `dispatched_job_id = p_job_id`. **No recovery by timestamp alone. The arm/sweeper MUST NOT clear a reservation whose job is still active** — only the owning job (same `dispatched_job_id`) or an authoritative terminal-conflict signal for that exact job may resolve it.

### 12.7.2 Certainty taxonomy (replaces "provider error = definite failure")
The send boundary classifies each attempt into exactly one:
- `accepted(providerId)` — provider returned a message id.
- `definitely_not_sent(reason)` — provider **synchronously rejected before queueing** (4xx validation: invalid recipient/template, closed window). KNOWN not delivered.
- `unknown(reason)` — **timeout, network failure, 5xx, or crash after reserve.** Outcome uncertain.
**Only `definitely_not_sent` releases the reservation and permits retry. `unknown` NEVER resends.**

### 12.7.3 Retry identity — CHOSEN **Option A** (bounded pg-boss retry → per-step terminalize)
[PROBE: a terminal `detId` returns null → the same step id cannot be re-enqueued once its job is terminal.]
- **A (chosen):** `definitely_not_sent` → release + throw → pg-boss retries the SAME job (STEP_RETRY) to `retryLimit`. On the FINAL attempt still `definitely_not_sent` → **advance-skip**: audit `skip{provider_failure}`, cursor `i→i+1`, enqueue `i+1`. Contact NOT terminalized; the next touchpoint self-covers. Matches the corrected promise ("retry on definite failure", **bounded — not until-expiry**). No `attempt_generation`.
- **B (NOT chosen; would need schema):** `attempt_generation int default 0` folded into `detId` (planRev+generation); `definitely_not_sent` increments generation via atomic CAS → a NEW `detId` re-drives step i until expiry; arm/enqueue schedule only the current generation; advance resets it; no random UUID. Adopt B ONLY if per-touchpoint retry-until-expiry becomes a hard requirement.

### 12.7.4 Per-job protocol (job J for cursor i, planRev)
```
1 ARRIVE  det-id job J for i, planRev (jobId=J)
2 GATE    paused→re-poll(i); closed/cancelled→terminal; reached→terminal
3 EVALUATE (single evaluator: plannedSendTime+policy+calendar+now+missed/superseded policy)
   defer      → re-enqueue SAME i (deferId, planRev); cursor i; NO reserve/advance; return
   superseded → audit skip{superseded_by_later_touchpoint}; advance i→i+1 (CAS); enqueue i+1; return
   /missed
   expired    → terminal exhausted{expired}; return
   send       → 4
4 RESERVE   CAS SET dispatched_step_index=i, dispatched_at=now, dispatched_job_id=J
            WHERE status='active' AND current_step_index=i
              AND dispatched_step_index IS NULL AND dispatched_job_id IS NULL
            0 rows → already reserved/concurrent/stale → skip; return
5 SEND      classify → accepted | definitely_not_sent | unknown
6 COMMIT (all guarded WHERE current_step_index=i AND dispatched_job_id=J)
   accepted           → ADVANCE i→i+1, whatsapp_sent_count++, dispatched_*=NULL ; enqueue i+1
   definitely_not_sent→ RELEASE dispatched_*=NULL ; throw → pg-boss retries J
                        · final attempt → advance-skip{provider_failure}, i→i+1, enqueue i+1
   unknown            → LEAVE reservation (job_id=J); NO advance, NO resend, NO timer-release
                        · recovery only by J itself → at-most-once: audit skip{dispatch_outcome_unknown},
                          advance i→i+1 WITHOUT resend
7 enqueue i+1 only after a successful advance; enqueue dies after advance → arm re-enqueues i+1 (det-id dedups)
```

### 12.7.5 replan LOCK while reserved
`recordPlan` and any replan MUST additionally guard `dispatched_job_id IS NULL`. While a reservation is held, `plan_rev` / `planned_at` are FROZEN — reserve is the linearization point of the in-flight send. A policy/event change after reserve applies to the **next** step only.

### 12.7.6 Corrected promise (replaces "no send lost")
NOT "no send lost". The guarantee is: **retry on definite failure** (bounded by retryLimit, then advance-skip); **no resend on `unknown`**; **at-most-once in the ambiguity window**; **explicit `dispatch_outcome_unknown` audit**. Exactly-once is impossible for a non-idempotent WhatsApp send.

### 12.7.7 Skip audit → `activity_log` (NOT `recordTemplateFailure`, NOT `logActivity`)
VERIFIED: `recordTemplateFailure` (`outreach.ts:123`) writes `outreach_template_failures`, reason ∈ {template_missing, channel_mismatch, params_incomplete}, keyed (campaign, touchpoint) with **no contact** → would MISLABEL a schedule skip → UNFIT. `logActivity` (`activity.ts:35`) calls `requireUser()` + the cookie client → unusable from the worker. Use a **direct admin insert** (precedent `interactions.ts:216`): `createAdminClient().from('activity_log').insert({ event_id, user_id: null, action: 'outreach.step_skipped', meta: { campaign_id, contact_id, step_index, reason } })`. `event_id`/`user_id` are nullable. **No new audit table.**

### 12.7.8 Minimal schema (the §12.5 migration, IF approved) — Option A
`alter table public.outreach_state add column dispatched_step_index integer, add column dispatched_at timestamptz, add column dispatched_job_id uuid;` (all nullable; no backfill; no `attempt_generation`). reserve/advance/release as an atomic `SECURITY INVOKER` RPC (service_role-only, per §11.11) or guarded `UPDATE … RETURNING`; `record_step_plan` gains the `dispatched_job_id IS NULL` guard (new migration replacing it forward, never editing the applied one).

### 12.7.9 Gate
STOP for explicit approval of §12.7. Then: `migration new` → `db push` → `gen types` to temp → diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

## 12.8 §12 FINAL DESIGN (per the 6 further conditions; SUPERSEDES §12.7 where they differ)

### 12.8.1 DB-level reservation integrity — CHECK constraint
```sql
alter table public.outreach_state add constraint outreach_state_reservation_ck check (
  (dispatched_step_index is null and dispatched_at is null and dispatched_job_id is null)
  or
  (dispatched_step_index is not null and dispatched_at is not null and dispatched_job_id is not null
   and dispatched_step_index = current_step_index)
);
```
All-or-none, and a live reservation MUST match the cursor. Every op (reserve/release/resolve) preserves it. (`dispatched_provider_id` — see §12.8.5 — is NOT in the all-or-none group; it is a nullable sub-field of the reserved state.)

### 12.8.2 Anchor + reservation cleared on EVERY resolve (atomic)
On any final resolution of step i (accepted-advance / superseded / missed / provider_failure / dispatch_outcome_unknown / expired), the SAME atomic op sets: `planned_at=NULL, planned_step_index=NULL, plan_rev=NULL, dispatched_step_index=NULL, dispatched_at=NULL, dispatched_job_id=NULL` (and advances or terminalizes). So step i's anchor never lingers after the cursor moves. The next enqueue for the new cursor writes a fresh anchor via `record_step_plan` with `expected_plan_rev = NULL`. `record_step_plan` stays blocked while `dispatched_job_id` is not null.

### 12.8.3 `unknown` recovery — job-owned, never timer-based
- send=`unknown` while the worker is alive → NO resend; immediately `resolve_outreach_step{dispatch_outcome_unknown}` guarded by `dispatched_job_id=J`.
- If that resolve fails / the worker crashes → pg-boss re-runs the SAME job J. J sees `dispatched_job_id=J` → does NOT call the provider again → performs ONLY unknown-recovery (audit + advance-skip).
- A DIFFERENT job sees `dispatched_job_id ≠ its own` → does NOT release, does NOT send → returns `stale` / emits a deduplicated invariant-breach signal.
- **No timer release; no recovery keyed on `dispatched_at`** (audit only).

### 12.8.4 Retry semantics — EMPIRICALLY PROVEN (isolated schema, dropped; real `pgboss` untouched)
| Observation | Result |
|---|---|
| `retryLimit:3` total attempts | **4** (`retry_count` 0,1,2,3) |
| `retry_count` on the job object handed to the handler | **ABSENT** (keys: id,name,data,expireInSeconds,heartbeatSeconds,groupId,groupTier,signal) |
| all-throw outcome | `state='failed'` + moved to **dead-letter** |
| resend same id during `'retry'` | **null (blocked)** — the arm cannot duplicate a retrying step |
| complete (no throw) on the last attempt | `state='completed'`, **NOT** dead-lettered |

**DESIGN (chosen, robust):** a `definitely_not_sent` handler always `release + throw` → pg-boss retries. After exhaustion pg-boss moves the job to **`QUEUES.dead`**, whose handler carries the original `StepData` and performs `resolve_outreach_step{provider_failure}` (advance-skip + clear + audit). This makes the **dead-letter queue the single exhaustion→terminalize authority** and needs NO in-handler `retry_count` read. The arm's `terminal_conflict` detection (§11.9) is a redundant belt (a `failed`/terminal det-id at the cursor ⇒ advance-skip). After terminalize the cursor has advanced, so there is no stuck terminal_conflict.

### 12.8.5 Certainty taxonomy — REAL boundary change + accepted-commit-failure decision
`client.ts` currently `catch {}` → generic error (verified). Change the send boundary to return/throw, PII-free:
```ts
type DeliveryOutcome =
  | { kind: 'accepted'; providerId: string }
  | { kind: 'definitely_not_sent'; reason: string; providerStatus?: number; providerCode?: string }
  | { kind: 'unknown'; reason: string; providerStatus?: number; providerCode?: string };
```
- NOT all 4xx → `definitely_not_sent`: only a **verified mapping** of provider error codes (invalid recipient/template, closed window). `timeout | network | 5xx | error-without-code` → `unknown`.
- **Accepted-then-DB-commit-failure (product decision):** if `accepted(providerId)` then the advance/commit fails or the process crashes before commit, the recovery run classifies it **`unknown` by default** → advance WITHOUT resend. **Explicit cost: a possible UNDER-count of `whatsapp_sent_count`, never a resend / double-charge.** (Upgrade path, NOT in v1: persist `dispatched_provider_id` into the reservation between accept and commit so recovery resolves `accepted` exactly — trades one nullable field for exact counts.)

### 12.8.6 Atomic RPCs (all SECURITY INVOKER, service_role-only; §11.11)
| RPC | Guards | Effect | Returns |
|---|---|---|---|
| `record_step_plan(camp,contact,exp_step,exp_plan_rev,next_plan_rev,planned_at)` | status='active' ∧ current_step_index=exp_step ∧ plan_rev ⇔ exp_plan_rev ∧ **dispatched_job_id IS NULL** | set anchor | recorded\|stale\|missing |
| `reserve_outreach_step(camp,contact,step,plan_rev,job_id)` | status='active' ∧ current_step_index=step ∧ plan_rev=plan_rev ∧ dispatched_* all NULL | set dispatched_{step,at=now,job_id} | reserved\|stale |
| `release_outreach_reservation(camp,contact,step,job_id)` | current_step_index=step ∧ dispatched_job_id=job_id | clear dispatched_* only | released\|stale |
| `resolve_outreach_step(camp,contact,step,job_id_or_null,outcome,reason,event_id,audit_id)` | current_step_index=step ∧ (send-path ⇒ dispatched_job_id=job_id; non-reserved skip ⇒ dispatched_job_id IS NULL) | ONE txn: idempotent `insert into activity_log(id=audit_id,…) on conflict do nothing` **+** advance i→i+1 (or terminal status) **+** clear anchor+reservation | resolved\|stale |

`audit_id = uuidv5(APP_NS, "${camp}:${contact}:${step}:${plan_rev}:${reason}")` → activity_log PK makes the audit idempotent (double-invoke ⇒ one row). No new audit table.

### 12.8.7 FINAL state diagram
```
                 ┌─ defer ────────────────────────► pending(i)                 [deferId; cursor=i; no reserve]
                 ├─ superseded/missed ─ resolve{skip} ─► pending(i+1)          [advance + clear anchor + audit]
 pending(i) ─────┤─ expired ─ resolve{terminal} ──────► terminal
                 └─ send ─ reserve(i,J) ──────────────► reserved(i,J)          [dispatched_{i,now,J}; CHECK ok]

 reserved(i,J) ─┬─ accepted(providerId) ─ resolve{advance} ─► pending(i+1)     [cursor++, sent++, clear all]
                ├─ definitely_not_sent ─────────────────────► definite_failure
                └─ unknown ─────────────────────────────────► unknown

 definite_failure ─┬─ not last ─ release ─ throw ─► pending(i)                 [pg-boss retries J]
                   └─ exhausted ─► DEAD-LETTER ─ resolve{provider_failure} ─► pending(i+1)   [terminalize-after-exhaustion]

 unknown ─ (no release, no resend) ─ resolve{dispatch_outcome_unknown}[guard job_id=J] ─► pending(i+1)
         └─ crash → J re-runs (owns reservation) → recovery only; foreign job → stale/invariant-breach(dedup)
```

### 12.8.8 Plan-anchor LIFECYCLE
1. enqueue cursor i → `record_step_plan(exp_step=i, exp_plan_rev=NULL, next=planRev_i)` → anchor{planned_step_index=i, plan_rev=planRev_i, planned_at}.
2. reserve i → dispatched_*={i,now,J}; `record_step_plan` now BLOCKED.
3. resolve i (any outcome) → advance/terminal **+ clear anchor + clear reservation** (atomic).
4. enqueue cursor i+1 → `record_step_plan(exp_step=i+1, exp_plan_rev=NULL, next=planRev_{i+1})` → fresh anchor.
Invariant: the anchor always describes the CURRENT cursor's queued job; never lingers past a resolve.

### 12.8.9 The four flows
- **known failure (non-final):** reserve → send=`definitely_not_sent` → `release_outreach_reservation` → throw → pg-boss retries J → re-reserve+re-send.
- **final failure:** retries exhausted → job → `QUEUES.dead` → dead-letter handler `resolve_outreach_step{provider_failure}` → advance+clear+audit.
- **unknown recovery:** reserve → send=`unknown` → NO release/resend → `resolve_outreach_step{dispatch_outcome_unknown}` guard job_id=J; crash → only J recovers; foreign job → stale.
- **accepted DB-commit failure:** reserve → send=`accepted` → `resolve{advance}` fails/crash → recovery classifies `unknown` → advance, NO resend (cost: possible `whatsapp_sent_count` under-count).

### 12.8.10 New tests (add to §12.3)
- CHECK rejects a partial reservation and `dispatched_step_index ≠ current_step_index`.
- every resolve clears the anchor (no lingering `planned_*` after advance); `record_step_plan` blocked while reserved.
- unknown: no resend; J-owned recovery advances once; a foreign job → stale, no send/no release.
- retry (isolated pg-boss): non-final `definitely_not_sent` → retry; exhaustion → dead-letter → `resolve{provider_failure}` advances; resend-same-id-during-retry → null.
- DeliveryOutcome: 5xx/timeout/network/no-code → `unknown` (no resend); mapped 4xx → `definitely_not_sent` (release+retry).
- accepted→commit-fail → `unknown` → advance, no resend (under-count acknowledged).
- `resolve_outreach_step` idempotent: double-invoke with the same `audit_id` → ONE activity_log row + ONE advance.

### 12.8.11 Migration + gate
NEW migration (Option A): `outreach_state` + `dispatched_step_index int`, `dispatched_at timestamptz`, `dispatched_job_id uuid` + the §12.8.1 CHECK; the four RPCs of §12.8.6 (`record_step_plan` re-created FORWARD with the new `dispatched_job_id IS NULL` guard — never editing an applied migration). No `attempt_generation`, no `dispatched_provider_id` in v1. STOP for explicit approval → `migration new` → `db push` → `gen types` to temp → diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

## 12.9 §12 FINAL DESIGN v2 (per 7 further conditions; SUPERSEDES §12.8 where they differ)

### 12.9.1 Plan-anchor CHECK (in addition to the reservation CHECK)
```sql
alter table public.outreach_state add constraint outreach_state_anchor_ck check (
  (planned_at is null and planned_step_index is null and plan_rev is null)
  or
  (planned_at is not null and planned_step_index is not null and plan_rev is not null
   and planned_step_index = current_step_index)
);
```
No partial anchor and no anchor for a non-cursor step can persist. **Pre-migration:** verify 0 rows violate (clear partial anchors first — 0 such rows observed 2026-07-07; re-verify at migration time).

### 12.9.2 `expected_plan_rev` on EVERY open/release/resolve
reserve / release / resolve ALL additionally guard `plan_rev = p_expected_plan_rev`. **planRev mismatch → `stale`: never advance, never clear, never write a new-plan audit.** Closes: an old J / old dead-letter arriving while the cursor is coincidentally still at the same step but the plan changed must NOT advance the new plan's cursor.

### 12.9.3 Final definite failure — PRIMARY path = `retry_count = retry_limit` (dead-letter is fallback)
PROVEN (probe): `pgboss.job.retry_count` is readable; the last attempt ⇔ `retry_count = retry_limit`. Worker-only adapter:
```
getJobRetryMeta(jobId, queueName) -> { state, retryCount, retryLimit }
  = SELECT state, retry_count, retry_limit FROM <activeSchema>.job WHERE id=$1 AND name=$2
  via the worker's OWN direct pg connection (session pooler). NOT PostgREST / NOT the Supabase client.
```
On `definitely_not_sent`, read retry meta:
- `retry_count < retry_limit` → `release_outreach_reservation` + **throw** → pg-boss re-runs the SAME J.
- `retry_count = retry_limit` → `resolve_outreach_step{provider_failure}` (advance-skip + clear) + **return normally (no throw)**.
Independent of dead-letter semantics; prevents the arm seeing `failed` before a dead handler advances.

### 12.9.4 Dead-letter fallback — provenance PROVEN + `sourceJobId`
PROVEN (probe): the dead handler receives the ORIGINAL `StepData` intact; the dead-letter job's own `id` DIFFERS from the source.
- `StepData` carries `sourceJobId` = the detId used at enqueue. The NORMAL handler asserts `job.id === data.sourceJobId`. The DEAD handler uses `data.sourceJobId` (NEVER the dead job id).
- Dead fallback classifies by LIVE state (guarded by `expected_plan_rev` + cursor):
  - `dispatched_job_id = sourceJobId` → **unknown recovery**.
  - `dispatched_* NULL` ∧ same planRev/cursor → **provider_failure** fallback (advance-skip).
  - planRev / cursor mismatch → **stale**, NO advance.
Dead-letter is used ONLY for crash / unexpected exceptions (the retry_count path is primary).

### 12.9.5 resolve failure after accepted/unknown → THROW, never release
If `resolve_outreach_step` fails after `accepted` or `unknown`: do NOT return success, do NOT release; **throw** → pg-boss re-runs the SAME J. Next run: `dispatched_job_id=J` → NO resend → unknown-recovery only; recovery fails again → retry policy → dead-letter fallback (provenance-proven).

### 12.9.6 pause/resume — durable via a RUN REVISION (id-less poll alone is insufficient)
PROBLEM: the deterministic J can reach `completed` during pause; after resume the arm cannot recreate the same detId (terminal → null). SOLUTION — real writers, folded into planRev:
- `campaigns.outreach_run_revision int not null default 0` — atomically incremented on EVERY transition returning the campaign to `active` (incl. `paused→active`, inside `activateCampaign`).
- `app_settings.outreach_run_revision int not null default 0` — incremented on global `outreach_enabled` false→true.
- BOTH folded into `planRev` (§11.1). **Not dormant** — concrete writer (resume/enable), business meaning, tests.
Acceptance: pause → J completes / poll runs → resume → **new run revision → new planRev → new detId → old J stale → exactly one current job → no stuck terminal_conflict → no double send.**

### 12.9.7 Extended tests (add to §12.3 / §12.8.10)
DB rejects a partial plan anchor; DB rejects a plan anchor for a non-cursor step; dead-letter StepData+sourceJobId provenance; an old-planRev dead-letter cannot advance a new planRev; final definite failure detected via `retry_count=retry_limit` advances in the SAME J without dead-letter; accepted/unknown + resolve-failure → throw → same-J recovery → no resend; campaign pause→resume → new run revision/planRev/detId; global pause→resume (if the global switch is a repeatable pause); an old terminal job cannot create a stuck terminal_conflict.

### 12.9.8 Migrations required
- **M1** `<ts>_send_timing_serial_flow.sql`: `outreach_state` + `dispatched_step_index/at/job_id`; the reservation CHECK (§12.8.1) + the plan-anchor CHECK (§12.9.1); RPCs `reserve_outreach_step` / `release_outreach_reservation` / `resolve_outreach_step` (all with `expected_plan_rev` guards); `record_step_plan` re-created FORWARD (+ `dispatched_job_id IS NULL` guard).
- **M2** `<ts>_outreach_run_revision.sql`: `campaigns.outreach_run_revision` + `app_settings.outreach_run_revision`.
(May be a single migration; listed as two for clarity. Pre-migration: verify no `outreach_state` row violates the new anchor CHECK.)
STOP for explicit approval → `migration new` → `db push` → `gen types` to temp → verify diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

## 12.10 §12 FINAL DESIGN v3 (per 5 further conditions; SUPERSEDES §12.9 where they differ)

### 12.10.1 FULL anchor guard on EVERY open/release/resolve (plan_rev alone is insufficient)
reserve / release / resolve ALL additionally guard `planned_step_index = step AND planned_at IS NOT NULL AND plan_rev = p_expected_plan_rev`:
- **reserve:** `status='active' AND current_step_index=step AND planned_step_index=step AND planned_at IS NOT NULL AND plan_rev=exp AND dispatched_step_index IS NULL AND dispatched_at IS NULL AND dispatched_job_id IS NULL`.
- **release:** `current_step_index=step AND planned_step_index=step AND plan_rev=exp AND dispatched_job_id=job_id`.
- **resolve:** `current_step_index=step AND planned_step_index=step AND plan_rev=exp AND (send-path ⇒ dispatched_job_id=job_id ; skip ⇒ dispatched_* NULL)`.
Any mismatch → `stale`. Never advance / clear / audit under a non-matching plan.

### 12.10.2 `sourceJobId` = the ACTUAL enqueued id, per mode (not a fixed detId)
Each enqueue sets `StepData.sourceJobId` to the deterministic id actually submitted:
- `mode='plan'|'replan'` → `sourceJobId = detId(camp,contact,step,planRev)`.
- `mode='defer'` → `sourceJobId = deferId(camp,contact,step,planRev,targetSlotMs)`.
Normal handler asserts `job.id === data.sourceJobId`. Dead handler uses `data.sourceJobId` (the dead job's own id differs). Test: a defer job → reserve stores under `deferId` → unknown recovery succeeds ONLY under the same `deferId`.

### 12.10.3 Dead-letter provenance — RE-PROVEN (two isolated runs)
The dead handler receives the ORIGINAL `StepData` intact: `{campaignId, contactId, stepIndex, planRev, sourceJobId}`; the dead-letter job's OWN id differs (run1 `68d3…`, run2 `637a…`) → the source is identified via `data.sourceJobId`, never via the (different) dead job id or a missing payload. Dead-letter fallback is grounded — used ONLY for crash/unexpected; the `retry_count` path (§12.9.3) is primary.

### 12.10.4 run_revision writers — MAPPED (campaigns only; app_settings DEFERRED)
- **`campaigns.outreach_run_revision`:** SOLE writer = `activateCampaign` (VERIFIED the only code path to `status='active'`). supabase-js `.update()` cannot do `col+1`, so the bump MUST be an atomic RPC / raw UPDATE — `activate_campaign` performs, in ONE statement: `UPDATE campaigns SET status='active', outreach_run_revision = outreach_run_revision + 1 WHERE id=$1 AND status IN ('approved','scheduled','paused') AND capture_status='authorized'` (plus the L1/R9 pre-checks currently in `transitionCampaignStatus`). `pauseCampaign` / `closeCampaign` / cancel → NO increment. `getCampaignContext` MUST select `outreach_run_revision`; `planRev` folds it.
- **`app_settings.outreach_run_revision`:** **NO code writer exists** — `outreach_enabled` has a getter only, no setter (the global switch is a manual/ops toggle). Per "no counter without a writer" it is **NOT added in v1**. Global-manual pause→resume durability is a DOCUMENTED gap needing a future `setOutreachEnabled` writer that toggles + increments in one transaction. Per-campaign pause/resume (the common case) IS solved.

### 12.10.5 `getJobRetryMeta` adapter — worker-only, guarded, schema-as-identifier
```
getJobRetryMeta({ schema, queueName, jobId }) -> { state, retryCount, retryLimit } | null
  SELECT state, retry_count, retry_limit FROM <schema>.job WHERE name = $1 AND id = $2   -- $1=queueName, $2=jobId
```
- The worker's OWN direct pg connection (session pooler). **NOT PostgREST, NOT `createAdminClient`.**
- `schema` is a Postgres IDENTIFIER — never a bind parameter, never raw-interpolated: it comes from a known worker constant (`'pgboss'`) OR passes hard validation (`^[a-z_][a-z0-9_]*$` / `quote_ident` / allowlist) before interpolation. `queueName` + `jobId` are bind params.

### 12.10.6 Migrations required (revised)
- **M1** `<ts>_send_timing_serial_flow.sql`: `outreach_state` + `dispatched_{step_index,at,job_id}`; reservation CHECK + plan-anchor CHECK; RPCs `reserve_outreach_step` / `release_outreach_reservation` / `resolve_outreach_step` (with the FULL anchor guards of §12.10.1) + `record_step_plan` re-created forward.
- **M2** `<ts>_campaign_outreach_run_revision.sql`: `campaigns.outreach_run_revision int not null default 0` + the `activate_campaign` atomic RPC (bump on →active). **NO `app_settings.outreach_run_revision`** (no writer).
STOP for explicit approval → `migration new` → `db push` → `gen types` to temp → verify diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

## 12.11 §12 FINAL DESIGN v4 (owner chose Option B — global writer; SUPERSEDES §12.9.4/§12.10.3/§12.10.4 where they differ)

### 12.11.1 Global writer — M3 + `set_outreach_enabled` (SOLE writer of `outreach_enabled`)
M3 `<ts>_global_outreach_run_revision.sql`: `app_settings.outreach_run_revision int not null default 0` + `check (outreach_run_revision >= 0)` + RPC `set_outreach_enabled(p_enabled boolean)`, atomic on `app_settings.id=true`:
```sql
update public.app_settings
   set outreach_enabled = p_enabled,
       outreach_run_revision = outreach_run_revision
         + (case when p_enabled and not outreach_enabled then 1 else 0 end)
 where id = true;
```
- `false→true` → enable + `outreach_run_revision++`. `true→false` → disable, NO increment. `true→true`/`false→false` → NO increment.
- **No application code may write `outreach_enabled` directly** — every writer goes through `set_outreach_enabled` (service_role-only, server-side admin action).
- `planRev` folds BOTH `campaigns.outreach_run_revision` AND `app_settings.outreach_run_revision`.
- Acceptance: global false → J completes / poll runs → true → new global revision → new planRev → new detId → old J stale → exactly one current job → no duplicate send.

### 12.11.2 Resume/replan = CAS old→new planRev (NOT expect NULL)
After a campaign or global resume, a stale anchor may persist: `{planned_step_index=i, plan_rev=oldPlanRev, planned_at=oldSlot}`. The new enqueue MUST NOT call `record_step_plan(expected_plan_rev=NULL,…)`; it must **replan-CAS**:
```
record_step_plan(expected_step=i, expected_plan_rev=<current stored plan_rev>, next_plan_rev=newPlanRev, planned_at=newSlot)
```
`expected_plan_rev` = the plan_rev CURRENTLY stored for step i (read first): NULL only when a prior resolve cleared the anchor; `oldPlanRev` when replanning a still-anchored step. Only after success (or verified reconciliation of a NEW non-terminal job): anchor → newPlanRev; the old job (oldPlanRev) is stale BEFORE reserve; **no blind clear of the old anchor; no overwrite if state changed.**
send→recordPlan gap on the replan path: `boss.send` ok but `record_step_plan` fails → reconcile ONLY against a non-terminal job whose queue + `sourceJobId` + payload identity + planRev + `start_after` all match; else a deduplicated invariant-breach signal — **never a blind write, never a resend.**

### 12.11.3 Dead-letter WITHOUT a reservation is NOT `provider_failure` (CORRECTS §12.9.4/§12.10.3)
A job can reach dead-letter BEFORE reserve, AFTER release, or from an internal fault → **no proof the provider rejected a message.** So the earlier "`dispatched_* NULL ∧ same planRev/cursor → provider_failure → advance`" is **WRONG and removed.** Dead handler (uses `data.sourceJobId`; permanent test: `deadJob.id !== data.sourceJobId` ∧ StepData preserved), classify by LIVE state (full anchor + cursor guard):
- `dispatched_job_id = sourceJobId` → **unknown recovery only** (no resend).
- `dispatched_* NULL` → **NO advance, NO `provider_failure`.** Emit idempotent `outreach.dead_unreserved` (IDs only, no PII, UUIDv5 audit id). **Cursor unchanged.**
`provider_failure` advance happens ONLY on the PRIMARY `retry_count = retry_limit` path (§12.9.3) where the reservation IS held. A dead-letter without a reservation → operator recovery, never an automatic new send (a send may or may not have happened).
Operator recovery for `dead_unreserved`: pause→activate (bumps campaign run revision) OR an explicit `rearm_campaign` RPC that bumps `campaigns.outreach_run_revision` **only after verifying no active reservation**.
Acceptance: job → dead-letter before reserve → cursor does NOT advance → no additional send → exactly one signal → rearm/activate mints a new planRev+detId and allows legal continuation.

### 12.11.4 Full writers map
| Writer (RPC) | Column | When | Guard |
|---|---|---|---|
| `activate_campaign` (activateCampaign) | `campaigns.outreach_run_revision +1` | →active (approved/scheduled/paused→active) | status IN(...) ∧ capture_status='authorized' ∧ L1/R9 |
| `set_outreach_enabled` (setOutreachEnabled) | `app_settings.outreach_run_revision +1` | global false→true ONLY | id=true ∧ was-false |
| `rearm_campaign` (rearmCampaign) | `campaigns.outreach_run_revision +1` | explicit operator recovery (e.g. after `dead_unreserved`) | **no active reservation** for any contact |
| — direct `outreach_enabled` write | — | **FORBIDDEN** | only via `set_outreach_enabled` |
`planRev` = sha256(canonicalJson({v:ALGORITHM_VERSION, eventDateIL, touchpoint, normalizedPolicy, campaignRunRev, globalRunRev})).

### 12.11.5 Final migrations
- **M1** `<ts>_send_timing_serial_flow.sql`: `outreach_state` dispatched_{step_index,at,job_id}; reservation CHECK + plan-anchor CHECK; RPCs reserve/release/resolve (full anchor guards) + record_step_plan forward.
- **M2** `<ts>_campaign_outreach_run_revision.sql`: `campaigns.outreach_run_revision` + `activate_campaign` RPC (+ `rearm_campaign` RPC).
- **M3** `<ts>_global_outreach_run_revision.sql`: `app_settings.outreach_run_revision` + `check(>=0)` + `set_outreach_enabled` RPC.
STOP for explicit approval → `migration new` → `db push` → `gen types` to temp → verify diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.

---

# 12 FINAL — M1 MINIMAL (AUTHORITATIVE; owner-approved; SUPERSEDES the exploratory §12.6–§12.11)

**REMOVED (redundant given the id-less pause-poll):** M2/M3, `campaigns`/`app_settings.outreach_run_revision`, `activate_campaign` bump, `set_outreach_enabled`, `rearm_campaign`/`rearm_contact`, dead-letter business recovery. `outreach_enabled` stays an **emergency stop** — NO new global-resume semantics in v1.

**KEPT:** dispatched reservation, 2 CHECKs, `record_step_plan` forward, `reserve`/`release`/`resolve` RPCs, DeliveryOutcome, worker-only `getJobRetryMeta`, Option A cursor-first, single evaluator, intent-first scheduling, `expected_plan_rev` guards, idempotent audit.

### F.1 TWO execution identities — detId + deferId (CORRECTION: do NOT unify)
Keep both deterministic ids; the worker verifies `job.id` BY MODE:
- `mode='plan' | 'replan'` → `detId(campaignId, contactId, stepIndex, planRev)`.
- `mode='defer'` → `deferId(campaignId, contactId, stepIndex, planRev, targetSlotMs)`.
No `planned_job_id` column, no stored/trusted `sourceJobId` — the id is RECOMPUTED per mode from the anchor and checked against `job.id`; mismatch → stale.
**Why two:** the id-less pause-poll cannot recreate the ORIGINAL `detId` after resume — that job may already be `completed`, so `boss.send(detId)` returns null (blocked). On resume `ensureCurrentStep` enqueues in **`mode='defer'` (deferId)** — a DIFFERENT formula, hence a fresh identity — EVEN when the same `planRev` and `targetSlot` are preserved. This sidesteps the terminal-`detId` collision **without** run_revision, without random UUID, and without reusing a terminal id. Every `targetSlot` is normalized to integer milliseconds BEFORE the UUID and BEFORE any write/compare to `planned_at`.

### F.2 Reservation = TWO fields (dispatched_step_index dropped — the reserved step is always the cursor)
`dispatched_job_id uuid` (nullable) + `dispatched_at timestamptz` (nullable).

### F.3 CHECK constraints
```sql
-- reservation all-or-none
check ((dispatched_job_id is null and dispatched_at is null)
    or (dispatched_job_id is not null and dispatched_at is not null))
-- plan anchor all-or-none + anchor is the cursor
check ((planned_at is null and planned_step_index is null and plan_rev is null)
    or (planned_at is not null and planned_step_index is not null and plan_rev is not null
        and planned_step_index = current_step_index))
```

### F.4 RPCs (SECURITY INVOKER, service_role-only; audit id = uuidv5(camp:contact:step:plan_rev:reason))
| RPC | Guards | Effect | Returns |
|---|---|---|---|
| `record_step_plan(camp,contact,exp_step,exp_plan_rev,exp_planned_at,next_plan_rev,next_planned_at)` | active ∧ current_step_index=exp_step ∧ plan_rev IS NOT DISTINCT FROM exp_plan_rev ∧ **planned_at IS NOT DISTINCT FROM exp_planned_at** ∧ **dispatched_job_id IS NULL** | set anchor (planned_step_index=exp_step, plan_rev=next_plan_rev, planned_at=next_planned_at). initial: exp_plan_rev=NULL, exp_planned_at=NULL. defer/replan: exp_*=anchor values. **`planned_at` in the CAS (not just planRev)** — a defer/re-eval can change targetSlot under the SAME planRev; without `exp_planned_at` an old same-planRev job could overwrite a newer slot. | recorded\|stale\|missing |
| `reserve_outreach_step(camp,contact,step,exp_plan_rev,exp_planned_at,job_id)` | active ∧ current_step_index=step ∧ planned_step_index=step ∧ plan_rev=exp_plan_rev ∧ planned_at=exp_planned_at ∧ dispatched_job_id IS NULL | dispatched_job_id=job_id, dispatched_at=now | reserved\|stale |
| `release_outreach_reservation(camp,contact,step,exp_plan_rev,job_id)` | current_step_index=step ∧ planned_step_index=step ∧ plan_rev=exp_plan_rev ∧ dispatched_job_id=job_id | clear dispatched_* | released\|stale |
| `resolve_outreach_step(camp,contact,step,exp_plan_rev,job_id_or_null,outcome,reason,event_id,audit_id)` | current_step_index=step ∧ planned_step_index=step ∧ plan_rev=exp_plan_rev ∧ (send ⇒ dispatched_job_id=job_id ; skip ⇒ dispatched_* NULL) | ONE txn: idempotent activity_log(id=audit_id) + advance i→i+1 / terminal + clear anchor+reservation | resolved\|stale |

### F.5 DeliveryOutcome + retry (unchanged from §12.7.2 / §12.9.3)
`accepted(providerId) | definitely_not_sent(reason,status?,code?) | unknown(reason,…)`. Only `definitely_not_sent` releases+retries; `unknown` never resends. On `definitely_not_sent`, `getJobRetryMeta(J)`: `retry_count<retry_limit` → release+throw; `retry_count=retry_limit` → `resolve{provider_failure}` + return (no throw).
`getJobRetryMeta({schema,queueName,jobId}) → {state,retryCount,retryLimit}|null` — worker's OWN direct pg conn; `schema` = validated identifier / const; `name`+`id` bind params.

### F.6 pause-poll → ensureCurrentStep (resume enqueues via deferId)
The id-less pause poll is **NOT an execution job**: it does NOT reserve and does NOT send. Final pause flow:
```
execution detId J → gate=paused → pause-poll (id-less, no reserve/send) → J completes
poll after resume → evaluator → record_step_plan CAS → enqueue deferId(...) → defer job → reserve → send
```
On resume `ensureCurrentStep` enqueues in **`mode='defer'` (deferId)** — a fresh identity that sidesteps the terminal original `detId` — with no run revision, no random UUID, no reuse of a terminal id. (The normal arm enqueues in `mode='plan'` = `detId`; only the resume path uses `deferId` to route around the completed original.)

### F.9 Two added acceptance tests
1. `detId` J completes during pause → poll returns when the campaign is active → exactly ONE `deferId` is created → NO attempt to send the old `detId` → the message is sent AT MOST once.
2. Two concurrent defer/replan with the SAME `planRev` but a DIFFERENT `targetSlot` → only the one holding the current `expected_planned_at` wins the `record_step_plan` CAS → the older returns `stale` and does NOT replace the anchor.

### F.7 dead-letter (telemetry + continuity only; NO business recovery)
Recompute the execution identity from `data`/anchor; classify by LIVE state:
- `dispatched_job_id = the dead job's execution id` → **fail-closed + telemetry only** (a send may have occurred — no advance, no resend).
- `dispatched_* NULL` ∧ anchor (planned_step_index, plan_rev, planned_at) + cursor still match → `resolve skip{internal_fault}` + audit + advance.
- any mismatch → **stale**, no advance.
`internal_fault` provides chain CONTINUITY without a blind resend — it is NOT a delivery guarantee for that touchpoint.

### F.8 The ONE migration
`<ts>_send_timing_serial_flow.sql`: `outreach_state` + `dispatched_job_id uuid`, `dispatched_at timestamptz`; the 2 CHECKs (F.3); RPCs `record_step_plan` (forward) / `reserve_outreach_step` / `release_outreach_reservation` / `resolve_outreach_step` (F.4). (outreach_state is EMPTY → zero data risk.) STOP for final approval → `migration new` → `db push` → `gen types` to temp → verify diff → implement. No hand-editing generated artifacts; no commit/deploy/PM2; no destructive live-DB tests.
