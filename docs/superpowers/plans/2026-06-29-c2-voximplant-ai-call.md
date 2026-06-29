# C2 — Voximplant AI-Call Channel (the 2nd guest-communication channel)

> Spec only — NOT BUILT. Mirror of the WhatsApp channel (B2/B3). Implements the
> "AI phone call" channel from `plans/plan-paid.md` §1.2/§4.2/§9/§11. Companion to
> `2026-06-26-b2-webhooks-billed-results.md` (the billing core) and
> `2026-06-26-b3-whatsapp-outreach.md` (the send mirror). Scheduler/escalation is C1.

**Goal:** Place an outbound AI phone call to an event's reachable, call-consented
contacts for an **active** campaign, and turn a *verified human interaction*
(DTMF keypress OR ASR-detected human speech above an admin threshold, with AMD
NOT classifying the line as machine/voicemail) into exactly ONE billable
`billed_result` per contact per event — through the SAME `try_record_billed_result`
RPC, so a contact reached on WhatsApp **and** call is charged once.

**Hard constraint (honored):** Voximplant **Management API via fetch**, NOT
`@voximplant/apiclient-nodejs` (ships vulnerable axios/form-data — `[[voximplant-sdk-vulnerable]]`).
Confirmed: `package.json` has **no** Voximplant dependency today (greenfield); the SDK
stays absent. All Voximplant cloud calls are `fetch()` to the platform HTTP API.

**Tech stack:** Next.js 16 Route Handler (callback) + server-only data layer +
`fetch` (StartScenarios), Supabase service-role + the existing SECURITY DEFINER
RPC, Zod 4, Vitest, Node `crypto` (HMAC). One new VoxEngine scenario (JS, lives
in the Voximplant console / committed as an artifact). No new npm packages.

---

## 0. How this mirrors the WhatsApp channel (reuse map)

| Concern | WhatsApp (built) | Call (this spec) |
|---|---|---|
| Master switch | `outreach_enabled` | same + `voximplant_enabled` sub-flag |
| Provider config | `getWhatsAppConfig()` | **new** `getVoximplantConfig()` (same fail-closed `select('*')`+cast pattern) |
| Send adapter | `whatsapp/client.ts` `sendWhatsAppTemplate` | **new** `voximplant/client.ts` `startCallScenario` (fetch → StartScenarios) |
| Orchestrator | `outreach.ts` `sendCampaignWhatsApp` | **new** `sendCampaignCalls` (same gate→send→log shape) |
| Sendable filter | `listSendableContacts` (consent) | **new** `listCallableContacts` (call_consent + not reached + not DNC) |
| Inbound auth | Meta `x-hub-signature-256` HMAC | **our** HMAC over the scenario's POST body (Voximplant has NO built-in webhook signature) |
| Inbound classifier (pure) | `whatsapp/inbound.ts` `classifyInbound` | **new** `voximplant/classify.ts` `classifyCallResult` (D3) |
| Webhook route | `api/webhooks/whatsapp/route.ts` | **new** `api/webhooks/voximplant/route.ts` |
| Dedup | `insertInteraction` UNIQUE(channel,provider_id) | same table, `channel='call'` |
| Bill | `recordReached` → `try_record_billed_result` | **same RPC**, `channel='call'` |
| Contact resolution | `resolveInboundContact` (phone→prior outbound) | **NOT needed** — `contact_id`+`attempt_id` ride in `script_custom_data` and come back in the callback |

**Schema delta is tiny** (§3): the `campaign_channel` enum already has `'call'`, and
`contact_op_status` already has `pending_call / call_dialed / no_answer / voicemail /
human_interaction_call / wrong_number / reached_billed / not_reached`
(`202606240007_outcome_billing_schema.sql:19-33`). `billed_results.evidence_source`
already documents `call_asr|call_dtmf` and `provider_ref` already documents
`voximplant session id`. So the migration is only: `app_settings` Voximplant columns +
thresholds, and `contacts.call_consent_at`.

---

## 1. Voximplant API surface (researched — cited, not guessed)

All via Context7 `/websites/voximplant` + the doc pages below. Voximplant docs are a
JS-rendered SPA (WebFetch returns the empty search shell) — cite the canonical URLs.

### 1.1 Start an outbound call — Management API `StartScenarios` (HTTP, via fetch)
- Endpoint: `POST https://api.voximplant.com/platform_api/StartScenarios/`
  (`https://voximplant.com/docs/references/httpapi/scenarios`,
  `…/help/faq/how-do-i-launch-scenarios-using-http-api`).
- Auth + params (form/query): `account_id`, `api_key`, `rule_id`
  (`…/docs/references/httpapi/auth_parameters`). The `rule_id` is an application
  **rule** bound to our outbound scenario.
