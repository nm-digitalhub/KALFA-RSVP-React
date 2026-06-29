# KALFA §10 Outreach Engine — Full Implementation Spec (C1)

## Context7 verification (read, not memory)
Library: **`/timgit/pg-boss`** via Context7 `query-docs`. pg-boss version (package.json): **`^12.21.2`**.

query-docs queries run:
1. "scheduling jobs with sendAfter / delayed jobs and cron schedules"
2. "retry, retryLimit, retryDelay, retryBackoff config and dead letter queues"
3. "singleton / throttling / debounce keys to dedupe jobs singletonKey"
4. "work() handler, fetch, batchSize, concurrency, and running a worker process long-lived"
5. "boss.start() lifecycle, constructor connectionString schema options, connecting to an existing Postgres, stop graceful shutdown, error event"
(+ earlier scoping: v12 createQueue/policies, send-options, queue-policies.)

Concrete facts taken from those snippets (load-bearing below):
- **`new PgBoss({...})`** (`docs/api/constructor.md`): `connectionString`, `schema` (default `"pgboss"`), `max` (default 10), `application_name`, `ssl`, and `supervise`/`schedule`/`migrate`/`createSchema` all **default `true`**. `start()` auto-creates/migrates the schema under an advisory lock (`docs/api/ops.md`).
- **`send(name,data,options)`** (`docs/api/jobs.md`): `startAfter (int|string|Date)`, `id (uuid)`, `retryLimit` (def 2), `retryDelay`, `retryBackoff`, `retryDelayMax`, `expireInSeconds` (def 15m), `deleteAfterSeconds` (def 7d). `send` "can resolve to **null** for unique jobs" (`ON CONFLICT (name,id) DO NOTHING`); README: **"exactly-once job delivery."** Convenience `sendAfter(name,data,options,value)`.
- **`createQueue(name,{policy,deadLetter,retryLimit,...})`** (`docs/api/queues.md`): policies `standard|short|singleton|stately|exclusive|key_strict_fifo`; v12 requires queues to exist before send/work. `singletonKey` is documented on the *throttling* path ("one job per key **within the time slot**") → I deliberately don't rely on it.
- **`work(name,options,handler)`** (`docs/api/workers.md`): `batchSize`, `localConcurrency`, `pollingIntervalSeconds` (def 2); handler gets an **array** of jobs + `job.signal` AbortSignal; needs a long-lived process. Plus **`schedule(name,cron,data,{tz,key})`**, **`findJobs(name,{data|key,queued})`**, **`cancel(name,id|[ids])`**/`deleteJob`, **`stop({graceful,close,timeout})`**.

---

## 0. Two facts that shape the design (verified vs live DB)
1. **Cadence = the event-date-anchored `outreach_schedule`, NOT the `_0011` attempt-policy.** Migration `_0014` **dropped** every `_0011` column (`whatsapp_attempts`, `escalation_delay_seconds`, `call_attempts`, …) and replaced them with `campaigns.outreach_schedule jsonb`. Live value (package → campaign at creation): `[{whatsapp,10,invite},{whatsapp,6,reminder_1},{whatsapp,3,reminder_2},{call,2,call_1},{whatsapp,1,final}]`. Each element = a touchpoint at `event_date − days_before·24h`. "Reminders" and "escalate to AI-call" are just `whatsapp`/`call` touchpoints; admin tunes policy by editing the schedule, never code.
2. **The B2/B3 config layer reads columns/tables not on live yet** (all coded fail-closed) → **prerequisites**: `app_settings.outreach_enabled` + `.whatsapp_*`; `public.message_templates`; `contacts.whatsapp_consent_at`. The engine is inert until these land.

---

