# Voximplant AI-Voice RSVP Bridge — KALFA-side implementation plan

**Status:** DRAFT for approval. No code written. Synthesized from 4 specialist
subagents (inventory, endpoints, trigger/worker, UI) and then **empirically
re-verified against live sources** (live DB `cklpaxihpyjbhymqtduv`, actual code,
live Voximplant docs via ctx7). The prior plan docs
(`docs/superpowers/plans/2026-06-29-c2-voximplant-ai-call.md`,
`plans/ai-voice-rsvp-confirmations-plan.md`, `plans/provider-config-forms-spec.md`,
`plans/master-end-to-end-plan.md`) are treated as **historical research, not
spec** — three conflicting design generations, none matching the deployed
scenario. A companion doc they cite (`curious-mapping-thimble.md`) **does not
exist** in the repo (verified). Every load-bearing fact below is tagged
`[VERIFIED]` (checked live this session) or `[OPEN]` (needs a definitive check
before that part is built/shipped).

---

## 1. Ground truth — the deployed scenario contract `[VERIFIED]`

Source of truth = `voxfiles/scenarios/src/RSVP.voxengine.js` (read directly):

- Trigger: `StartScenarios(rule_id=1494311, script_custom_data=JSON.stringify({to,from,iid,cb,ctx,gk}))`.
  Account `10694307`, app `11107202`, OutCall rule `1494311` → scenario `RSVP #907512`.
- `script_custom_data` is the **correct** API parameter name — confirmed against
  3 live-doc sources (customData guide, routing-rules FAQ, StartConferenceRequest);
  our `src/lib/voximplant/core.ts` `startScenarios` already sends exactly this. `[VERIFIED]`
- **StartScenarios success response `[VERIFIED]`** (httpapi/scenarios "Returns"): `result`(number,
  1=ok), `call_session_history_id`(number — for GetCallHistory reconcile), `media_session_access_url`
  (HTTP) and `media_session_access_secure_url` (**HTTPS — use this** for remote hangup /
  AppEvents.HttpRequest, since our origin is HTTPS). Fail-safe "confirmed start" =
  `result===1 && call_session_history_id != null`; persist both `call_session_history_id` and
  `media_session_access_secure_url` on the `call_attempts` row.
- Scenario reads (RSVP.voxengine.js:304-314): `to`(guest phone), `from`(our caller-id),
  `iid`(call id), `cb`(callback URL), `ctx`(context URL), `gk`(Groq key). Missing any of
  to/from/iid/cb/ctx → the scenario terminates.
- `ctx`: fetched with `Net.httpRequestAsync(ctx)` — a plain **GET, no custom headers
  possible**. Must return `{guest_name, event_name, event_date, event_venue}`.
- `cb`: `POST` with **only** `Content-Type: application/json` — **no signature/HMAC
  header** (verified: zero hmac/signature/secret refs in the scenario). Body:
  `{call_status, call_duration, rsvp_digit, rsvp_method, invitation_id, recording_url, transcript:[{speaker,text,at}]}`.
  `call_status ∈ recording_started|completed|failed|no_answer|no_response|cancelled`;
  `rsvp_digit` '1'=attending '2'=declined; may POST more than once (recording_started then terminal).
- Voximplant only logs the cb response code and never retries (scenario `.then/.catch` both `done()`).
- Remote hangup: scenario listens on `AppEvents.HttpRequest` and posts to the session's
  `media_session_access_url` (the referenced `/dashboard/calling` UI does not exist here).

**Hard architectural constraint:** because Voximplant sends **no custom headers** on
either call, ALL endpoint auth must live **in the URL** (path token + query secret) —
an HMAC header is impossible without redeploying a modified scenario.

---

## 2. Verified-facts ledger (corrections to the plans & agents)