- Pass per-call data via **`script_custom_data`** (a string; we send JSON). Read it
  inside the scenario with `VoxEngine.customData()`; searchable later via GetCallHistory's
  `call_session_history_custom_data` (`…/docs/guides/voxengine/custom-data`).
- Response (`…/docs/references/httpapi/managing_scenarios`):
  `call_session_history_id` (number — the canonical call id; feed it to GetCallHistory),
  `media_session_access_url` / `media_session_access_secure_url` (control URL — HTTP to it
  fires `AppEvents.HttpRequest` in the running scenario), `result` (1 = success).
- One StartScenarios = one JS session = one outbound call (mass dialing = many parallel
  StartScenarios; the scheduler/C1 paces this).

### 1.2 The scenario (VoxEngine, JS)
- Outbound leg: `VoxEngine.callPSTN(number, callerid, parameters)`
  (`…/docs/references/voxengine/voxengine/callpstn`). **`callerid` must be a purchased/verified
  Voximplant number.** Calls > 20¢/min and calls to Africa are **blocked by default** — confirm
  Israel PSTN isn't under the cap (it isn't, but verify per-account at go-live).
- Lifecycle events: `CallEvents.Connected`, `CallEvents.Failed`, `CallEvents.Disconnected`
  (`…/docs/guides/voxengine/concepts`).
- TTS prompt: `call.say(text, { language|voice })`; Hebrew voices exist (e.g. Google
  `he_IL_Standard_*` — `…/docs/references/avatarengine/voicelist/google`); `VoxEngine.createTTSPlayer`
  for finer control.
- AMD (answering-machine detection): `require(Modules.AMD)` →
  `new AMD.AnsweringMachineDetector(call, …)`; events carry **`resultClass`**
  (`'human' | 'voicemail' | 'timeout' | 'call termination'`), **`confidence`** (0–100,
  "handle with care"), `resultSubtype` (`…/docs/references/voxengine/amd/events`,
  `…/amd/answeringmachinedetector`).
- ASR: `VoxEngine.createASR({ model, language, profile_id })`
  (`…/docs/references/voxengine/voxengine/createasr`); attach with `call.sendMediaTo(asr)`;
  `ASREvents.Result` carries **`text`**, **`confidence`** (0–100 **or** 0–1 *depending on
  provider* — so PIN the provider/model and store the threshold in that scale),
  `languageCode` (`…/docs/references/voxengine/asrevents`). Models like `phonecall` /
  `callcenter` are tuned for low-bandwidth audio.
- DTMF: `call.handleTones(true)` then `CallEvents.ToneReceived` → `e.tone`
  (`…/docs/guides/voxengine/concepts`).

### 1.3 Getting the result back to KALFA
- **Primary (scenario push):** `VoxEngine.httpRequestAsync({ url, method:'POST', headers, postData })`
  (returns a Promise; also `Net.httpRequestAsync` with `Net.HttpRequestOptions.postData`/`headers`
  — `…/docs/guides/voxengine/api`, `…/docs/references/voxengine/net/httprequest`). The scenario
  classifies *nothing billing-related*; it POSTs **raw evidence** to
  `https://beta.kalfa.me/api/webhooks/voximplant`, then `VoxEngine.terminate()`.
  **Order matters: `await` the POST before `terminate()` — terminate kills pending requests.**
- **Reconciliation (pull):** `GetCallHistory` (sync) / `GetCallHistoryAsync` (async, posts the
  result to a callback URL — `…/docs/references/httpapi/history`) by `call_session_history_id`;
  the response's `call_list[]` carries `call_id, start_time, end_time, callerid, phone_number`
  and the round-tripped custom data (`custom_1..custom_4` / searchable via
  `call_session_history_custom_data`) — `…/docs/references/voxengine/voximplantapi/getcallhistoryasyncresponse`.
  Used to (a) verify a callback whose HMAC we can't trust (match `attemptId` + status), and
  (b) catch calls whose scenario crashed before POSTing.

### 1.4 LLM / AI-dialogue (brief — see §10)
- Voximplant's **native** voice-agent path is the OpenAI Realtime API client
  (`…/products/openai-client`, `…/docs/guides/voice-ai/openai`) — it streams call audio to
  **OpenAI**, so it is a PII egress decision. There's also an OpenAI **Chat Completions**
  connector and **BYO-LLM via OpenAI-compatible API** (`…/blog/voximplant-adds-enhanced-pipeline-options-for-voice-ai`).
