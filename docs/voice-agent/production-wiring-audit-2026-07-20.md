# Production Wiring Audit — Voximplant ⇄ ElevenLabs ⇄ Backend ⇄ Supabase

**Date:** 2026-07-20 · **Scope:** this repository only (`/var/www/vhosts/kalfa.me/beta`, branch `main`, clean, up to date with `origin/main`) · **Method:** read-only investigation by five parallel mapping agents (Voximplant platform, ElevenLabs agent, app glue, API contracts + monitor/takeover, data model), findings cross-verified by the coordinating session against the actual files. No file other than this document was created or modified. No secrets or personal data appear here — environment-variable and setting **names** only.

**Classification vocabulary:** `production` / `sandbox` / `preview` / `test` / `legacy` / `partially wired` / `unused` / `unknown`. Implementation verdicts: `IMPLEMENTED` / `PARTIAL` / `TEST ONLY` / `NOT FOUND` / `UNKNOWN`.

> **ADDENDUM (2026-07-20, later the same day):** the ElevenLabs bridge was **promoted to the production application** per owner directive: `VoiceAgentTest.voxengine.js` → `voxfiles/scenarios/src/RSVPAgent.voxengine.js`, deployed as scenario `RSVPAgent` (id 918450) bound to new rule `OutCallAgent` (id 1520915) on `kalfa-rsvp` (11107202); the `ELEVENLABS_API_KEY` Secret already existed on both applications. Statements below describing the bridge as "kalfatest sandbox only" reflect the state at audit time. Still true after the promotion: the worker dispatcher targets only `app_settings.voximplant_rule_id` (the DTMF `OutCall` rule) — **no production traffic flows to the bridge until that setting is changed**, and the old `VoiceAgentTest` scenario/rule remain on `kalfatest` as undeleted legacy.

> Facts that live only in the production database or on provider dashboards (toggle states, wired webhook ids) are marked `UNKNOWN (live state)` — a repository audit cannot prove them. They are collected as direct questions in Section 11.

---

## SECTION 1: EXECUTIVE SUMMARY