## 1. Worker architecture (pm2)
`work()` needs a **long-lived process**; Next route handlers/Server Actions are short-lived + multi-instance and must **never** call `work()`. → a **second pm2 process `kalfa-worker`** beside `kalfa-beta` (`next start :3002`).
- **`server-only`/`@/` resolution:** every data module begins `import 'server-only'` (throws outside Next's `react-server` condition) and uses `@/`. **Bundle the worker** with esbuild → one `dist/worker.cjs`: resolve `@/*` from tsconfig paths + **alias `server-only` → empty module**. Scripts: `worker:build` (`esbuild worker/main.ts --bundle --platform=node --format=cjs --target=node24 --alias:server-only=./worker/empty.js --tsconfig=tsconfig.json --outfile=dist/worker.cjs`), `worker:start` (`node dist/worker.cjs`). Dev-dep `esbuild`. *(Fallback `node --conditions=react-server`: works but flips resolution for every dep; not recommended.)*
- **Request-free core:** no cookies/`requireUser`/`requireOwnedEvent`. Reused logic takes `createAdminClient()` + ids, scoping by loading the campaign/event row. Refactor `sendCampaignWhatsApp`'s body into `sendOneWhatsApp(admin, campaign, contact, template, config)`; add `getActiveCampaignForOutreach`/`listAuthorizedContacts`/`isContactEligible`.
- **Connection (verified):** node-postgres string in **SESSION mode** — **not** Supabase `:6543` transaction pooler (breaks session state/advisory locks). New server-only secret **`SUPABASE_DB_URL`** (session pooler `…pooler.supabase.com:5432` IPv4, or direct `:5432` IPv6 if the host supports it). **SSL required.** Boot: `new PgBoss({ connectionString, schema:'pgboss', max:4, application_name:'kalfa-worker', ssl:{rejectUnauthorized:false} })` → `start()` → `createQueue` (idempotent) → `work()`/`schedule()`. SIGTERM → `stop({graceful:true,timeout:30000})`; `boss.on('error',…)`. DB role needs `CREATE` on schema `pgboss`.
- **Web stays pg-boss-free (recommended):** Next tier holds no boss client; only mutates DB rows. Worker owns all `send`/`work`/`schedule`/`cancel`. Trigger = DB state change found by the `outreach-arm` cron (60s; days-scale outreach → latency irrelevant). *(Variant: `globalThis`-guarded send-only boss in web with `supervise:false,schedule:false`.)*
- **Gating (fail-closed, re-checked at execution):** global `getOutreachEnabled()` + `getWhatsAppConfig()` non-null; per-campaign `status='active'` AND `now ∈ [start_at?, close_at?)`. `activateCampaign` already requires `capture_status='authorized'`. **`campaigns.enabled` (def false) is vestigial** — recommend **drop** (or repurpose as kill-switch).
- **Interim `whatsapp-send` route:** keep as manual owner/admin "send now" through go-live (shares `sendOneWhatsApp`), then demote to admin-only; gate off active campaigns so it can't double-fire.

---

## 2. Per-contact state machine (§10)
**Chained, schedule-driven, schedule-next-first.** One pending `outreach-step` job per contact; step N's handler **schedules N+1 first**, then executes touchpoint N. Chosen over eager-enqueue: re-derives times from live `events.event_date` (robust to edits) and matches the §10 "state machine" framing; schedule-next-first gives eager's no-chain-break property.

Timing: `touchpointTime = event_date − days_before·86400s` (`event_date` is timestamptz). Past-due-at-activation (tunable, default `fire_first_now`): fire the first touchpoint now, drop intermediate past-due, follow the schedule for future-dated.

**`outreach-step` handler `{campaignId,contactId,eventId,stepIndex}`:**
1. **Gate:** `getOutreachEnabled()` false → re-enqueue self +5m, return (paused). Campaign `status≠'active'` or `now≥close_at` → state `stopped`, **terminal**.
2. **Reach short-circuit (the guarantee):** `SELECT 1 FROM billed_results WHERE event_id=$e AND contact_id=$c`. Present → state `reached`, **terminal**. `billed_results` is **UNIQUE(event_id,contact_id)** → reach is **event-scoped, cross-channel/cross-campaign**. This execution-time check (not job cancel) is the real stop-on-reach.
3. **Schedule-next-first:** next future touchpoint M>stepIndex → `send('outreach-step',{…,stepIndex:M},{ startAfter: touchpointTime(M), id: detId(c,M) })`. Before the send → a send failure never breaks the chain.
4. **Eligibility (`isContactEligible`, re-read each time):** not `removal_requested`; in `campaign_authorized_contacts` (frozen billing set `_0024` → `reached ⊆ authorized`); channel — `whatsapp` ⇒ `whatsapp_consent_at IS NOT NULL`; `call` ⇒ `'call'=ANY(allowed_channels)`. Ineligible → log skip + op_status, done.
5. **Claim (idempotency §2.3):** atomic compare-and-advance on `outreach_state.current_step_index`. Lost → done, no send.
6. **Execute:** `whatsapp` → `sendOneWhatsApp(...)` (`getTemplateByKey`, active + `channel='whatsapp'`); success → `contact_interactions` upsert (`onConflict:'channel,provider_id'`), `op_status='whatsapp_sent'`, count++. **Provider rejection** → log skip, **no throw**. `call` → `send('outreach-call-request',{campaignId,eventId,contactId,normalizedPhone,scriptKey:message_key,touchpointIndex})`; `op_status='pending_call'`. Chain doesn't wait for call outcome. **Infra error** → **throw** → pg-boss retry/backoff (guards keep it at-most-once; next step already scheduled).
7. No further touchpoint + send done → state `exhausted`.

**At-most-once is intentional** (a missed nudge beats double-messaging a guest; the multi-touchpoint schedule self-covers). Safety nets: `outreach-sweeper` cron (5m) re-arms overdue states (idempotent via deterministic id) + cancel-sweeps reached/closed; `outreach-dead` dead-letter.

### Job types
| Queue | Policy | Purpose | Retry |
|---|---|---|---|
| `outreach-arm` | standard (cron `* * * * *`) | seed `outreach_state` + enqueue first step for active campaigns | none |
| `outreach-step` | **standard** | execute touchpoint N, schedule N+1 | `retryLimit:3, retryBackoff:true, retryDelayMax:300`, `deadLetter:'outreach-dead'`, `deleteAfterSeconds:~14d` |
| `outreach-call-request` | standard | **C2's queue** (AI-call dispatch) | C2-owned |
| `outreach-sweeper` | standard (cron `*/5 * * * *`) | self-heal + cancel-sweep | none |
| `outreach-dead` | dead-letter sink | failed steps | — |

### 2.3 Idempotency — never double-send (no reliance on singleton semantics)
1. **Atomic compare-and-advance (guarantee):** `UPDATE outreach_state SET current_step_index=$n+1 WHERE campaign_id=$c AND contact_id=$k AND status='active' AND current_step_index=$n RETURNING id` — only the first delivery of step N matches; dup/retry → 0 rows → exit before send. Same optimistic-guard pattern as `campaigns.ts` (`lockCampaignForHold`).
2. **Deterministic `options.id`** = UUIDv5(`${campaignId}:${contactId}:${stepIndex}`) (~10-line `node:crypto` helper, no new dep) → `ON CONFLICT DO NOTHING` ("exactly-once") → each step enqueued ≤once; N≠N+1 so schedule-next-first never self-collides. `deleteAfterSeconds:~14d` so a completed early-step id isn't reaped mid-campaign.
3. `contact_interactions UNIQUE(channel,provider_id)` dedups send/webhook logging (existing).
*(`stately`+singletonKey demoted to optional defense-in-depth — sidesteps the singletonKey-without-singletonSeconds ambiguity.)*

---

## 3. Data model
**New `public.outreach_state`** (engine cursor + audit; `billed_results` stays billing source of truth; `contacts.op_status` stays §11 operational status):
```sql
create table public.outreach_state (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'active',          -- active|reached|stopped|exhausted|not_eligible
  current_step_index integer not null default 0,  -- compare-and-advance cursor
  whatsapp_sent_count integer not null default 0,
  call_request_count integer not null default 0,
  next_run_at timestamptz, reached_at timestamptz, reached_channel campaign_channel,
  stop_reason text,                               -- reached|closed|removal_requested|consent_revoked
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint outreach_state_campaign_contact_unique unique (campaign_id, contact_id)
);
create index outreach_state_campaign_status_idx on public.outreach_state (campaign_id, status);
-- RLS mirrors billed_results: owner SELECT via owns_event; admin ALL; server writes via service-role.
```

---

## 4. Wiring
- **WhatsApp:** `outreach-step` → `sendOneWhatsApp(admin,campaign,contact,template,config)` (refactored core; token/PII never logged).
- **Call channel (C2 interface, frozen):** payload `OutreachCallRequest{campaignId,eventId,contactId,normalizedPhone,scriptKey,touchpointIndex}`. C2 owns `work('outreach-call-request',…)`: dial via Voximplant; on **human reach** → `writeReach(admin,{eventId,contactId,channel:'call',evidence_source:'call_asr'|'call_dtmf',provider_ref})` (inserts `billed_results` + `op_status='human_interaction_call'` + `cancelOutreachForContact`) — **same reach path** as WhatsApp. Terminal no-reach → log `contact_interaction(billable:false)` + op_status, no bill, no chain touch. C1 provides shared `writeReach`/`cancelOutreachForContact`.
- **Stop-on-reached (both channels, one path):** WhatsApp via inbound webhook (B2, `classifyInbound` isolates billable human messages) on the Next route; call via C2 worker → `writeReach` inserts `billed_results` (UNIQUE → single reach) + sets `outreach_state.status='reached'`. Remaining jobs wake, hit step-2 reach check, no-op (guaranteed). Cleanup (worker): `findJobs('outreach-step',{data:{campaignId,contactId},queued:true})` → `cancel(...)`. Web stays pg-boss-free — cancellation is the worker's job; the execution-time check is the guarantee (`cancel` can't stop an already-active handler).