- For KALFA: **v1 is a deterministic IVR** (no LLM) — fully sufficient for "reached" + RSVP.
  If/when conversational AI is wanted, KALFA drives it via our OWN endpoint calling Claude
  (`claude-opus-4-8`, or `claude-haiku-4-5` for per-turn latency), NOT Voximplant→OpenAI — keeps
  guest audio/PII under KALFA control and uses the house model. See §10.

### 1.5 Israel outbound specifics (legal — flag, don't invent)
- Israel runs a **Do-Not-Call registry** (Amendment 61 to the Consumer Protection Law; live
  for consumers 2022-12-12) and holds the **business fully liable for its telemarketing
  provider's** violations (IAPP: "Israel tightens marketing rules with a do not call registry";
  DLA Piper "Electronic marketing in Israel"). For *calls*, the transactional-vs-marketing line
  is higher-stakes than WhatsApp — see §9. AI-bot disclosure: no single explicit IL statute found;
  default to disclosing it's an automated call up front (§6 prompt) and get legal sign-off.

---

## 2. The "reached" definition for calls (D3) — admin-config, server-side

From `plans/plan-paid.md` §4.2 (success on a call requires evidence of real human interaction
*after* the call connected) and §11 (op-status states) and §18 (connected-but-no-human ⇒ no charge;
reached on both channels ⇒ billed once).

**Billable ("reached") iff ALL hold:**
1. The PSTN leg **Connected** (answered), AND
2. AMD did **not** classify the line as machine: `resultClass ∈ {human, (amd disabled)}`, i.e.
   `voicemail | timeout | call termination` ⇒ NOT reached, AND
3. EITHER a **DTMF** digit was captured (any of the configured keys), OR an **ASR** result with
   `text` non-empty AND `confidence ≥ call_asr_min_confidence` AND utterance length
   `≥ call_min_utterance_ms`.

**Never billable:** ring, no-answer, busy, failed, connect-only with no DTMF/qualifying-ASR,
voicemail/IVR/machine, wrong-number. A bare `CallEvents.Connected` is explicitly NOT enough
(plan §4.2).

**All thresholds are ADMIN DB config (`app_settings`), never hardcoded** (`[[no-hardcoded-business-facts]]`):
`call_asr_min_confidence`, `call_min_utterance_ms`, `call_amd_enabled`, the DTMF key set,
`call_asr_model`, `call_asr_language` (the model fixes the confidence scale). Changing a threshold
must NOT require re-deploying the scenario — which is exactly why classification lives in KALFA
(`classifyCallResult`), and the scenario only emits raw evidence.

`evidence_source`: `'call_dtmf'` when a DTMF key drove the reach, else `'call_asr'`.

---

## 3. Data model + migration (minimal)

`supabase/migrations/<ts>_voximplant_call_config.sql` — introspect live first
(`[[supabase-live-schema]]`, `[[sb-query-readonly-helper]]`), apply only with explicit approval
(one-off Management-API write), don't regen types from scratch (readers cast).

```sql
-- Outbound AI-call provider config (admin-managed, server-only). Secrets are text columns
-- alongside the existing sumit_api_key / whatsapp_access_token / extra_sms_token.
alter table public.app_settings
  add column if not exists voximplant_enabled         boolean not null default false,
  add column if not exists voximplant_account_id      text,
  add column if not exists voximplant_api_key         text,   -- secret (StartScenarios auth)
  add column if not exists voximplant_rule_id         text,   -- application rule → outbound scenario
  add column if not exists voximplant_caller_id       text,   -- purchased/verified caller id
  add column if not exists voximplant_callback_secret text,   -- HMAC key for the result callback
  -- D3 "reached" thresholds (admin-tunable; NOT in the scenario):
  add column if not exists call_amd_enabled           boolean not null default true,
  add column if not exists call_asr_model             text    not null default 'phonecall',
  add column if not exists call_asr_language          text    not null default 'he-IL',
  add column if not exists call_asr_min_confidence    numeric not null default 60,  -- in the model's scale
  add column if not exists call_min_utterance_ms      integer not null default 800,
  add column if not exists call_dtmf_reach_keys       text    not null default '1234567890*#',
  add column if not exists call_max_duration_seconds  integer not null default 90;  -- scenario hard cutoff

-- Channel-specific CALL consent (CLAUDE.md / IL law). Null = no recorded call consent.
alter table public.contacts
  add column if not exists call_consent_at timestamptz;

-- (Optional, recommended) DNC suppression list — phones that must never be called.
-- Keyed by E.164; checked server-side before every dial (IL Amendment-61 liability §9).
create table if not exists public.call_dnc_list (
  normalized_phone text primary key,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.call_dnc_list enable row level security;
create policy call_dnc_admin_all on public.call_dnc_list for all
  using (public.has_role(auth.uid(),'admin'::app_role))
  with check (public.has_role(auth.uid(),'admin'::app_role));
```