1. **Production Voximplant application:** `kalfa-rsvp.kalfarsvp.voximplant.com` (app id 11107202).
2. **Sandbox application:** `kalfatest.kalfarsvp.voximplant.com` (app id 11107302).
3. **Active rule → scenario per application** (from `voxfiles/applications/*/rules.config.json` + `.voxengine-ci` metadata):
   - `kalfa-rsvp`: rule `OutCall` (id 1494311, pattern `.*`) → scenario **`RSVP`** (#907512) — **the only live production binding**. Rule `incoming` (id 1494687, pattern `97237219347`) has **no scenario** (unused inbound rule).
   - `kalfatest`: `KALFA` (1494315) → `KALFA` (#903861); `OutCallPreview` (1520316) → `RSVPPreview` (#918268); `VoiceABTest` (1520325) → `VoiceABTest` (#918274); `VoiceAgentTest` (1520330) → `VoiceAgentTest` (#918276).
4. **Actual production VoxEngine source:** `voxfiles/scenarios/src/RSVP.voxengine.js` — DTMF + Google he-IL ASR + Groq (`llama-3.3-70b-versatile`) intent classification. **It never touches ElevenLabs.**
5. **Other scenario files:** `RSVPPreview.voxengine.js` = preview (DTMF-only, sends no callbacks); `VoiceABTest.voxengine.js` = test (TTS A/B probe); `VoiceAgentTest.voxengine.js` = **sandbox — the ElevenLabs bridge**; `KALFA.voxengine.js` = legacy (unmodified Voximplant CallList tutorial bound to a live kalfatest rule); `Outgoingcall-RSVPAI.voxengine.js` = legacy (deployed as platform scenario #903860 but bound to **no** rule); root `voximplant-ci/src/main.js` = unused (abandoned toy scaffold, unreferenced).
6. **ElevenLabs AgentsClient status: sandbox only.** The bridge (`VoiceAgentTest.voxengine.js`) runs exclusively on `kalfatest` rule 1520330, is reachable only via a gated ops script (`scripts/voximplant/bridge-test-call.ts`, `--confirm`, hard-refuses production rule 1494311 at lines 92-99), and no dispatcher path targets it. Production outbound RSVP calls use the separate DTMF+Groq stack.
7. **How outbound calls start:** pg-boss worker job `outreach-call-request` (`worker/main.ts`, `handleCallRequest`) → `dispatchOutreachCall` (`src/lib/data/outreach-calls.ts:109`) → gate chain (master switch → config → `liveCallsEnabled` → `hasCallConsent` → `isDncListed` → not-already-reached → campaign active → concurrency/hour caps → balance precheck) → atomic `createCallAttempt` → `startScenarios` (`src/lib/voximplant/mutations.ts`) with `rule_id` from `app_settings.voximplant_rule_id` and `script_custom_data` = `{to, from, tok, u}` (~110 bytes, built at `outreach-calls.ts:67-80`). `StartScenarios` is **never called from a Next.js request path** and **never retried** (`core.ts:175` — a blind retry could double-dial).
8. **Five most important integration gaps:**
   1. **The ElevenLabs bridge has no production path** — no dispatcher branch selects it, its API-key Secret is scoped to `kalfatest`, and the production scenario is a different codebase (DTMF+Groq). Anyone reading only `agent_configs/` would wrongly conclude ElevenLabs is live.
   2. **Monitor/takeover is DB scaffolding only** — `console_agent_layer` migrations (tables, trigger, realtime publication) exist with **zero** application code, no generated types, no UI, no routes (Section 7).
   3. **`schedule_callback` persists but nothing acts on it** — lands in `activity_log` + `call_attempts.callback_*`; no re-dispatch job, no operator surface (`/admin/callbacks` reads a different, writer-less table).
   4. **`call_analysis` linking is opportunistic** — orphan rows (null `event_id`) are invisible to owners under RLS and no backfill/linker job exists.
   5. **Config/document drift** — `pre_tool_speech` differs between `tool_configs/save_rsvp.json` and the live agent config; `language_presets` still greet as "Michal" after the persona became "מאושר" (male); `rsvp-conversation-design.md` and the json-reference "known-good" LLM table are stale; `.env.example` omits both ElevenLabs variables; ElevenLabs retention is unlimited (Section 10).

---

## SECTION 2: VOXIMPLANT APPLICATION AND RULE MAP

Source files: `voxfiles/applications/<app>/rules.config.json` (tracked) + `voxfiles/.voxengine-ci/applications/<app>/rules.metadata.config.json` (ids). Verified directly: `kalfa-rsvp` = `[{incoming, [], 97237219347}, {OutCall, [RSVP], .*}]`; `kalfatest` = `[{KALFA,[KALFA]}, {OutCallPreview,[RSVPPreview]}, {VoiceABTest,[VoiceABTest]}, {VoiceAgentTest,[VoiceAgentTest]}]` (all `.*`).

| File | Application | App ID | Rule | Rule ID | Scenario | Scenario ID | Pattern | Start mode | Scenario file | Classification |
|---|---|---|---|---|---|---|---|---|---|---|
| `voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/rules.config.json` | kalfa-rsvp.kalfarsvp.voximplant.com | 11107202 | `incoming` | 1494687 | — (none) | — | `97237219347` | inbound | — | **unused** (inbound rule with no scenario) |
| same file | kalfa-rsvp.kalfarsvp.voximplant.com | 11107202 | `OutCall` | 1494311 | `RSVP` | 907512 | `.*` | API-started (`StartScenarios`) | `voxfiles/scenarios/src/RSVP.voxengine.js` | **production** |
| `voxfiles/applications/kalfatest.kalfarsvp.voximplant.com/rules.config.json` | kalfatest.kalfarsvp.voximplant.com | 11107302 | `KALFA` | 1494315 | `KALFA` | 903861 | `.*` | call-list (tutorial) | `voxfiles/scenarios/src/KALFA.voxengine.js` | **legacy** |
| same file | kalfatest | 11107302 | `OutCallPreview` | 1520316 | `RSVPPreview` | 918268 | `.*` | API-started (manual) | `voxfiles/scenarios/src/RSVPPreview.voxengine.js` | **preview** |
| same file | kalfatest | 11107302 | `VoiceABTest` | 1520325 | `VoiceABTest` | 918274 | `.*` | API-started (manual) | `voxfiles/scenarios/src/VoiceABTest.voxengine.js` | **test** |
| same file | kalfatest | 11107302 | `VoiceAgentTest` | 1520330 | `VoiceAgentTest` | 918276 | `.*` | API-started (`bridge-test-call.ts`, gated) | `voxfiles/scenarios/src/VoiceAgentTest.voxengine.js` | **sandbox** (ElevenLabs bridge) |

Additional platform artifact: scenario **`Outgoingcall-RSVPAI`** (#903860) is deployed on the account but bound to **no rule** in either tracked `rules.config.json` → **legacy/unbound** (superseded predecessor of `RSVP.voxengine.js`; retains the older buggy `shuttingDown` hangup pattern its successor's comment at `RSVP.voxengine.js:135-140` describes fixing).

Deployment tooling: `@voximplant/voxengine-ci ^34.0.0` (`package.json:41`); `npx voxengine-ci upload --application-name <app> --rule-name <rule> [--dry-run]` from `voxfiles/`; credentials via `VOX_CI_CREDENTIALS`. `voxfiles/scenarios/dist/**` is **gitignored** (`.gitignore:62`) — the repo cannot prove byte-for-byte what is live-deployed; only a fresh CI run or the `.metadata.config.json` content hashes can (limitation, noted in Section 11). Root-level `voximplant-ci/` is an unreferenced abandoned scaffold (its `voximplant.json` gitignored at `.gitignore:67`) — **unused**.

---

## SECTION 3: SCENARIO INVENTORY

`voxfiles/scenarios/dist/**` exists locally but is **gitignored** — compiled outputs are not auditable from the repository; all rows below are `source` files. (voxengine-ci `dist` is a concatenated build of `src`; drift between a stale local `dist` and `src` cannot be ruled out from the repo.)

### Matrix

| Scenario (src) | Class | Startup | customData shape | PSTN | SDK call | Conference | Modules.ElevenLabs | createAgentsClient | initClientData | sendMediaBetween | Recording | AMD | DTMF | Client tools | Callbacks to KALFA | Persists via |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `RSVP.voxengine.js` | **production** | StartScenarios (rule 1494311) | `{to,from,tok,u}` | yes | no | no | no | no | no | no (uses `sendMediaTo(asr)`) | yes | no | yes (1/2/9) | no (Groq intent instead) | ctx GET + cb POST (recording_started, terminal, cancelled) | `webhook_inbox` drain |
| `Outgoingcall-RSVPAI.voxengine.js` | **legacy** (unbound) | none (no rule) | `{to,from,tok,u}` | yes | no | no | no | no | no | no | yes | no | yes | no | ctx + cb | same |
| `KALFA.voxengine.js` | **legacy** (stock tutorial) | CallList | CallList row | yes | no | no | no | no | no | no | no | no | no | no | none (CallList reportResult) | none |
| `RSVPPreview.voxengine.js` | **preview** | manual StartScenarios | `{to,from,tok,u}` | yes | no | no | no | no | no | no | yes (stereo/hd) | no | yes (1/2/3/0/9) | no | ctx only — **sends no cb** (lines 15-17) | none |
| `VoiceABTest.voxengine.js` | **test** | manual StartScenarios | `{to,from}` only | yes | no | no | no | no | no | no | no | no | no | no | none | none |
| `VoiceAgentTest.voxengine.js` | **sandbox** (EL bridge) | `bridge-test-call.ts` (rule 1520330, `--confirm`) | `{to,from,tok,u}` | yes | no | no | **yes** (line 59) | **yes** (387-408) | **yes** (420-446) | **yes** (line 449) | yes | **yes** (EU_GENERAL, fails open) | fallback path | **yes** — router lines 534-651 | ctx + additive `recording_started` cb (+ `el_conversation_id`) + agent-tool POSTs | agent-tool routes (sync + drain) |

*"SDK call" = accepts a Voximplant Web/mobile SDK leg — no scenario does; all are outbound `callPSTN`.*

### Detailed notes

**`RSVP.voxengine.js` — production.** Entry `AppEvents.Started` (line 2); parses `{to,from,tok,u}` from `VoxEngine.customData()` (280, 309-312); builds `ctx`/`cb` URLs (322-323); registers `AppEvents.HttpRequest` (326-339) as a **remote-hangup** hook — a POST to the call's `media_session_access_url` would send a `cancelled` callback and terminate. **Note: this hook is scenario-side only** — `media_session_access_url` is stored at dial time (`call-attempts.ts:399-406`) but no KALFA code ever reads or POSTs to it (verified by repo-wide grep) — remote hangup is `partially wired`. Fetches ctx (340) → `callPSTN(to, from)` (358) → ASR `ASRProfileList.Google.he_IL` with `singleUtterance:true` (360-364). TTS `VoiceList.Google.he_IL_Wavenet_A` (5). `Connected` (381): DTMF on, recording on, main message. `RecordStarted` (393) → non-terminal `recording_started` callback with `recording_url`. `PlaybackFinished` (402) → 700 ms echo-decay delay (406-409) → 6 s ASR window (180-186). `ASREvents.Result` (366) → `handleVoiceIntent` (208): transcript → Groq `llama-3.3-70b-versatile` (`api.groq.com/openai/v1/chat/completions`) → digit 1/2/9. `ToneReceived` (416) — DTMF equivalent. `finalizeChoice` (188) → `postFinalCallbackOnce({call_status:'completed', rsvp_digit, rsvp_method, …})` → `scheduleHangup(call, 2000)` — the 2 s grace + dedicated `finalHangupScheduled` flag (135-140) fixes a lived bug where completed calls stayed open ~44 s. `Failed`/`Disconnected` (429, 442): every terminal branch posts a callback then `VoxEngine.terminate()`. Timeout/teardown: per-branch; no ElevenLabs involvement anywhere.

**`VoiceAgentTest.voxengine.js` — sandbox, the ElevenLabs bridge.** Header (line 10) declares it non-production. AMD voicemail gate **before** the bridge (71-77, 296-345): `Modules.AMD` (string `'amd'` fallback — enum missing from bundled typings), `AMD.create({model: EU_GENERAL, timeout: 5000})` — the only model available, explicitly unvalidated for +972, **fails open** so a live person is never dropped. ElevenLabs key via `VoxEngine.getSecretValue('ELEVENLABS_API_KEY')` (259) — a Voximplant application Secret scoped to `kalfatest`. `ElevenLabs.createAgentsClient({xiApiKey, agentId:'agent_9701kxj3n54ye518a3s518cexd48', includeConversationId:true, onWebSocketClose})` (387-408). **Ordering constraint** (29-42): `conversationInitiationClientData({dynamic_variables})` must be the synchronous first WebSocket frame — after `ConversationInitiationMetadata` fires it is too late and all variables resolve empty. Audio bridge `VoxEngine.sendMediaBetween(call, agent)` (449). Barge-in fix: `Interruption` → `agent.clearMediaBuffer()` (460-479). Client-tool router (534-651): see Section 5; every `clientToolResult` **must** carry `is_error` or ElevenLabs closes the WS with code 1008 (573-577, live-verified). Terminal: `onWebSocketClose` → `scheduleHangup(call, 2000)`; global 150 s safety timeout (89; raised from 90 s after a real call was truncated). Reports `el_conversation_id` best-effort via the cb endpoint (196-214). Discrepancy note: it does **not** use the ctx `groq_key` (legacy Branch-B field) — Groq is irrelevant to the EL path.

**`RSVPPreview.voxengine.js` — preview.** DTMF-only (1/2/3/0/9), no ASR/Groq, fetches ctx but deliberately **posts no cb** (15-17) — can never mutate RSVP data; records `{stereo:true, hd_audio:true}` for human review; documents the SSML-read-literally gotcha (22-26, disproven live: Google he-IL `say()` speaks `<sub>` tags aloud — fix is niqqud-only pronunciation tuning).

**`VoiceABTest.voxengine.js` — test.** Hebrew TTS A/B (`he_IL_Wavenet_A` vs `he_IL_Chirp3_HD_Kore`); reads only `{to,from}`; no ctx/cb; no persistence.

**`KALFA.voxengine.js` — legacy.** Byte-level stock Voximplant CallList tutorial (`Modules.CallList`, `Modules.Player`, hardcoded `cdn.voximplant.com/3rd_template_en.mp3`, `reportResult`/`reportError`). Bound to a live kalfatest rule yet contains zero KALFA logic — bring-up leftover; risk: its name suggests importance it does not have.

**`Outgoingcall-RSVPAI.voxengine.js` — legacy.** Near-duplicate predecessor of `RSVP.voxengine.js` (voice `he_IL_Chirp3_HD_Aoede`, no transcript-turn array, and the old `state.shuttingDown` hangup guard that left lines open ~44 s). Deployed (#903860), bound nowhere.

---

## SECTION 4: ELEVENLABS AGENTSCLIENT WIRING

The "AgentsClient" is **VoxEngine's first-party `Modules.ElevenLabs` connector** running inside the Voximplant scenario sandbox — not an npm SDK, not a raw WebSocket, not SIP. (`@elevenlabs/elevenlabs-js ^2.58.0` in `package.json` serves only the Next.js admin dashboard + webhook-signature verification.)

| Item | Value | Evidence |
|---|---|---|
| `Modules.ElevenLabs` loaded | `VoiceAgentTest.voxengine.js:59` | sandbox scenario only |
| `createAgentsClient` call | lines 387-408 | `{xiApiKey, agentId, includeConversationId:true, onWebSocketClose}` |
| Agent ID source | **hardcoded literal** `agent_9701kxj3n54ye518a3s518cexd48` (line ~390) | matches `agents.json` id → `agent_configs/KALFA-RSVP-Preview.json` |
| API key source | `VoxEngine.getSecretValue('ELEVENLABS_API_KEY')` (line 259) — Voximplant application Secret, `kalfatest`-scoped | never in code/customData/logs; separate from the app's dashboard key |
| `onWebSocketClose` | hang up PSTN leg after `FAREWELL_GRACE_MS = 2000` (90-96, 175-188, 403-408) | fix for dead-air-until-150s bug (commit `bb32521`) |
| Dynamic-variable injection timing | `conversationInitiationClientData({dynamic_variables})` synchronously the instant the client promise resolves, **before** `sendMediaBetween` and before listeners (420-446; constraint documented 29-42) | first client WS frame or variables arrive empty |
| Injected variables | `guest_name, event_name, event_date, event_time, event_venue, event_address, event_celebrants, event_rsvp_deadline` (from ctx) + `kalfa_attempt_token` (correlation nonce) | ctx route `:83-112` |
| Audio bridge | `VoxEngine.sendMediaBetween(call, agent)` (449) | single bidirectional bind |
| Transcript listeners | agent-response/user-transcript client events consumed for scenario logging | config `client_events` lines 69-77 |
| Interruption / VAD | `Interruption` event → `agent.clearMediaBuffer()` (460-479); turn detection is ElevenLabs-side (`turn_model: turn_v3`, `turn_timeout: 4`, `turn_eagerness: normal`, 16 Hebrew backchannel ignore-terms) | config lines 11+ |
| Conversation ID capture | `includeConversationId:true` → `ConversationInitiationMetadata` (489-501) → `state.elConversationId` → reported once to cb as additive field (`reportConversationId`, 196-214) | second link vector |
| DTMF→userMessage mapping | fallback path in the sandbox scenario for non-speech guests | scenario DTMF fallback block |
| `end_call` behavior | ElevenLabs **system tool** — plays farewell (from its `message` param, per the anti-double-message prompt rule), server closes WS → `onWebSocketClose` → PSTN hangup after 2 s grace | Section 5; commits `15c6c27`, `bb32521` |
| Failure paths | tool reply without `is_error` ⇒ WS close 1008; WS close (any reason) ⇒ graceful hangup; AMD confident-voicemail ⇒ hangup pre-bridge; global 150 s timeout | 573-577; 89 |
| Teardown | every path converges on terminal cb (from the production pattern) or `scheduleHangup` + `VoxEngine.terminate()` | scenario terminal blocks |

**Chronological call sequence (sandbox bridge, as implemented):**

1. Operator runs `npm run bridge:test-call -- --attempt-id <id> --confirm` → `startScenarios(rule 1520330, {to,from,tok,u})` (`scripts/voximplant/bridge-test-call.ts:150`).
2. Scenario starts (`AppEvents.Started`), parses customData (218-257), `GET {u}/api/voximplant/ctx/{tok}` → guest/event fields + `kalfa_attempt_token`.
3. `callPSTN(to, from)`; on `Connected` → recording starts → `recording_started` cb (with `recording_url`).
4. AMD gate (5 s budget): confident `VOICEMAIL` ⇒ polite hangup, terminal cb; anything else ⇒ proceed (fail-open).
5. `createAgentsClient(...)` resolves → **synchronously** `conversationInitiationClientData({dynamic_variables})`.
6. `ConversationInitiationMetadata` → capture `conversation_id` → additive cb (`el_conversation_id`).
7. `sendMediaBetween(call, agent)` — conversation runs; `Interruption` ⇒ `clearMediaBuffer()`; guest DTMF handled via fallback.
8. Agent invokes client tools → scenario router POSTs to KALFA agent-tool endpoints → truthful `saved|rejected|queued` result returned as `clientToolResult` (always with `is_error`).
9. Agent calls `end_call(message=farewell)` → ElevenLabs plays farewell → closes WS.
10. `onWebSocketClose` → 2 s grace → PSTN hangup → terminal cb → `VoxEngine.terminate()`. (Safety: 150 s global timeout.)
11. Later, asynchronously: ElevenLabs `post_call_transcription` webhook → `/api/elevenlabs/rsvp/update` (HMAC) → `call_analysis` upsert, linked by `kalfa_attempt_token` nonce or `el_conversation_id`.

---

## SECTION 5: CLIENT TOOL ROUTER

Registered client tools: `agent.prompt.tool_ids` (config lines 152-157), definitions duplicated in `tool_configs/*.json` (pulled via `elevenlabs tools pull`, commit `15c6c27`). System tools (`built_in_tools`, lines 158+): `end_call`, `language_detection`, `skip_turn`, `voicemail_detection` — ElevenLabs-server behaviors, **not** routed through the scenario. Scenario router: single `ClientToolCall` listener + `TOOL_ROUTES` map (`VoiceAgentTest.voxengine.js:534-651`); unknown tools deliberately ignored (628-630); every reply carries `is_error` (578-589).

| Tool | Registered | Handled | Params (validated server-side) | Backend route | Result to agent | Idempotency (`webhook_inbox` dedupe) | Ultimate DB effect | Status |
|---|---|---|---|---|---|---|---|---|
| `save_rsvp` | config line 258; `tool_configs/save_rsvp.json` | scenario 535-546 | `voxSaveRsvpSchema` (`src/lib/validation/voximplant.ts:79-99`): `status ∈ attending/declined/maybe` (legacy `attending` bool accepted), `adults` 0-50, `children` 0-50; attending ⇒ ≥1 person | `POST /api/voximplant/agent-tool/rsvp/[token]` | **three-state** `{ok, status: saved\|rejected\|queued, reason?}` — `ok` true only for `saved`; HTTP 200 alone never means saved (route lines 90-120) | `vox-rsvp:{attemptId}:{sha256(status:adults:children)[:16]}` — distinct answer = new row, exact resend = no-op | `submit_rsvp` RPC (same as public form) via sync `processCallRsvp` + drain retry; `activity_log` `rsvp.from_call` / `rsvp.call_rejected` | **fully implemented** |
| `mark_dnc` | line 321; `tool_configs/mark_dnc.json` | scenario 548-551 | `voxMarkDncSchema` — **no identity params**; phone resolved server-side (attempt→contact→`normalized_phone`) | `POST .../agent-tool/dnc/[token]` | `{ok}` | `vox-dnc:{attemptId}` (one per attempt) | upsert `call_dnc_list` (the dispatcher's fail-closed DNC gate key) | **fully implemented** |
| `notify_owner` | line 347; `tool_configs/notify_owner.json` | scenario 553-564 | `voxNotifyOwnerSchema`: `kind ∈ question/message/flag`, `text` ≤500 | `POST .../agent-tool/note/[token]` | `{ok}` | `vox-note:{attemptId}:{sha256(kind:text)[:16]}` | `activity_log` `call.owner_note` (never phone/transcript/recording) | **fully implemented** |
| `schedule_callback` | line 400; `tool_configs/schedule_callback.json` | scenario 602-626 | `voxCallbackRequestSchema` (`validation/voximplant.ts:61`): `callback_when_text` required, `callback_iso` optional | `POST /api/voximplant/cb/[token]` (**reuses cb**, not the agent-tool router; handled out-of-band, never queued to `webhook_inbox`) | `{ok}` | n/a (out-of-band by design — cannot corrupt `call_attempts.status`) | `recordCallbackRequest` (`call-attempts.ts:502`): `activity_log` `call.callback_requested` + `call_attempts.callback_requested_at/when_text/iso` | **partially implemented** — persisted, but **no re-dispatch job and no operator UI** (code comment: "Re-enqueuing the actual call is a KALFA dispatcher follow-up") |
| `end_call` | system tool (line 159+) | not routed (server-side) | `message` param = farewell text | — | — | — | none directly; WS close → scenario hangup | implemented (system) |

Shared route guard: `guardAgentToolRequest` (`src/lib/voximplant/agent-tool-guard.ts:20-58`) — fail-closed rate limit 30/5 min (IP + token fingerprint), per-route body caps (rsvp 16 KB / dnc 4 KB / note 8 KB), opaque-token → `call_attempts` resolution (identity **never** from the body), token-expiry check.

Historical note (root of the "queued false promise"): every failure used to collapse to `queued` and the agent said "נרשם" with nothing written (`submit_rsvp` legitimately refuses past-dated/closed events → `closed`/`deadline_passed`). Current contract distinguishes `rejected` (terminal business refusal — agent must not claim success; prompt Guardrail gates "נרשם" on `saved`) from `queued` (transient, durably retried by the drain). Fixed across commits `292a9d9`, `859d1ab`.

---

## SECTION 6: BACKEND API CONTRACT MAP

**Requested-route existence verdicts** (full `find` over `src/app/api`):

| Requested | Verdict |
|---|---|
| `/api/voximplant/ctx/**` | FOUND — `src/app/api/voximplant/ctx/[token]/route.ts` |
| `/api/voximplant/cb/**` | FOUND — `src/app/api/voximplant/cb/[token]/route.ts` |
| `/api/voximplant/agent-tool/**` | FOUND — `rsvp/[token]`, `dnc/[token]`, `note/[token]` |
| `/api/calls/outbound` | **NOT FOUND** (no `src/app/api/calls/` directory exists) |
| `/api/calls/[id]/monitor` | **NOT FOUND** |
| `/api/calls/[id]/agent-command` | **NOT FOUND** |
| `/api/agents/status` | **NOT FOUND** (no `src/app/api/agents/`) |
| `/api/campaigns/[id]/start` | **NOT FOUND** — campaigns has only `authorize`, `close-charge`, `whatsapp-send`; there is **no** call-campaign start/pause/dispatch HTTP endpoint anywhere; call dispatch is worker-internal |
| `/api/campaigns/[id]/pause` | **NOT FOUND** |

All voice routes: `runtime='nodejs'`, `dynamic='force-dynamic'`, `Cache-Control: no-store` per-response plus a config-layer no-store on `/api/voximplant/:path*` (`next.config.ts:105-107`).

| Route | Method | AuthN | AuthZ / identity | Request schema | Response | Downstream | DB | Idempotency | Errors | State | Class |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/api/voximplant/ctx/[token]` (L1-115) | GET | opaque per-call `access_token` (128-bit) in path; RL 12/5min fail-closed | token-resolved `call_attempts` row; expiry, event `active`, non-terminal, Groq key present | none (path only) | invitation fields + `groq_key` + `kalfa_attempt_token` (L83-112) | none | reads `call_attempts`/`events`/`guests.full_name` (service-role); no writes | read-only | every failure ⇒ identical generic 404; 429 | production-ready | production |
| `/api/voximplant/cb/[token]` (L1-147) | POST | same token model; RL 30/5min; cap 256 KB | token row; body `invitation_id` sanity-checked vs attemptId (400 on mismatch, L109-111), never identity | `voxCallbackRequestSchema` first (schedule_callback, out-of-band) then `voxCallbackSchema` (strictObject + refine) | `'ok'` | none | `webhook_inbox` (`vox-cb:{attemptId}:{call_status}`); `recordCallbackRequest`; `setElConversationId` best-effort | `UNIQUE(provider, dedupe_key)`; persist-then-process | 400/404/413/429/500 | production-ready | production |
| `/api/voximplant/agent-tool/rsvp/[token]` (L1-121) | POST | `guardAgentToolRequest` (RL 30/5min, 16 KB) | token row only | `voxSaveRsvpSchema` | `{ok, status: saved\|rejected\|queued, reason?}` | none | inbox + sync `processCallRsvp` → `submit_rsvp` RPC | value-hash dedupe + CAS outcome guard | 400/404/413/429/500 | production-ready | sandbox-consumer (EL bridge) |
| `/api/voximplant/agent-tool/dnc/[token]` (L1-83) | POST | guard (4 KB) | token row; no identity in body | `voxMarkDncSchema` | `{ok}` | none | inbox + `processCallDnc` → `call_dnc_list` | `vox-dnc:{attemptId}` | same | production-ready | sandbox-consumer |
| `/api/voximplant/agent-tool/note/[token]` (L1-88) | POST | guard (8 KB) | token row | `voxNotifyOwnerSchema` | `{ok}` | none | inbox + `processOwnerNote` → `activity_log` | value-hash dedupe | same | production-ready | sandbox-consumer |
| `/api/voximplant/account-callback/[token]` (L1-99) | POST | our opaque token vs stored **SHA-256 hash**, constant-time (`safeTokenEqual`, L63); RL 20/5min + verified-pull 2/60s; 64 KB | n/a (account-level) | `normalizeAccountCallbackEnvelope` (untrusted poke; balance always re-verified via `GetAccountInfo`) | 200 past gates (L98) | Voximplant Management API; Slack | `stampBalanceCallbackReceived` | poke-idempotent | 404 (incl. unwired), 413/429 | **dark until armed** (`voximplant_account_callback_token_hash`) | partially wired (arming = live state, UNKNOWN) |
| `/api/elevenlabs/rsvp/update` (L1-84) | POST | HMAC-SHA256 over raw body (`ElevenLabs-Signature: t=…,v0=…`; secret `ELEVENLABS_WEBHOOK`; 30-min tolerance; `timingSafeEqual`); RL 300/60s; 256 KB | n/a (workspace webhook) | `normalizeCallAnalysisWebhook` (`post_call_transcription` only; audio ignored) | `ok` | Slack on store failure | `storeCallAnalysis` upsert `call_analysis` | `UNIQUE(provider, conversation_id)` | uniform 401; 413/429/500 | **dark until armed** (env + EL `post_call_webhook_id`) — and **misnamed: it does not update RSVP** (metadata-only QA) | partially wired (arming = live state, UNKNOWN) |
| `/api/campaigns/[id]/authorize` (L1-239) | POST | `requireUser` session + CSRF `isAllowedOrigin` | `requireOwnedEvent` | `authorizeHoldSchema` | 303 | SUMIT J5 hold | campaigns lock/prepare | atomic `lockCampaignForHold` | query-encoded | production-ready | production (billing, not voice) |
| `/api/campaigns/[id]/close-charge` (L1-60) | POST | session + `isAdmin` + origin | platform admin | — | 303 | SUMIT charge (server-derived amount) | campaigns | atomic | — | production-ready | production (billing) |
| `/api/campaigns/[id]/whatsapp-send` (L1-80) | POST | session + origin | `requireOwnedEvent` | `whatsappSendSchema` | 303 | Meta Cloud API | campaign send state | engine-level | — | production-ready | production (WhatsApp; **the only owner-facing send trigger — no AI-call equivalent exists**) |

**Android client contract:** **NOT FOUND.** Repo-wide `grep -riE 'android|kotlin|okhttp|swift|react-native|mobile app'` over `src/` and `supabase/` yields zero application hits (only Voximplant SDK type stubs, an ElevenLabs doc map, and a WhatsApp OTP research note). No Android/mobile client contract exists in this repository, so no route can be judged against one.

---

## SECTION 7: MONITOR AND TAKEOVER

Evidence clusters: (1) `supabase/migrations/20260720025656_console_agent_layer.sql` (L1-106) + `20260720025745_console_agent_layer_hardening.sql` — creates `console_agents` (RLS L3-16), `agent_status` (status CHECK `ready/not_ready/dnd/in_call`, L18-29), `console_call_feed` (PK `call_attempt_id`→`call_attempts`, `handled_by text DEFAULT 'ai'`, nullable `agent_id` **with no FK**, L31-46), trigger `sync_console_call_feed` mirroring `call_attempts` (L53-80), 3 views (L82-99), realtime publication for `agent_status` + `console_call_feed` (L104-105), `is_console_agent()` (L11-13). (2) **Zero** application references: grep for `console_call_feed|console_agents|agent_status|is_console_agent|handled_by` outside the migrations is empty; the tables are absent from `src/lib/supabase/types.ts` (types never regenerated); migrations were applied out-of-band (commit `b8f4a06`). (3) Every `monitor`/`takeover`/`conference` hit is in `docs/voximplant/research|digest-*` and is explicitly framed as future capability. (4) Scenario media wiring is 1:1 AI-bridge only — no `createConference`, no viewer leg, no `stopMediaTo(agent)`, no second/human leg in any scenario.

1. Live monitoring implemented? **NOT FOUND** (inert DB scaffold + realtime publication; nothing subscribes; no audio path; no UI).
2. Human takeover implemented? **NOT FOUND** (`handled_by` defaults `'ai'`; `agent_id` never written; no reassignment logic).
3. Human SDK call connected to an active PSTN call? **NOT FOUND**.
4. Conference used? **NOT FOUND** in code; research docs only.
5. AI media stopped during takeover? **NOT FOUND** (no takeover; `clearMediaBuffer` at `VoiceAgentTest.voxengine.js:471` is intra-turn barge-in, not handoff).
6. Human can return the call to AI? **NOT FOUND**.
7. `POST /api/calls/{id}/monitor` does? **The route does not exist** (no `src/app/api/calls/`).
8. Data returned? **N/A** — route absent.
9. Correlation identifiers: attempt↔Voximplant = `call_attempts.vox_call_session_history_id` (written by `recordDialConfirmed`, `call-attempts.ts:397-415`) + `media_session_access_url`; attempt↔ElevenLabs = `el_correlation_nonce` (surfaced as `kalfa_attempt_token`, ctx L111, echoed by the post-call webhook) **and** `el_conversation_id` (cb L137-143 → `setElConversationId` L477-493); attempt↔human-agent call = **no identifier exists** (`console_call_feed.agent_id` is an unpopulated placeholder).
10. Missing for real monitoring+takeover: the HTTP surface (`/api/calls/*`, `/api/agents/status`); a console UI; a typed DAL + realtime subscription (types regeneration); agent enrollment population (`console_agents.vox_username`); a VoxEngine re-architecture (Conference or viewer-mode listen-in, `stopMediaTo(agent)` detach, human dial-in leg); AI suspend/resume logic; a human-leg link column.

Comment-vs-code: the migration's "Agent console layer" title describes intent; the executable content delivers only schema. No code comment overstates a working feature.

---

## SECTION 8: DATA MODEL AND CORRELATION

**RLS posture (load-bearing recent change):** `supabase/migrations/20260720030121_strip_staff_axis_from_customer_tables.sql` dropped the `has_role(admin)` policies off customer tables — staff now read via `createAdminClient` (service_role) behind `requirePlatformPermission` + `recordStaffAccess`. Net effect per table: `call_attempts` → **deny-all-authenticated** (`call_attempts_admin_read` dropped; the token/transcript/recording columns have no authenticated RLS read path at all — tightest posture); `call_analysis` → `call_analysis_owner_select` **survives** (`can_access_event(event_id,'campaigns','view')`), `admin_select` dropped; `vox_log_exports_admin_read` **survived** the strip (not in the drop list) and is now **vestigial** — the dashboard reads via service_role; `call_dnc_list_admin_all` survives; `contacts_admin_all` dropped (org/owner policy remains; `call_consent_at` written only by the SECURITY DEFINER `submit_rsvp`).

**Identifier-exposure discipline:** the ctx route is the **only** place a correlation id crosses to an external system — `el_correlation_nonce` as `kalfa_attempt_token` (ctx L111), explicitly non-authorizing (migration `20260719162804` header). The ElevenLabs webhook normalizer reads back **only** that token from `dynamic_variables`; transcript, summary, and every guest-bearing variable are dropped pre-persistence (`elevenlabs-payloads.ts`).

| Field / table | Where | Migration | Writer | Reader | RLS | Android | Correlation role |
|---|---|---|---|---|---|---|---|
| `call_attempts` (row per outbound attempt) | table | `20260714160000_voximplant_bridge.sql` | `createCallAttempt` (`call-attempts.ts:48`, upsert on `UNIQUE(campaign_id,contact_id,touchpoint_index)`) | ctx/cb/agent-tool routes; admin voice DAL | service-role DAL + admin-gated surfaces; owner reads via admin views only | no client exists | the hub — every other id hangs off `call_attempts.id` |
| `call_attempts.access_token` + `token_expires_at` | columns | same | `dispatchOutreachCall` (`randomBytes(16).hex`, `outreach-calls.ts:185`; TTL 2 h `CALL_TOKEN_TTL_SEC`) | `getCallContextByAccessToken` / `getCallAttemptByAccessToken` / guard | never exposed to UI (presence-only booleans in admin DAL, `voice-ops.ts:265-286`) | — | the per-call bearer credential for ctx/cb/agent-tool |
| `call_attempts.vox_call_session_history_id` | column | same | `recordDialConfirmed` from `StartScenarios` result (`call-attempts.ts:397-415`) | log-export cron; `/admin/recordings?session=` link | as above | — | attempt ↔ Voximplant session/logs/recording |
| `call_attempts.media_session_access_url` | column | same | dial confirmation (`call-attempts.ts:399-406`) | **nobody** — the scenario's remote-hangup hook awaits a caller that does not exist | never exposed | — | control-plane handle to the live call (**reserved/unwired**; `billed_outcome` similarly defined-but-unwritten) |
| `call_attempts.el_correlation_nonce` | column + partial unique index | `20260719162804` | `stampElCorrelationNonce` (`call-attempts.ts:450`) | ctx route (as `kalfa_attempt_token`); `storeCallAnalysis` lookup | as above | — | attempt ↔ ElevenLabs conversation, vector 1 (pre-injected, webhook-echoed) |
| `call_attempts.el_conversation_id` | column | `20260719180805` | `setElConversationId` (cb route best-effort, `call-attempts.ts:477-493`) | `storeCallAnalysis` fallback lookup | as above | — | attempt ↔ ElevenLabs conversation, vector 2 |
| `call_attempts.callback_requested_at/when_text/iso` | columns | `20260719180805` | `recordCallbackRequest` (`call-attempts.ts:502`) | **nothing operator-facing** | as above | — | schedule_callback persistence (dead-ends; Section 5) |
| `call_attempts.recording_url`, `recording_started_at` | columns | `20260714160000` | cb route after `validateRecordingUrl` SSRF gate (allowlist `storage-gw-[a-z]{2}-\d{2}\.voximplant\.com`, `recording-url.ts:18`) | `/admin/recordings` only (`listCallRecordings`, gated `view_recordings`, `voice-ops.ts:510`) | admin-gated; presence-only elsewhere | — | evidence/audit |
| `call_attempts.transcript` | column | same | cb route (`{speaker,text,at}[]` or legacy string) | presence-only boolean in admin DAL | never returned as value except nowhere — no UI shows it | — | evidence |
| `call_analysis` | table | `20260719154428` + QA cols `20260719170227` | `storeCallAnalysis` (`elevenlabs-analysis.ts:15`, upsert `UNIQUE(provider,conversation_id)`, `ignoreDuplicates`) | admin voice surfaces | owner RLS via `can_access_event(event_id,'campaigns','view')`; **orphans (null `event_id`) invisible to owners** | — | ElevenLabs QA metadata; linked by nonce → conversation_id |
| `call_dnc_list` | table | Voximplant B1 wave | `processCallDnc` (service-role; reason `'בקשת אורח בשיחה קולית'`) + admin `addToCallDnc` (cookie client, records `added_by`) | dispatcher gate `isDncListed` (fail-closed, `outreach-engine.ts:191`); `/admin/dnc` | `call_dnc_list_admin_all` (has_role admin) | — | PK `normalized_phone` (E.164) |
| `contacts.call_consent_at` | column | `20260714193500_voximplant_b1_rsvp_call_consent.sql` | public RSVP form via `submit_rsvp` `_call_consent` param (`rsvp.ts:170`) | `hasCallConsent` (`outreach-engine.ts:174`, fail-closed; also requires `!removal_requested`) | contacts RLS (owner-scoped) | — | legal gate for dialing |
| `webhook_inbox` (voice kinds `call_result/call_rsvp/call_dnc/call_owner_note`) | table | `202606290035` + `…0036` (claim skip-locked) | voice routes | 1-min worker drain (`processWebhookEvent`) | service-role only | — | durability + idempotency (`UNIQUE(provider,dedupe_key)`; `message_id` = token-verified attempt id) |
| `activity_log` voice actions (`rsvp.from_call`, `rsvp.call_rejected`, `call.owner_note`, `call.callback_requested`) | rows | existing table | `recordRsvpFromCall`/`recordRsvpCallRejected`/`processOwnerNote`/`recordCallbackRequest` | event activity surfaces | event-scoped RLS | — | auditability, PII-safe |
| `vox_log_exports` | table | `20260719104000_voice_ops_dashboard.sql` | daily log-export cron (`vox-log-export.ts`) | `getLogExportStatus` → `/admin/voice/platform` | admin | — | session-log archival tracking (bucket `vox-call-logs`, 180-day retention) |
| `app_settings` voice columns | singleton | several | `/admin/channels` actions (`actions.ts:81-190`), key form | `getVoximplantConfig`/`getVoximplantGroqKey`/`getElevenLabsApiKeyWithSource` | admin-only RLS | — | all platform wiring config (names in Section 6 of the app map; includes `voximplant_rule_id`, `voximplant_live_calls`, `elevenlabs_api_key`, account-callback hash family) |
| `console_call_feed.handled_by` / `agent_id`, `console_agents`, `agent_status` | tables | `20260720025656` + hardening | **nobody** | **nobody** (absent from types.ts) | RLS defined in-migration | — | takeover placeholders — unwired (Section 7) |
| `kalfa_attempt_token` | **not a column** — wire alias of `el_correlation_nonce` | — | — | — | — | — | naming note: exists only in the ctx JSON + dynamic variables |
| conference ID / takeover timestamps | — | — | — | — | — | — | **NOT FOUND** anywhere |

**End-to-end correlation verdict: sufficient for the AI-only flow** — the model is star-shaped around `call_attempts.id` (the only join key): one row joins campaign/contact/guest/event (FKs), the Voximplant session (`vox_call_session_history_id`), the recording/log artifacts, and the ElevenLabs conversation (nonce + conversation-id, either direction); the nonce is minted for **every** dispatched attempt (`outreach-calls.ts:190`), so every real call is link-ready. Three named gaps:
1. **Orphan `call_analysis` rows are terminal.** Linking is inline-at-insert only (`elevenlabs-analysis.ts:39-45`); if the webhook wins the race or neither vector matched, `call_attempt_id`/`event_id` stay NULL forever — invisible to owners under RLS and (post-strip) reachable only via service_role. Migrations twice promise "a linker"; none exists.
2. **No stored Voximplant↔ElevenLabs edge** — they correlate only *through* `call_attempts`, and both link writes are best-effort with swallowed errors (`cb/[token]/route.ts:141`, `elevenlabs-analysis.ts:46`) — a failed write silently and unobservably breaks the tie (no alerting).
3. **Human-in-the-loop is unmodeled** — no `conference_id`, no takeover timestamps, no `taken_over_by`; `console_call_feed.handled_by`/`agent_id` are unwritten placeholders (Section 7).

---

## SECTION 9: PRODUCTION FLOW

The flow below is the **production** path (DTMF+Groq `RSVP.voxengine.js`); ElevenLabs-bridge deviations are bracketed.

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 1 | Call creation | **IMPLEMENTED** | step engine `prepareAndSendStep` enqueues pg-boss `outreach-call-request` → `handleCallRequest` (`worker/main.ts:91`) → `dispatchOutreachCall` gate chain → atomic `createCallAttempt` |
| 2 | `script_custom_data` construction | **IMPLEMENTED** | `buildScriptCustomData` `{to,from,tok,u}` ~110 B (`outreach-calls.ts:67-80`); no secrets |
| 3 | Context fetch | **IMPLEMENTED** | scenario → `GET /api/voximplant/ctx/{tok}`; token-gated, generic-404, Groq key delivered here |
| 4 | PSTN dial | **IMPLEMENTED** (dark-gated) | `callPSTN` (`RSVP.voxengine.js:358`); requires `liveCallsEnabled` = env AND DB toggle — current toggle state **UNKNOWN (live state)** |
| 5 | Answer + AMD | **PARTIAL** | production scenario has **no AMD**; AMD exists only in the sandbox bridge (EU_GENERAL, fails open, unvalidated for +972) — TEST ONLY there |
| 6 | ElevenLabs client creation | **TEST ONLY** | `VoiceAgentTest.voxengine.js:387-408`, kalfatest rule 1520330 only |
| 7 | Personalization | **IMPLEMENTED** (prod: ctx fields into TTS script) / **TEST ONLY** (EL dynamic_variables) | ctx route :83-112; `conversationInitiationClientData` 420-446 |
| 8 | Media bridge | **IMPLEMENTED** (prod: `sendMediaTo(asr)`) / **TEST ONLY** (`sendMediaBetween(call, agent)`) | `RSVP.voxengine.js:360-364`; `VoiceAgentTest:449` |
| 9 | Tool calls | **TEST ONLY** (client tools) — production equivalent is DTMF/Groq intent → cb, **IMPLEMENTED** | Section 5 |
| 10 | Callback persistence | **IMPLEMENTED** | cb → `webhook_inbox` → 1-min drain → `processCallResult` (status CAS, billing `writeReach`, RSVP `submit_rsvp`); agent-tool = sync + drain backstop |
| 11 | Transcript / post-call processing | **PARTIAL** | prod transcript array via cb = IMPLEMENTED; daily log-export cron = IMPLEMENTED; ElevenLabs `post_call_transcription` → `call_analysis` = implemented but **dark until armed** + linker gap; reconcile cron alert-only |
| 12 | Call termination | **IMPLEMENTED** | every terminal branch posts cb then terminates; hangup-grace fixes (`RSVP:135-140`; `bb32521` for the bridge); remote hangup via `media_session_access_url` |
| 13 | Android visibility | **NOT FOUND** | no Android/mobile client exists in this repo (Section 6) |

---

## SECTION 10: CONFIGURATION PROVIDED BY OWNER

Baseline: the owner-supplied summary of the ElevenLabs agent. Comparison target: `agent_configs/KALFA-RSVP-Preview.json` (57,924 bytes) — **agent-ID confirmation: yes**: `agents.json` maps `agent_9701kxj3n54ye518a3s518cexd48` → this file (version `agtvrsn_6901kx…`, branch `agtbrch_4101kx…`), and `VoiceAgentTest.voxengine.js` hardcodes the **same** agent id — the VoxEngine bridge provably talks to this configuration.

| Owner claim | Repo verdict | Evidence (config line) |
|---|---|---|
| name "KALFA RSVP Preview" | **match** | `name` field; `agents.json` |
| ASR input `pcm_16000` | **match** | `user_input_audio_format` line 7 |
| TTS output `pcm_16000` | **match** | `agent_output_audio_format` line 56 |
| language Hebrew | **match** | `language: "he"` line 126 |
| tools: save_rsvp, mark_dnc, notify_owner, schedule_callback, end_call | **match** (4 client tools via `tool_ids` lines 152-157; `end_call` is a **system** `built_in_tool`, not a client tool — a category nuance, not a mismatch) | lines 152-209+ |
| dynamic variables: guest_name, event_name, event_date, event_venue, event_time, event_address, event_celebrants, event_rsvp_deadline | **match — all 8 declared** | `dynamic_variable_placeholders` lines 128-138 |
| monitoring_enabled: false | **match** | line 82 |
| client events include transcript + response events | **match** | `client_events` lines 69-77: `audio, interruption, agent_response, user_transcript, agent_response_correction, agent_tool_response, agent_chat_response_part` |
| voice recording enabled | **match** | `record_voice: true` line 769 |
| no retention limit | **match — and flagged as a risk** | `retention_days: -1`, `delete_transcript_and_pii: false`, `delete_audio: false` lines 769-771 |

**Beyond the owner's summary — findings the owner list does not capture:**

- **Undeclared 9th variable:** `kalfa_attempt_token` is injected every call (correlation nonce) but is not in `dynamic_variable_placeholders` — works, but invisible in the declared contract.
- **Unused variable risk — `language_presets` drift:** en/ru/ar `first_message` overrides (lines 95-120) still introduce the agent as "Michal"/"Михаль"/"ميخال" while the Hebrew persona is now "מאושר" (male). `language_detection` is a live system tool, so these stale presets are reachable in a real call.
- **Tool contract drift:** `tool_configs/save_rsvp.json` has `force_pre_tool_speech: false / pre_tool_speech: "auto"` while the live agent's embedded copy (lines ~262-268) has `true` / `"force"` — unresolved drift between the tool registry and the agent.
- **LLM/params (owner summary silent):** `llm: claude-haiku-4-5` (line 147; switched from gemini-2.5-flash in `15c6c27` after benchmarking), `temperature 0.56`, `thinking_budget: 0` (**load-bearing** — absent it, chain-of-thought was spoken aloud in English; commits `10d07cb`, `c7f805f`), `turn_timeout: 4` (line 11), `turn_eagerness: normal`, TTS `eleven_v3_conversational` (the only Hebrew-documented model) voice `eac91g6mnNRvS4L6tF5P`.
- **Privacy/retention risks:** ElevenLabs retains full audio + transcript **indefinitely** (`retention_days: -1`) while KALFA's own pipeline is deliberately metadata-only; `enable_auth: false` + empty allowlist means possession of the workspace API key is the only gate on the agent; all 7 content-moderation categories are disabled (focus + prompt-injection guardrails are enabled). These are configuration decisions that should be made explicitly, with tikun-13 (Israeli privacy) exposure in mind.
- **Testing surface:** only 1 of 18 locally-authored agent tests is attached to the live agent (`platform_settings.testing`, line 695 vs `docs/voice-agent/tests/`).

---

## SECTION 11: REQUIRED INFORMATION FROM THE OWNER

Facts a repository audit cannot establish, phrased as direct questions:

1. Is `app_settings.voximplant_live_calls` currently **true** in the production database (i.e., is the production DTMF flow actually dialing today)? And is `VOXIMPLANT_LIVE_CALLS` set in the beta/production runtime env?
2. What is the live value of `app_settings.voximplant_rule_id` — is it 1494311 (`kalfa-rsvp`/`OutCall`) as the repo implies?
3. Is `voximplant_account_callback_token_hash` set (is the account-callback route armed), and was `SetAccountInfo` actually pointed at it?
4. Is `ELEVENLABS_WEBHOOK` set in the runtime env, and is a `post_call_webhook_id` wired on the ElevenLabs workspace to `https://<origin>/api/elevenlabs/rsvp/update`?
5. Does the deployed content of scenarios on the Voximplant account match `voxfiles/scenarios/src/**` (dist is gitignored — was the last `voxengine-ci upload` run from this exact tree)?
6. Should the orphaned platform scenario `Outgoingcall-RSVPAI` (#903860) and the tutorial `KALFA` rule/scenario be deleted from the account?
7. Is the `console_agent_layer` schema (applied out-of-band, commit `b8f4a06`) an active external workstream (e.g., an Android/console client developed outside this repo), or should it be reverted until the app-side implementation lands?
8. Where does the `elevenlabs` CLI get its API key on the machines where `agents pull/push` is run (env var? CLI config outside the repo)?
9. Was the leaked Groq key (noted pending rotation) actually rotated, and is `app_settings.voximplant_groq_api_key` the new one?
10. Is ElevenLabs' unlimited retention (`retention_days: -1`, audio + transcript) an accepted, documented decision under the privacy policy, or should a retention limit / zero-retention be configured?
11. Which external system (if any) writes `callback_requests` (read by `/admin/callbacks`)? No writer exists in this repo.
12. Is the `pre_tool_speech: force` on the live `save_rsvp` embedded tool intentional (vs the registry copy's `auto`)?
13. Are the 17 unattached agent tests meant to be pushed/attached to the live agent?
14. Is a human agent console / monitoring / takeover capability actually planned next (which would justify the console scaffold), and if so for which client (web admin? mobile?)?
15. Is a `call_analysis` orphan-backfill linker planned? (Today orphans are permanent and unobservable — the highest-value data gap if owners are meant to see call QA.)
16. Should there be alerting when an ElevenLabs link-write fails (both vectors are best-effort with swallowed errors — silent orphan creation is currently invisible)?
17. `vox_log_exports_admin_read` (has_role admin) survived the staff-axis strip while the equivalent policies on `call_attempts`/`call_analysis` were dropped — intentional, or a leftover to reconcile (the policy is currently dead; the dashboard reads via service_role)?
18. Are `call_attempts.media_session_access_url` (remote-hangup handle, scenario hook ready, no app caller) and `billed_outcome` (defined, never written) reserved for planned work, or dead columns to remove?

---

## SECTION 12: FINAL VERDICT

**Current production architecture.** A fully autonomous, worker-driven outbound RSVP caller: pg-boss → `dispatchOutreachCall` (consent + DNC + caps + balance gates, all fail-closed) → `StartScenarios` on `kalfa-rsvp`/`OutCall` (1494311) → `RSVP.voxengine.js` (Google he-IL TTS/ASR + Groq digit-intent + DTMF) → token-gated `ctx`/`cb` endpoints → `webhook_inbox` → 1-minute drain → `submit_rsvp` RPC + billing + activity log. Ops observability: balance/reconcile/log-export/quota crons + Slack alerts + `/admin/voice` dashboards. **ElevenLabs is a parallel sandbox track**, production-shaped on the app side (agent-tool routes are production-quality) but reachable only through the kalfatest bridge scenario by manual gated script.

**Genuinely working (evidence-backed):** the entire Branch-B DTMF+Groq loop end-to-end; the token/ctx/cb trust model; persist-then-process with real idempotency; the three-state `save_rsvp` contract with sync-apply + drain backstop; DNC and consent gates; recording/log SSRF-hardened archival; admin voice ops; the ElevenLabs bridge itself as a sandbox (AMD gate, dynamic variables, barge-in, tool router, correlation vectors, post-call analysis path).

**Test-only:** everything ElevenLabs-facing at the call layer (`VoiceAgentTest`, rule 1520330, `bridge-test-call.ts`); `RSVPPreview`; `VoiceABTest`.

**Pretending to work but incomplete:**
- `console_agent_layer` — schema + realtime publication with **zero** consuming code (the trigger now fires on every `call_attempts` write into a table nobody reads).
- `schedule_callback` — captured and persisted, then dead-ends (no re-dispatch, no UI).
- `call_analysis` linking — works only when a vector matches at webhook time; orphans invisible to owners, no backfill.
- `/api/elevenlabs/rsvp/update` — name promises an RSVP update; it is a metadata-QA sink (rename candidate).
- Two dark-until-armed webhook surfaces (account-callback, EL post-call) whose armed state the repo cannot prove.

**Exact next implementation milestone** (if the goal is ElevenLabs in production): *promote the bridge to a config-selected production path.*
Files that change in that milestone:
1. `src/lib/data/outreach-calls.ts` — rule selection by channel config (`voximplant_rule_id` vs a new `voximplant_el_rule_id`), keeping the gate chain identical.
2. `supabase/migrations/<new>` — the `app_settings.voximplant_el_rule_id` (or equivalent scenario-selector) column.
3. `voxfiles/scenarios/src/` — promote/rename the bridge scenario off the `*Test` name; bind a new rule on `kalfa-rsvp`; create the `ELEVENLABS_API_KEY` Secret on the production application.
4. `agent_configs/KALFA-RSVP-Preview.json` — fix `language_presets` persona lines; resolve the `pre_tool_speech` drift (via `pull --update`, never hand-edit); revisit `retention_days`.
5. `src/lib/supabase/types.ts` — regenerate (also decides the console scaffold's fate).
6. `docs/voice-agent/rsvp-conversation-design.md` + `elevenlabs-json-reference.md` §6.5 — un-stale.
7. `.env.example` — add `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK`.

**Risks that must block deployment:** unlimited ElevenLabs retention unresolved (privacy/tikun-13); Groq key rotation unconfirmed; stale "Michal" language presets reachable via live `language_detection`; the 8.1 s `save_rsvp` turn-commit latency (upstream ElevenLabs behavior — guest-audible dead air at the most fragile moment); AMD unvalidated for +972 (fails open — voicemails may get full AI calls, a cost + consent-optics issue); no monitoring/takeover of a live AI call (the console scaffold is not a feature) and no remote-hangup caller (`media_session_access_url` unused); silent, unalerted `call_analysis` orphan creation (both link vectors best-effort, errors swallowed); `voxCallbackSchema` strictObject vs deployed-scenario payload drift would produce silent 400s (dist unauditable); and the standing legal gate — B1 consent (`call_consent_at`) capture must precede any live dialing.

---

### Evidence index (compact)

**Voximplant platform:** `voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/{application,rules}.config.json` · `voxfiles/applications/kalfatest.kalfarsvp.voximplant.com/{application,rules}.config.json` · `voxfiles/.voxengine-ci/applications/*/rules.metadata.config.json` · `voxfiles/scenarios/src/{RSVP,Outgoingcall-RSVPAI,KALFA,RSVPPreview,VoiceABTest,VoiceAgentTest}.voxengine.js` · `typings/voxengine.d.ts` · `voximplant-ci/src/main.js` (orphan)
**ElevenLabs agent:** `agents.json` · `agent_configs/KALFA-RSVP-Preview.json` · `tool_configs/{save_rsvp,mark_dnc,notify_owner,schedule_callback}.json` · `docs/voice-agent/{elevenlabs-json-reference,rsvp-conversation-design,agent-testing-methodology}.md` · `docs/voice-agent/tests/*`
**API routes:** `src/app/api/voximplant/{ctx,cb,account-callback}/[token]/route.ts` · `src/app/api/voximplant/agent-tool/{rsvp,dnc,note}/[token]/route.ts` · `src/app/api/elevenlabs/rsvp/update/route.ts` · `src/app/api/campaigns/[id]/{authorize,close-charge,whatsapp-send}/route.ts` · `next.config.ts`
**Lib:** `src/lib/voximplant/{core,mutations,client,agent-tool-guard,recording-url,log-download,cli-support}.ts` · `src/lib/data/{outreach-calls,call-attempts,call-result-processing,webhook-processing,voximplant-config,voximplant-balance,voximplant-reconcile,vox-log-export,outreach-engine,elevenlabs-analysis,elevenlabs-status,elevenlabs-quota,elevenlabs-drift,rsvp}.ts` · `src/lib/data/admin/{voice-ops,call-dnc,voximplant-channel}.ts` · `src/lib/validation/{voximplant,vox-payloads,elevenlabs-payloads}.ts` · `src/lib/security/elevenlabs-webhook.ts` · `src/lib/alerts/slack.ts` · `src/lib/queue/queues.ts` · `src/lib/url.ts`
**Worker/ops:** `worker/main.ts` · `scripts/voximplant/cli.ts` · `scripts/voximplant/bridge-test-call.ts` · `scripts/download-voximplant-recording.ts`
**Admin UI:** `src/app/(admin)/admin/voice/{page,platform/page,events/[eventId]/page}.tsx` · `src/app/(admin)/admin/{dnc,recordings,callbacks,channels}/…` · `src/app/(admin)/admin/voice/platform/{wiring-card,elevenlabs-key-form}.tsx`
**DB:** `supabase/migrations/{202606290035,202606290036}_webhook_inbox*.sql` · `20260714160000_voximplant_bridge.sql` · `20260714193500_voximplant_b1_rsvp_call_consent.sql` · `20260719104000_voice_ops_dashboard.sql` · `20260719112811_voice_ops_hardening.sql` · `20260719154428_call_analysis.sql` · `20260719162804` (nonce) · `20260719170227` (QA cols) · `20260719180805` (conversation-id + callback cols) · `20260720025656_console_agent_layer.sql` + `20260720025745_…hardening.sql` · `20260720030121_strip_staff_axis_from_customer_tables.sql` · `src/lib/supabase/types.ts`
**Config:** `package.json` · `.env.example` · `.gitignore` (62, 67) · `docs/voximplant/**` (research corpus)