---

## 5. [מרחיב]/[יוצר] map · migrations · tests
**[יוצר] new:**
- `worker/main.ts` — boss boot, `createQueue`×5, `work('outreach-step')`, `work('outreach-sweeper')`, `schedule('outreach-arm','* * * * *')`, `schedule('outreach-sweeper','*/5 * * * *')`, SIGTERM `stop`, `on('error')`.
- `worker/empty.js` — `module.exports={}` (esbuild `server-only` alias target).
- `src/lib/queue/queues.ts` — queue names + per-queue config (pure).
- `src/lib/data/outreach-engine.ts` — `seedOutreachState`/`armCampaign`/`runOutreachStep`/`sweepOutreach`/`writeReach`/`cancelOutreachForContact`/`isContactEligible`/`listAuthorizedContacts`/`getActiveCampaignForOutreach` (admin-client, request-free).
- `src/lib/outreach/schedule.ts` — pure: `touchpointTime`, `nextTouchpointIndex`, `firstDueIndex`, `detId`.
- `supabase/migrations/2026XXXX_outreach_state.sql` — `outreach_state` + RLS + trigger; decide `campaigns.enabled` (rec. drop).

**[מרחיב] extend:**
- `src/lib/data/outreach.ts` — extract `sendOneWhatsApp`; `sendCampaignWhatsApp` becomes a thin loop (manual-route parity).
- `src/lib/data/campaigns.ts` — `activateCampaign` also seeds `outreach_state` for the authorized set (DB only).
- `src/lib/data/contacts.ts` — request-free `listAuthorizedContacts`/eligibility readers.
- `package.json` — `worker:build`/`worker:start`; `esbuild` dev-dep.
- `.env*` + deploy/pm2 docs — `SUPABASE_DB_URL`; register `kalfa-worker`; extend `deploy` (build worker + `pm2 restart kalfa-worker`).
- B2 inbound route (when built) — call `writeReach`/`cancelOutreachForContact`.