No new enum values (the `campaign_channel='call'` + the `pending_call…human_interaction_call`
op-statuses already exist). `billed_results` / `contact_interactions` are reused as-is.

**Interaction-row keying (avoids the UNIQUE(channel, provider_id) self-collision).** A call has
ONE provider session id but TWO interaction rows (outbound dial + inbound result), so they need
distinct `provider_id`s:
- **Outbound** (`direction='out'`, `kind='call_dialed'`): `provider_id = attempt_id` (a KALFA-generated
  UUID minted before StartScenarios). Written when StartScenarios returns OK.
- **Inbound** (`direction='in'`, `kind='call_result'`): `provider_id = call_session_history_id`
  (from StartScenarios / echoed in the callback). This is what the callback dedupes on.
- `recordReached`: `attemptId = attempt_id`, `providerRef = call_session_history_id`,
  `evidence ∈ {call_dtmf, call_asr}`.

---

## 4. Config readers — extend `src/lib/data/outreach-config.ts`

Add, in the existing fail-closed `select('*')`+`as Record<string,unknown>` style (returns
off/null pre-migration), reading via `createAdminClient()`:

```ts
export type VoximplantConfig = {
  accountId: string; apiKey: string; ruleId: string; callerId: string;
  callbackSecret: string | null;          // null until the callback is provisioned
};
export type CallReachThresholds = {
  amdEnabled: boolean; asrModel: string; asrLanguage: string;
  asrMinConfidence: number; minUtteranceMs: number; dtmfReachKeys: string;
  maxDurationSeconds: number;
};
export async function getVoximplantEnabled(): Promise<boolean>;   // outreach_enabled && voximplant_enabled
export async function getVoximplantConfig(): Promise<VoximplantConfig | null>; // null unless account_id+api_key+rule_id+caller_id present
export async function getCallReachThresholds(): Promise<CallReachThresholds>;   // always returns (defaults baked in)
```

Secrets (`apiKey`, `callbackSecret`) never leave the server, never logged.

---

## 5. Call-start client — `src/lib/voximplant/client.ts` (Management API via fetch)

```ts
import 'server-only';
export class VoximplantStartError extends Error { /* name='VoximplantStartError' */ }

// Launch ONE outbound AI-call scenario. NO SDK — plain fetch to the platform HTTP API.
// Never log apiKey, callerId, destination, or the contact's phone.
export async function startCallScenario(
  cfg: { accountId: string; apiKey: string; ruleId: string; callerId: string },
  params: {
    to: string;            // E.164 destination (contact.normalized_phone)
    eventId: string; campaignId: string; contactId: string;
    attemptId: string;     // KALFA-minted UUID, round-trips via script_custom_data
    callbackUrl: string;   // APP_ORIGIN + '/api/webhooks/voximplant'
  },
): Promise<{ callSessionHistoryId: string }> {
  const body = new URLSearchParams({
    account_id: cfg.accountId,
    api_key: cfg.apiKey,
    rule_id: cfg.ruleId,
    // The scenario reads this via VoxEngine.customData(). NOTE: this string is persisted in
    // Voximplant call history and is searchable — so it carries ONLY non-secret routing data
    // (ids, phone, callerid, callbackUrl). The HMAC signing secret is NOT here (see §7).
    script_custom_data: JSON.stringify({
      to: params.to, callerId: cfg.callerId,
      eventId: params.eventId, campaignId: params.campaignId,
      contactId: params.contactId, attemptId: params.attemptId,
      callbackUrl: params.callbackUrl,
    }),
  });
  let res: Response;
  try {
    res = await fetch('https://api.voximplant.com/platform_api/StartScenarios/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch { throw new VoximplantStartError('הפעלת השיחה נכשלה'); }
  const json = (await res.json().catch(() => null)) as
    | { result?: number; call_session_history_id?: number; error?: unknown } | null;
  if (!res.ok || json?.result !== 1 || json?.call_session_history_id == null) {
    throw new VoximplantStartError('הפעלת השיחה נכשלה');
  }
  return { callSessionHistoryId: String(json.call_session_history_id) };
}
```

Mirrors `sendWhatsAppTemplate`: thin, throws a Hebrew-safe error, no PII logged.

---

## 6. The VoxEngine scenario (committed as an artifact; configured on a Voximplant rule)

Lives in the Voximplant console bound to `voximplant_rule_id`; commit a copy under
`voximplant/scenarios/kalfa-rsvp-call.js` for review (it is provider code, not bundled by Next).