| Fact | Live result | Source |
|---|---|---|
| `campaign_channel` enum has `call` | ✅ `whatsapp`,`call` | live DB |
| `contact_op_status` call states (`pending_call`,`call_dialed`,`no_answer`,`voicemail`,`human_interaction_call`,`wrong_number`,`reached_billed`,`not_reached`) | ✅ all exist, unused today | live DB |
| `guests.status` enum | ✅ `pending/attending/declined/maybe` | live DB |
| `guests.rsvp_token` + `rsvp_token_revoked_at` | ✅ exist (128-bit hex, revocable) | live DB |
| RPCs `submit_rsvp`,`try_record_billed_result`,`get_rsvp_by_token`,`reconcile_authorized_set` | ✅ all exist | live DB |
| `contact_interactions` channel-generic + `provider_id` + `payload_meta` jsonb + `billable`/`delivery_*` | ✅ exists (reuse for `call`; store recording in `payload_meta`) | live DB |
| `message_templates` table (A's "T0 hole") | ✅ **exists** — that concern was STALE | live DB |
| `billed_results`, `webhook_inbox`, `outreach_state` | ✅ exist | live DB |
| `app_settings` voximplant columns | ❌ **none** (only `outreach_enabled`) → all NEW | live DB |
| `call_dnc_list`, `call_attempts` tables | ❌ absent → NEW | live DB |
| `contacts.call_consent_at` | ❌ **absent** (C assumed present) → NEW if a consent gate is used | live DB |
| `QUEUES.callRequest` value / consumer | `'outreach-call-request'`; **no `boss.work` consumer** (jobs accumulate) | code |
| Trigger enqueue site | `outreach-engine.ts:678-696` (`boss.send(QUEUES.callRequest,…)`) already exists | code |
| `writeReach()` (`outreach-engine.ts:~407`) | exists, **called by nobody** — the call channel is its intended first caller | code |
| `core.ts` auth shape | **JWT service-account** (`accountId/keyId/privateKey`), NOT the plans' `api_key` | code |
| Voximplant `finish_reason: 'Insufficient funds'` | ✅ real value; matches our history (5,830/11,432 killed by it); balance now **$2.88** | live docs + our report 318807 |

---

## 3. OPEN verification gates — MUST resolve before the marked step ships

1. **`[OPEN, DESIGN-CRITICAL]` `script_custom_data` byte cap.** Docs state a **200-byte**
   max for the in-scenario setter `VoxEngine.customData(str)`; they do **not** confirm
   whether API-passed `script_custom_data` is subject to the same cap. Our full payload
   (two absolute URLs + Groq key + phone) is **~325 bytes**. This forks the design:
   - **Branch A** (no cap on API param): pass full `cb`/`ctx` URLs in `script_custom_data`
     exactly as the scenario already expects — **no scenario change**.
   - **Branch B** (cap applies): the payload MUST shrink under 200 bytes → pass only
     `{to, from, tok}` (a short token), move the Groq key to a **Voximplant-side secret**
     (`ApplicationStorage`/scenario secret, not per-call), and **redeploy a modified RSVP
     scenario** (via voxengine-ci) that builds `ctx`/`cb` from a fixed base URL + `tok`.
   - **Resolution:** one controlled live `StartScenarios` test sending a ~325-byte payload
     and observing (via `GetCallHistory` `call_session_history_custom_data` or scenario
     logs) whether the full payload round-trips. Until resolved, build everything else and
     keep the payload assembly behind a single function so switching branches is a one-file change.
2. **`[PARTLY VERIFIED]` insufficient-funds signals.** VERIFIED live: session-level
   `finish_reason` = **`'Insufficient funds'`** (with a space — matches our report 318807's
   5,830 count; the underscore form `Insufficient_Funds` is NOT in the official docs). API-level:
   a `VoximplantApiError` whose `msg` contains "Insufficient money"/"balance is insufficient".
   `[OPEN]`: the exact numeric `code` on that API error — capture from one controlled low-balance
   call. Until captured, treat any `VoximplantApiError` on `startScenarios` as non-retryable + alert.
3. **`[OPEN, LEGAL]` call-consent / DNC posture.** The RSVP call is transactional (guest was
   invited), but Israeli DNC handling needs an explicit product/legal decision: do we gate on
   a new `contacts.call_consent_at`, only suppress via a `call_dnc_list`, or both? No real call
   may be placed until this is signed off (pre-existing blocker, unaffected by code).
4. **`[OPEN]` per-minute IL PSTN rate** to size `voximplant_min_call_reserve` realistically vs
   the $2.88 balance.

---

## 4. Architecture (three pieces + one token model)

```
Campaign escalation (exists) ──enqueue──▶ QUEUES.callRequest ('outreach-call-request')
                                              │
                                    [NEW] worker consumer  ── getVoximplantConfig()
                                              │             ── balance precheck (GetAccountInfo)
                                              │             ── consent/DNC/reached/active gating
                                              │             ── mint call_attempts row (+access_token)
                                              │             ── startScenarios(rule_id, script_custom_data)
                                              ▼
                              Voximplant cloud runs RSVP scenario
                                    │  GET ctx?                        POST cb?
                                    ▼                                  ▼
                    [NEW] /api/voximplant/ctx/{token}?k=   [NEW] /api/voximplant/cb/{token}?k=
                       returns {guest_name,event_name,       persist-then-process →
                        event_date,event_venue}               map status → guests.status (submit_rsvp),
                                                              bill (writeReach→recordReached)
```

**Token model (reconciled from endpoints + trigger agents):**
- One `call_attempts` row per call. It holds a random **`access_token`** (32 hex,
  `gen_random_bytes(16)` — same strength/precedent as `guests.rsvp_token`, stored
  service-role-only). The token is the **URL path segment** for BOTH `ctx` and `cb`
  (`/api/voximplant/{ctx|cb}/{access_token}`). Not the PK (defense in depth).
- A single global rotatable **`voximplant_callback_secret`** (in `app_settings`) is the
  `?k=` query param on every ctx/cb URL — rotating it invalidates all outstanding call
  URLs at once (a per-call token alone can't). Compared with `timingSafeEqual`.
- `iid` sent to the scenario = the `call_attempts.id` (for readability/reconciliation);
  the cb route **never trusts `body.invitation_id`** — identity comes only from the
  path `access_token`.
- Same token serves ctx (read) and cb (write) because cb legitimately POSTs 2+ times.

---

## 5. Schema changes (one migration; additive; safe to deploy dark)

`supabase/migrations/<ts>_voximplant_bridge.sql` — additive only, no data migration.
After applying: `supabase gen types typescript --linked` (never hand-edit `types.ts`).

**5a. `app_settings` (admin-only RLS already governs this singleton):**
- `voximplant_service_account_json text` — SECRET: the whole downloaded key JSON
  (`account_id`+`key_id`+`private_key`); parsed server-side into `core.ts`'s
  `VoximplantConfig`. One secret column (not 3) — cleaner + one presence-only UI field.
- `voximplant_rule_id text` (default the known `1494311`, but configurable)
- `voximplant_caller_id text` — the `from` number
- `voximplant_callback_secret text` — SECRET, HMAC/URL secret for ctx/cb
- `voximplant_groq_api_key text` — SECRET (only if Branch A keeps `gk` per-call; Branch B
  moves it to a Voximplant-side secret and this column is unused)
- `voximplant_low_balance_threshold numeric default 5.0`,
  `voximplant_min_call_reserve numeric default 0.10`,
  `voximplant_max_concurrent_calls int default 5`,
  `voximplant_max_calls_per_campaign_hour int default 200`
- **Reuse the existing shared `outreach_enabled`** master switch — do NOT add a
  `voximplant_enabled` (matches the shipped WhatsApp pattern; per-campaign channel is
  already governed by `campaigns.channels: campaign_channel[]`).

**5b. `call_attempts` (NEW, service-role-only RLS, mirrors `webhook_inbox` posture):**
`id uuid pk`, `event_id/campaign_id/contact_id` fks, `guest_id uuid null` (bound only when
the contact backs exactly one guest — the same "exactly one guest" rule WhatsApp uses),
`touchpoint_index int`, `access_token text unique`, `token_expires_at timestamptz`
(created_at + 2h), `status text default 'queued'`
(`queued|dialing|in_progress|completed|failed|no_answer|no_response|cancelled|expired`),
`recording_url text`, `transcript jsonb`, `rsvp_digit/rsvp_method text`,
`call_duration_sec int`, `vox_call_session_history_id text` (reconciliation only),
`callback_count int default 0`, `last_callback_at`, `created_at`, `updated_at`,
`unique(campaign_id, contact_id, touchpoint_index)` (idempotency). Indexes on
`access_token` and a partial index on `(status, created_at)` for the stale-sweep.
RLS enabled, **no** anon/auth policy (service-role only); `recording_url`/`transcript`
are PII and live **only** here.

**5c. Consent/DNC (pending the §3.3 legal decision):**
`contacts.call_consent_at timestamptz null` and/or `call_dnc_list(normalized_phone text pk, …)`.

*(Not needed: `campaign_channel.call`, `contact_op_status.*call*` — already live.)*

---

## 6. Component specs

### 6a. Config reader — `src/lib/data/voximplant-config.ts` (NEW, server-only)
`getVoximplantConfig()` mirroring `getSumitServerConfig`/`getWhatsAppConfig` **fail-forward
`select('*')`** style (columns absent pre-migration → returns `null`, never throws → the
whole feature is dark-safe until an admin configures it). Parses
`voximplant_service_account_json` → `{accountId,keyId,privateKey}`; returns null unless
service-account + rule_id + caller_id present. `getVoximplantEnabled()` = `outreach_enabled`.

### 6b. Trigger + worker — `src/lib/data/outreach-calls.ts` (NEW) + `worker/main.ts` (MODIFY)
Add the missing `boss.work(QUEUES.callRequest, guardedWorker(…))` consumer. `dispatchOutreachCall(req)`
(request-free, worker-safe), fail-safe order:
1. `getVoximplantEnabled()` + `getVoximplantConfig()` → skip if off/unconfigured.
2. **Fresh gating** (never trust the queued job's stale state): contact exists & not
   `removal_requested`; consent gate per §3.3; `call_dnc_list` suppression; cross-channel
   `isContactReached(eventId,contactId)` (a WhatsApp reach since enqueue cancels the call);
   campaign still `active` + `allowed_channels.includes('call')` (reuse existing
   `getCampaignContext`/`stepGate`, don't re-derive).
3. **Idempotency**: upsert `call_attempts` on `unique(campaign_id,contact_id,touchpoint_index)`;
   if a prior row is already `in_progress|completed`, skip (no double-dial on job retry).
4. **Balance precheck** `getAccountInfo`: `balance < min_call_reserve` → **no dial**, Slack
   `send_health` alert, return `balance_blocked` (dead-letter, no state marked "called").
   `balance < low_threshold` → warn + proceed.
5. Concurrency + per-campaign-hour caps (reuse `src/lib/security/rate-limit.ts`; correct
   because `kalfa-worker` is a single pm2 instance).
6. Mint `access_token`; assemble `script_custom_data` via **one function** (Branch A: full
   URLs via `getAppUrl`; Branch B: compact `{to,from,tok}`). Build ctx/cb with `getAppUrl`.
7. `startScenarios(...)`. **Fail-safe core rule:** only mark dialed on a CONFIRMED start
   (`result===1` AND `call_session_history_id` present) → then write `call_attempts.status='dialing/in_progress'`,
   `contact_interactions(kind:'call_dialed', billable:false)`, `op_status='call_dialed'`.
   Any other outcome → `failed_to_start`, no "called" state, Slack alert.

### 6c. ctx endpoint — `src/app/api/voximplant/ctx/[token]/route.ts` (NEW, GET)
Order (every failure → generic 404, mirroring `getRsvpByToken`): rate-limit (per-token tight +
per-IP loose) → `timingSafeEqual(?k, voximplant_callback_secret)` → `getCallAttemptByToken`
(join events+guests) → `token_expires_at > now()` → `events.status='active'`. Returns
`{guest_name: first-name via existing deriveGuestFirstName, event_name, event_date:
formatIsraelSpokenDate() (weekday+day+Hebrew-month+bare-year so the scenario's normalizeForSpeech
converts the year), event_venue: venue_name only (never address)}`. Best-effort side effect:
`ctx_delivered_at`, `status queued→dialing`.

### 6d. cb endpoint — `src/app/api/voximplant/cb/[token]/route.ts` (NEW, POST)
Same auth as ctx (minus event-active — a call in flight may still report after the event closes).
**Zod** schema matching the scenario's exact payloads; on parse fail → 400, no persist.
**Persist-then-process** exactly like the WhatsApp webhook: `insertWebhookEvents([{provider:'voximplant',
event_kind:'call_status', dedupe_key:'vox-cb:{attempt.id}:{call_status}', message_id: attempt.id,
payload: body}])` (webhook_inbox.provider is free-text → zero migration). Return `200 'ok'` immediately.
Worker `processWebhookEvent` gains a `'call_status'` branch → `processCallStatus`:
resolve attempt by `message_id` (never `body.invitation_id`); `recordCallOutcome` always; if
`completed` → `insertInteraction(channel:'call',kind:'call_completed',provider_id:attempt.id,billable:true)`,
and if `fresh` → **`writeReach(...)`** (its first real caller → `recordReached`→`try_record_billed_result`,
same cross-channel dedup + auto `op_status='reached_billed'`); if `guest_id` bound →
`submitRsvp(guest.rsvp_token, {status: digit==='1'?'attending':'declined', adults, kids})`
(the SAME atomic RPC the public form + WhatsApp use — do NOT build a second RSVP write path);
PII-free `activity_log` marker `rsvp.from_call` (no transcript/recording/phone).

**Status map:** recording_started→`in_progress`/`op:human_interaction_call`; completed(1/2)→
`completed`/`op:reached_billed`/bill+RSVP; failed→`failed`/op unchanged; no_answer→`no_answer`/`op:no_answer`;
no_response→`no_response`/`op:no_answer`; cancelled→`cancelled`/op unchanged.

### 6e. Admin UI — extend `/admin/channels` (MODIFY; the Voximplant tab is already scaffolded+disabled)
Follow the shipped WhatsApp three-layer pattern (`channels.ts` DAL → `actions.ts` local Zod →
`channels-client.tsx` tab). Enable the tab; build the panel with `Field`s for account/rule/caller
(plain) and — **critically** — a **presence-only, write-only `PrivateKeyField`** for the
service-account JSON (never rendered to the DOM, never prefilled; "מוגדר ✓" + paste-to-replace),
and existing `SecretField` (mask+reveal) for `callback_secret`/`groq_api_key`. **Test-connection**
server action → `getAccountInfo` → shows ✓ + **balance prominently** with a `role="alert"` low-balance
banner (NOT hidden in an accordion — this is the historical failure cause). `CopyRow` for the
ctx/cb base URLs via `getAppUrl`. Every DAL/action re-checks `requireAdmin()`. Never log the key/JWT.

### 6f. Owner/admin call-status UI (MODIFY, low-risk)
Extend `campaign-delivery.ts` `aggregateDeliveryBreakdown` with a `callActivity` bucket (computed
from the already-batched `contacts.op_status`, gated to campaigns whose package includes `call`),
rendered as extra `<Stat>` rows in `manage-client.tsx`'s `DeliveryBreakdown` reusing
`OP_STATUS_LABELS/VARIANTS`. Admin-only recording link (from `contact_interactions.payload_meta` /
`call_attempts.recording_url`) in the admin campaigns view — never surfaced to owners.

---

## 7. Security resolution — the unsigned callback

The scenario POSTs `cb` with no signature `[VERIFIED]`. Mitigations, in the endpoint design:
1. **Bearer token in URL path** (`access_token`, 128-bit) — unguessable; one per call.
2. **Shared rotatable `?k=` secret** (`timingSafeEqual`) — invalidates all outstanding URLs on rotation.
3. **Never trust the body** for identity (`invitation_id`) or for who to bill — identity is the URL token; a forged `{completed,'1'}` still needs a valid unexpired `access_token` **and** the current secret.
4. **Short token TTL** (2h) + stale-sweep expiry.
5. **Optional hardening (post-MVP):** reconcile against `GetCallHistory` (by `vox_call_session_history_id`) before trusting a `completed` that triggers billing; or add a real HMAC by redeploying a modified scenario (couples with Branch B).

---

## 8. Build sequence (each step: `tsc --noEmit` + `lint` + focused tests; nothing places a real call)

0. **Resolve §3.1 (200-byte) + §3.3 (legal)** — 200-byte via one controlled test; legal via product sign-off.
1. Migration 5a-5c + `gen types`.
2. `voximplant-config.ts` (`getVoximplantConfig`) + unit tests.
3. `call-attempts.ts` DAL + `formatIsraelSpokenDate` in `date.ts` + tests.
4. ctx + cb routes + `voxCallbackSchema` + `processCallStatus` branch + tests (forged-token, expired,
   bad-secret, each call_status, idempotent double-POST, PII-not-logged).
5. Trigger `outreach-calls.ts` + `worker/main.ts` consumer + tests (every fail-safe row, balance-block,
   confirmed-start-only writes). Payload assembly behind one function (Branch A/B switch).
6. Admin UI (`/admin/channels`) + Test-connection + owner call-status UI + tests.
7. Doc corrections: update the stale plans' `api_key`→service-account JSON, HMAC→URL-token.
8. **Gated live test** (explicit approval + top-up balance first): one real call to a test phone,
   confirming customData round-trip (settles §3.1), the insufficient-funds code (§3.2), and the
   full ctx→dial→cb→RSVP→bill loop.

---

## 9. Top risks

1. **200-byte `script_custom_data` cap** (§3.1) — could force a scenario redeploy (Branch B). Highest-impact unknown.
2. **Unsigned callback** (§7) — mitigated by URL-token+secret, but a leaked token before expiry can forge one RSVP/charge; GetCallHistory reconcile or real HMAC removes it.
3. **$2.88 balance** — must top up + set the balance alert before any live traffic; insufficient funds already killed the majority of historical calls.
4. **Shared `outreach_enabled` with two admin forms** — ensure each form patches only its own creds + the shared flag; one-line guard comment.
5. **Legal/DNC** (§3.3) — hard blocker for real calls, independent of code.
6. Real calls, transcripts, recordings = personal data + PSTN cost — every step is behind config + explicit approval per CLAUDE.md.