**Prerequisite migrations (B2/B3, must precede go-live):** `app_settings` outreach/whatsapp cols; `message_templates` (+ `channel='call'` scripts); `contacts.whatsapp_consent_at`.

**Tests:**
- Pure (`schedule.test.ts`): `touchpointTime` vs timestamptz; `nextTouchpointIndex`/`firstDueIndex` incl. all-past-due; `detId` stable+unique.
- Engine (mocked admin via `createMockSupabase`): fail-closed when disabled; reach short-circuit terminal; closed/after-close no-send; ineligible (no consent/removal/not-authorized) skip+advance; `call` touchpoint with `call∉allowed_channels` skip+advance; **compare-and-advance** → duplicate delivery sends exactly once; provider-rejection advances (no throw); infra-error throws and retry doesn't re-send.
- Reach: `writeReach` idempotent under `billed_results` unique; `cancelOutreachForContact` idempotent.
- Regression: existing `outreach.test.ts` passes after the `sendOneWhatsApp` extraction.
- pg-boss integration (CI-gated, throwaway PG): `createQueue` idempotency; deterministic-id `ON CONFLICT`→null; `sendAfter`/`startAfter` delayed exec; `findJobs`+`cancel`.

**Verification gate (runtime, per project memory):** `npm run lint` · `npx tsc --noEmit` · `npm run build` · `npm test` · **plus** `npm run worker:build` produces `dist/worker.cjs` and `node dist/worker.cjs` boots, creates the `pgboss` schema/queues against `SUPABASE_DB_URL`, and shuts down on SIGTERM.

**Open decisions:** (1) drop `campaigns.enabled` vs kill-switch; (2) web pg-boss-free + 60s arm (rec.) vs web enqueues directly; (3) `fire_first_now` vs `skip_past`; (4) provision `SUPABASE_DB_URL` (session-mode; confirm host IPv4/IPv6 for pooler vs direct).