**Required modules** (declare at the top of the scenario):
`require(Modules.AMD)` and `require(Modules.ASR)`
(`…/docs/references/voxengine/amd/answeringmachinedetector`, `…/docs/references/avatarengine/asrmodellist`).
DTMF/`handleTones` and `VoxEngine.httpRequestAsync` need no module require.

**Design (deterministic IVR — v1):**
1. `const data = JSON.parse(VoxEngine.customData())` → `{ to, callerId, eventId, campaignId, contactId, attemptId, callbackUrl }`.
2. Hard cutoff timer: `setTimeout(() => finish('timeout'), call_max_duration_seconds*1000)` — but
   the cutoff value is passed in `customData` too (admin-tunable) OR read from a scenario constant
   that the deploy step syncs; do not bury policy in code.
3. `const call = VoxEngine.callPSTN(data.to, data.callerId, { amd: new AMD.AnsweringMachineDetector() })`.
   AMD attaches either as this `callPSTN` parameter (`CallPSTNParameters.amd`) or constructed and wired
   via `amd.addEventListener(AMD.Events.DetectionComplete, …)` — both are documented. `call.handleTones(true)`.
4. On `CallEvents.Failed` → `finish('failed')`. On `CallEvents.Connected`:
   - **AMD first.** Collect the AMD verdict `{ resultClass, confidence }`. If
     `resultClass ∈ {voicemail, call termination}` → hang up + `finish('machine', {amd})` (machine ⇒
     never billable; the scenario branches purely for call-flow — the *billing* verdict is still
     server-side).
   - Else (human / AMD inconclusive): `call.say(promptHe, { lang: 'he-IL' })` — or
     `VoxEngine.createTTSPlayer({ text, language:'he-IL', tts_engine:'google'|'nuance', voice })`. Hebrew
     TTS is supported (Google `he_IL_*`, Nuance `nuance_hebrew_israel`). `promptHe` discloses it's an
     automated RSVP call and asks: "press 1 if attending, 2 if not, or just say your answer." Disclosure
     satisfies §1.5.
   - **THEN attach ASR** — `const asr = VoxEngine.createASR({ profile, model, language, phraseHints });
     asr.on(ASREvents.Result, e => …); call.sendMediaTo(asr);` collect the first `ASREvents.Result` →
     `{ text, confidence }` (`…/docs/guides/speech/stt`, `…/docs/references/voxengine/voxengine/createasr`).
     Pass **`phraseHints`** = the admin RSVP keyword list (e.g. `['כן','לא','מגיע','לא מגיע']`) to bias
     recognition toward the exact utterances "reached" depends on — store it as an `app_settings` field too,
     not hardcoded.
     ⚠️ **A call receives only ONE inbound audio stream** (`…/docs/references/voxengine/call` → `sendMediaTo`:
     "a new incoming stream always replaces the previous one"). So AMD must consume the audio *before* ASR's
     `sendMediaTo` — never run both on the inbound leg at once, or AMD's stream is silently replaced. DTMF
     (`handleTones`) is a separate channel and runs concurrently with either.
   - `CallEvents.ToneReceived` → push `e.tone` into `dtmfDigits[]`; first qualifying key ⇒ proceed.
   - On capture (DTMF or ASR) or silence-timeout → `finish('done', evidence)`.
5. `CallEvents.Disconnected` → `finish('disconnected')` if not already finished.
6. **`finish(callResult, evidence)`** builds the raw-evidence payload, signs it (§7), then:
   `await VoxEngine.httpRequestAsync({ url: data.callbackUrl, method:'POST', headers, postData })`
   **then** `VoxEngine.terminate()` (terminate kills pending requests, so the `await` is load-bearing).

**The scenario never decides "reached".** It reports raw signals; KALFA's `classifyCallResult`
applies the admin thresholds. (This is the §2 rule and the direct analog of `classifyInbound`
being pure + server-side.)

Payload the scenario POSTs (JSON):
```json
{
  "attemptId": "<uuid>", "callSessionHistoryId": "<id>",
  "eventId": "...", "campaignId": "...", "contactId": "...",
  "callResult": "done|machine|failed|disconnected|timeout",
  "connected": true, "connectedDurationMs": 14200,
  "amd": { "resultClass": "human", "confidence": 88 },
  "asr": { "text": "כן אני מגיע", "confidence": 0.91, "scale": "0..1" },
  "dtmfDigits": ["1"],
  "ts": 1719600000
}
```

---

## 7. Result callback route — `src/app/api/webhooks/voximplant/route.ts`

Server-to-server, NO session/CSRF — the HMAC IS the auth (exact mirror of the WhatsApp route's
`verifySignature` + fail-closed posture). Voximplant has **no built-in webhook signature**, so we
roll our own.

