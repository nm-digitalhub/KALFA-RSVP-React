# Runbook — Event Lifecycle State Model: S4 Verification (CLOSE-OUT)

Plan: `plans/event-lifecycle-state-model-plan.md`, Phase S4 / Task S4.1.
Spec: `plans/event-lifecycle-state-model-spec.md`.
Predecessor: `supabase/runbooks/event_lifecycle_s0_preflight.md` (S0 sign-off, 2026-07-01).
Run: **2026-07-05**, against the linked **live** Supabase project, at repo HEAD `345142e`
(the same SHA deployed to kalfa-beta + kalfa-worker earlier the same day).
Method: read-only queries + behavioral tests wrapped in `DO` blocks ending in
`RAISE EXCEPTION` (guaranteed rollback — **zero rows persisted**).

Status: **S4 COMPLETE — the event-lifecycle state-model workstream is CLOSED.**

---

## 1. Zero-residual preflight (re-run of the S0 V-queries, verbatim)

| bucket | rows | gate | result |
|---|---|---|---|
| V1a (draft + stale date) | 0 | informational | ✅ |
| **V1b** (active + null date) | **0** | must be empty | ✅ |
| **V1c** (draft deadline fails combined predicate) | **0** | must be empty | ✅ |
| **V3** (operational campaign on non-active event) | **0** | must be empty | ✅ |
| **V4a** (closed event + blocking campaign) | **0** | must be empty | ✅ |
| V4b (active + past date + blocking campaign) | 1 | permanent optional queue | ✅ allowed — `03733daf` (owner's call) |
| V5 (one-per-event, app convention) | 1 | permanent informational | ✅ allowed — `00000000…e1` |

S2.5 resolution paths, confirmed live: `ec7c68d1`'s V1c was fixed in S0 §4 (deadline
nulled); its V3 was resolved via the **publish path** — the event is now `active`
(`event_date=2026-09-10`), so campaign `bac77347` (`approved`) no longer sits on a
non-active event. Round-3 precision satisfied: all four blocking buckets are
**genuinely empty**, not "decided/deferred".

## 2. Live object verification (pg_catalog)

- Triggers on `events`: `events_before_insert` (INVOKER — no cross-table read),
  `events_guard_update` (**SECURITY DEFINER** ✅ B1), `trg_events_updated` (pre-existing).
- Triggers on `campaigns`: `campaigns_guard_cancel` (**SECURITY DEFINER** ✅ round-2),
  `campaigns_require_active_event` (**SECURITY DEFINER**), `trg_campaigns_updated`.
- L0a's old event-date triggers: **gone** (superseded by S1, fail-safe order held).
- `cancel_campaign`: **SECURITY DEFINER**, `anon ✗ / authenticated ✗ / service_role ✓`.
- `events_guard_update` / `campaigns_guard_cancel` / `campaigns_require_active_event`:
  anon+authenticated EXECUTE revoked (`fc69e19`).
- Cosmetic observation (no action): `events_before_insert` still shows anon/auth
  EXECUTE — inert, a `returns trigger` function cannot be invoked directly.

## 3. Behavioral tests against the LIVE triggers (all rolled back)

| # | action | expected | observed |
|---|---|---|---|
| T0 | insert `event_date` = yesterday | reject | ✅ `23514 event_date must be at least tomorrow (Asia/Jerusalem)` — `events_before_insert` |
| T1 | insert `rsvp_deadline` = yesterday | reject (R2b) | ✅ `23514 rsvp_deadline must be today or later (Asia/Jerusalem)` |
| T2 | insert `rsvp_deadline` = **today** | accept (R2b is `>= today`, not tomorrow) | ✅ accepted |
| T3 | insert deadline **after** event day | reject (CHECK regression) | ✅ `events_rsvp_deadline_within_event` |
| T4 | insert deadline with `event_date IS NULL` | reject (CHECK regression) | ✅ `events_rsvp_deadline_within_event` |
| T5 | insert deadline **= event day** | accept | ✅ accepted |
| T6 | draft edit: deadline → yesterday | reject (R2b draft-edit branch) | ✅ `events_guard_update` |
| T6b | publish (`draft→active`) with deadline = today | accept (publish re-check passes) | ✅ accepted |
| T7 | **unrelated rename** on live `active` event with PAST `event_date` (`03733daf`) | accept (write-time-only, not a row invariant) | ✅ accepted |

The CHECK `events_rsvp_deadline_within_event` is confirmed **untouched and authoritative**
for its two bounds (round-2 design); R2b's trigger covers only the lower bound.

## 4. Gate results

- `npm run lint` — clean · `npx tsc --noEmit` — clean · `npx vitest run` — **841/841** (74 files).
- `next build` — proven by the production deploy of this exact SHA (2026-07-05 12:33,
  fresh BUILD_ID, smoke HTTP 200, clean worker restart).
- Required S4 test coverage present in the suite: `event_date ≥ tomorrow` (create+update,
  `'ממחר'` messages), `FormData.has()` presence-mapping + forged non-draft date-key
  rejection (`actions.test.ts`), not-owned `cancelCampaign` → RPC never called
  (`campaigns.test.ts`, `.not.toHaveBeenCalled()`).
- `supabase db advisors --linked` — **0 ERROR-level findings**; none of the five
  lifecycle functions appear in any finding (185 pre-existing WARNs are unrelated:
  `set_updated_at` / `pgboss.*` search_path noise).

## 5. Deviations from the S4.1 checklist (recorded honestly)

1. **Isolated-PG16 harness not re-run** — the harness SQL lived in a session-scoped
   scratchpad (gone). Substituted with §3: rollback-wrapped behavioral tests against
   the REAL live objects — same assertions, stronger evidence than a replica.
2. **Authed browser smoke not run** — requires an authenticated owner session in a
   real browser. The same behaviors are covered by unit tests (forged date-key PATCH
   rejected; not-owned cancel → RPC never called) and §3's live trigger proofs.
   Recommended as a follow-up during normal product QA; NOT a DB-integrity gap.

## 6. Close-out

- SHAs: S0 `942ee30` · S1 `af56953` + `fc69e19` · S2 `e89b3e7` · S3 `30a9205` +
  cancel UI in `campaign-actions.ts` · verification HEAD `345142e`.
- **All R1–R9 + R2b rules are live and enforced at all three layers** (DB triggers/CHECK,
  app data-layer + Zod, RPC guards), with the app deployed at the verified SHA.
- Remaining live residuals, by design: **V4b** — event `03733daf` (active, past date,
  1 blocking campaign) stays on the permanent optional cleanup queue, owner's call;
  **V5** — seed event `00000000…e1` (6 campaigns) stays informational, never remediated.
- **S4 sign-off: COMPLETE. Workstream closed.**