- **Signing secret delivery — DO NOT put it in `script_custom_data`** (that string is persisted in
  call history and searchable → secret-in-logs, forbidden by CLAUDE.md). The scenario gets the
  `voximplant_callback_secret` from a **Voximplant scenario secret / env constant** baked at deploy
  time. The scenario computes `signature = HMAC_SHA256(rawBody, secret)` and sends it as a header
  (e.g. `x-kalfa-signature`).
- **Route gate (fail-closed → 200, never 5xx, so a misconfig doesn't trigger provider retry storms):**
  `getVoximplantEnabled()` AND `getVoximplantConfig()?.callbackSecret`. If off/missing → `200 'ok'`,
  write nothing.
- Read RAW body; `verifySignature(raw, header, secret)` via `createHmac('sha256',…)` + `timingSafeEqual`
  (copy `whatsapp/route.ts:19-35`). Bad/absent signature → `401`, write nothing.
- **Fallback authenticity** (if scenario-side HMAC proves awkward to provision): verify by calling
  `GetCallHistory` server-side on `callSessionHistoryId` and matching `custom_data.attemptId` +
  `status` before trusting the payload. (HMAC is primary; this is the belt-and-suspenders.)
- On valid:
  1. Zod-parse the payload (`validation/voximplant.ts`).
  2. `insertInteraction({ event_id, campaign_id, contact_id, channel:'call', direction:'in',
     kind:'call_result', provider_id: callSessionHistoryId, billable:false })` — UNIQUE(channel,
     provider_id) dedups provider retries; returns `false` if already seen → stop (idempotent).
  3. `const thr = await getCallReachThresholds();`
     `const verdict = classifyCallResult(payload, thr);` (pure, §8).
  4. `await setContactOpStatus(contactId, verdict.opStatus)` (`human_interaction_call` |
     `voicemail` | `no_answer` | `not_reached`).
  5. If `verdict.reached`: `await recordReached({ eventId, campaignId, contactId, channel:'call',
     attemptId, evidence: verdict.evidenceSource, providerRef: callSessionHistoryId })`.
     - Outcome `'billed'` → contact moves to `reached_billed` (RPC + `setContactOpStatus`).
     - Outcome **`'already_billed'`** is the **correct, expected** result when the contact was
       already reached on WhatsApp (cross-channel dedup via `billed_results` UNIQUE(event_id,
       contact_id)) — NOT an error; don't surface it as one. `'ceiling_reached' / 'closed_window' /
       'not_active'` are likewise normal terminal outcomes.
  6. Always `200 'ok'`. Never log phone/ASR text/payload.

`contact_id`+`attempt_id` come straight from the signed payload → **no `resolveInboundContact`**.

---

## 8. Pure classifier — `src/lib/voximplant/classify.ts` (D3, unit-tested, no I/O)

```ts
export type CallEvidence = {
  callResult: 'done'|'machine'|'failed'|'disconnected'|'timeout';
  connected: boolean; connectedDurationMs: number;
  amd?: { resultClass: string; confidence?: number };
  asr?: { text?: string; confidence?: number; scale?: '0..1'|'0..100' };
  dtmfDigits?: string[];
};
export type CallVerdict = {
  reached: boolean;
  evidenceSource: 'call_dtmf'|'call_asr'|null;
  opStatus: 'human_interaction_call'|'voicemail'|'no_answer'|'not_reached'|'wrong_number';
};
export function classifyCallResult(e: CallEvidence, t: CallReachThresholds): CallVerdict;
```

Logic (the §2 rule):
- not `connected` or `callResult ∈ {failed}` → `{reached:false, null, no_answer}`.
- `t.amdEnabled` and `amd.resultClass ∈ {voicemail,'call termination'}` → `{false, null, voicemail}`.
  (`timeout` AMD = inconclusive → fall through to DTMF/ASR; never reached on AMD alone.)
- DTMF: if any digit in `dtmfDigits` is in `t.dtmfReachKeys` → `{true, 'call_dtmf', human_interaction_call}`.
- ASR: normalize confidence to the threshold's scale; if `asr.text` non-empty AND
  `conf ≥ t.asrMinConfidence` AND `connectedDurationMs ≥ t.minUtteranceMs` →
  `{true, 'call_asr', human_interaction_call}`.
- else → `{false, null, not_reached}`.

Pin the ASR provider/model (config) so `scale` is known; the classifier converts `0..1`↔`0..100`
before comparing. Mirror `classifyInbound`: tiny, total, fully covered by unit tests.

---

## 9. Consent + legal (flag for sign-off; non-blocking to build, blocking to enable)

- **`call_consent_at`** mirrors `whatsapp_consent_at`. `listCallableContacts(eventId)` filters:
  `removal_requested=false` AND `call_consent_at IS NOT NULL` AND op_status NOT already reached/billed
  AND `normalized_phone NOT IN call_dnc_list`.
- **OPEN PRODUCT/LEGAL DECISION (sign-off before go-live):** is an RSVP call to a specifically-invited
  guest *transactional* (event-scoped, owner attests consent) or *marketing* (requires per-recipient
  opt-in + IL Do-Not-Call scrubbing)? For **calls** the stakes are higher than WhatsApp — Amendment 61
  + full provider-liability (§1.5). Default fail-closed: require a recorded `call_consent_at` per contact
  AND DNC suppression. The AI-disclosure line in the prompt (§6) is mandatory regardless.

---

## 10. AI-dialogue (LLM) brief

- **v1 ships the deterministic IVR (§6) — no LLM.** It already satisfies "reached" (DTMF/ASR human
  signal) and captures the RSVP (1=yes / 2=no / spoken answer). Lowest risk, no third-party audio
  egress, cheapest, easiest to certify.
- **If conversational AI is later wanted:** KALFA drives the dialogue from **our own** turn endpoint
  (e.g. `POST /api/voximplant/turn`) that the scenario calls via `httpRequestAsync` with the latest
  ASR transcript; that endpoint calls **Claude via the Anthropic SDK** server-side and returns the
  next line for `call.say`. Recommended model `claude-haiku-4-5` for per-turn latency (or
  `claude-opus-4-8` at `effort:'low'` for quality); keep the prompt minimal and structured. This keeps
  guest audio/PII inside KALFA's trust boundary and uses the house model.
- **Avoid** Voximplant's native OpenAI Realtime client for KALFA's first build — it streams call audio
  to OpenAI (a separate PII-egress + DPA decision) and isn't the house model. It remains an option if
  ultra-low-latency full-duplex speech-to-speech becomes a hard requirement, but it's out of scope here.

---

## 11. Files (create / modify)

- **New** `supabase/migrations/<ts>_voximplant_call_config.sql` (§3) — pending apply.
- **Modify** `src/lib/data/outreach-config.ts` — `getVoximplantEnabled` / `getVoximplantConfig` /
  `getCallReachThresholds` (§4).
- **New** `src/lib/voximplant/client.ts` — `startCallScenario` (§5) + test (mock `fetch`).
- **New** `src/lib/voximplant/classify.ts` — `classifyCallResult` (§8) + test (pure).
- **New** `src/lib/validation/voximplant.ts` — Zod schema for the callback payload.
- **Modify** `src/lib/data/contacts.ts` — `recordCallConsent`, `listCallableContacts` (§9).
- **New** `src/lib/data/outreach-calls.ts` — `sendCampaignCalls(campaignId)` orchestrator: gate
  (`getVoximplantEnabled` + config + campaign active + `'call'` in `allowed_channels`), then for each
  `listCallableContacts`: mint `attemptId`, `startCallScenario`, insert the **outbound** interaction
  (`provider_id=attemptId`, `kind='call_dialed'`), `setContactOpStatus(contactId,'call_dialed')`;
  per-call failure → `skipped++`, never abort the batch, no PII logged. (Mirror `sendCampaignWhatsApp`.)
- **New** `src/app/api/webhooks/voximplant/route.ts` — signed result callback (§7).
- **New (artifact)** `voximplant/scenarios/kalfa-rsvp-call.js` — the VoxEngine scenario (§6), committed
  for review; deployed to the Voximplant rule out-of-band.
- **New (optional)** `src/app/api/campaigns/[id]/call-send/route.ts` — gated admin/owner manual trigger
  (mirror `whatsapp-send`), interim until C1's scheduler calls `sendCampaignCalls`.

---

## 12. Tests (Vitest)

- `classify.test.ts` (the money logic): DTMF key ⇒ reached/`call_dtmf`; ASR ≥ threshold & ≥ min-utterance
  ⇒ reached/`call_asr`; ASR below threshold ⇒ not reached; AMD `voicemail`/`call termination` ⇒ not
  reached even with audio; `connected:false`/`failed` ⇒ `no_answer`; confidence-scale normalization
  (0..1 vs 0..100) — proves an admin threshold change flips the verdict with no scenario redeploy.
- `client.test.ts`: mock `fetch` — POSTs form-encoded to StartScenarios with `account_id/api_key/rule_id`
  + `script_custom_data` (assert the **secret is NOT** in custom_data); returns `callSessionHistoryId`
  on `result:1`; throws `VoximplantStartError` on `result≠1` / non-OK / network error.
- `outreach-calls.test.ts`: `{started:0}` when `getVoximplantEnabled()` false (fail-closed); never dials
  when campaign not active or `'call'` not allowed; per contact → `startCallScenario` then outbound
  interaction insert (`channel:'call', direction:'out', kind:'call_dialed', provider_id:attemptId,
  billable:false`); one failure increments `skipped`, no PII logged.
- Webhook route — integration-tested manually (Task in §13). Signature verify mirrors the WhatsApp
  unit shape: forged/absent signature ⇒ nothing written.
- Use real v4 UUID fixtures (`[[zod4-uuid-version-strict]]`).

---

## 13. Go-live verification (BEFORE enabling — `[[verification-gate-runtime]]`)

1. Apply the §3 migration (approval). Provision in `app_settings`: `voximplant_account_id`,
   `voximplant_api_key`, `voximplant_rule_id`, a **purchased** `voximplant_caller_id`,
   `voximplant_callback_secret`. In Voximplant: create the application + rule, upload the §6 scenario,
   inject the callback secret as a scenario secret/env, set the rule → scenario. Verify Israel PSTN
   isn't under the 20¢/min default block for the account.
2. One `npm run build` (`--webpack`, `[[build-webpack-not-found-fix]]`) + `pm2 restart kalfa-beta`.
3. Controlled live test (real call = explicit-approval action per CLAUDE.md): an ACTIVE test campaign,
   ONE call-consented contact = your own number. Verify: outbound `contact_interactions`
   (`call_dialed`, `provider_id=attemptId`); press `1` → callback arrives signed → inbound
   `call_result` row (`provider_id=callSessionHistoryId`), `billed_results` row with
   `evidence_source='call_dtmf'`, `locked_price=price_per_reached`, op_status `reached_billed`; a
   **second** callback for the same `callSessionHistoryId` creates NO second billed_result (dedup);
   a voicemail/AMD-machine call creates NO billed_result; `campaign_billing_summary` reflects it.
4. Cross-channel: a contact already `reached_billed` on WhatsApp, then called and reached → RPC returns
   `already_billed`, exactly one `billed_results` row total (§18 "billed once").
5. Advisor checkpoint before broad rollout; Lead runs the integrated build + authed runtime check.

---

## 14. [מרחיב] / [יוצר] map (who-builds-what)

- **[מרחיב] (KALFA app / this spec):** migration §3; `outreach-config.ts` readers; `voximplant/client.ts`
  (fetch StartScenarios); `voximplant/classify.ts` (D3, the reached verdict); `validation/voximplant.ts`;
  `contacts.ts` call-consent + callable filter + DNC; `outreach-calls.ts` orchestrator; the signed
  `api/webhooks/voximplant` route; (optional) manual trigger route; tests. The **billing verdict and all
  thresholds live here**, server-side, admin-configurable.
- **[יוצר] (Voximplant cloud):** the application + rule + purchased caller-id number; the VoxEngine
  scenario (§6 — TTS/AMD/ASR/DTMF + signed `httpRequestAsync` callback); the scenario secret holding
  the HMAC key; PSTN termination. Voximplant emits **raw evidence only** — it is "not a source of business
  authority" (`plan-paid.md` §8.3); KALFA decides reached + billing.

---

## Self-review / consistency

- RPC name + params (`p_event/p_campaign/p_contact/p_channel/p_attempt/p_evidence/p_provider_ref`),
  outcome strings, and `recordReached` signature are identical to B2/B4 — `channel='call'`,
  `evidence ∈ {call_dtmf,call_asr}`, `provider_ref = call_session_history_id`.
- `contact_interactions` keys match the existing columns; outbound keyed by `attemptId`, inbound by
  `callSessionHistoryId` (distinct → no UNIQUE collision; provider retries idempotent).
- Cross-channel single-charge is the `billed_results` UNIQUE(event_id,contact_id) guarantee; `already_billed`
  is success, not error.
- No SDK (fetch only); secrets server-only and never in `script_custom_data`/logs; classification +
  thresholds server-side and admin-configurable (no hardcoded business facts); fail-closed everywhere.

### Open decisions for the user
1. Consent model for calls (transactional vs marketing) + IL Do-Not-Call scrubbing scope (§9).
2. Whether v1 is deterministic IVR only (recommended) vs LLM-driven from day one (§10).
3. ASR provider/model choice (fixes the confidence scale + per-minute cost) and the default
   `call_asr_min_confidence` / `call_min_utterance_ms` values (§2/§8) — admin-tunable, but pick sane defaults.
4. Caller-id strategy (a single purchased IL number vs per-org) and whether the manual trigger route
   (§11) is interim-only until C1's scheduler ships.
