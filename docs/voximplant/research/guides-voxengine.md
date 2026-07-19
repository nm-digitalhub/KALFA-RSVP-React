# Voximplant docs research — group: guides-voxengine

NOTE: Intended destination was `<scratchpad>/vox-research/guides-voxengine.md`, but plan mode restricted writes to this plan file. Content below is the complete deliverable; copy it to the intended path when execution is permitted.

Manifest: `guides_voxengine.txt` — 13 entries (1 folder + 12 tutorials). All 13 fetched and read in full via `https://voximplant.com/api/v2/getDoc?fqdn=...`.

---

## 1. VoxEngine (folder, `guides.voxengine`)

Section landing page. VoxEngine = serverless cloud JS engine for call processing (calls, IVR, TTS/ASR, recordings). Every subsection ships copy-pasteable scenario examples.

**KALFA relevance:** orientation only.

## 2. VoxEngine concepts (`guides.voxengine.concepts`)

- Engine: **ECMAScript 2022** on **SpiderMonkey (Firefox 115)**. Vanilla JS only in the cloud; TS must be transpiled before upload.
- **Event-based model.** Events can be **nested**: you must subscribe to the parent event first. E.g. `CallEvents.*` (Connected, ToneReceived, Disconnected) are only reachable after subscribing to `AppEvents.CallAlerting` (incoming) — the `Call` object arrives in `e.call`. For **outgoing** calls you create the Call yourself (`VoxEngine.callPSTN(number, callerId)` inside `AppEvents.Started`) and attach listeners to the returned object.
- Events can be **consequent**: e.g. `PlayerEvents.PlaybackFinished` only after `PlayerEvents.Started`.
- **Session lifecycle:** every call attempt creates a new independent session (except conferences, which join an existing one). Session always starts with `AppEvents.Started` (triggered by an incoming call OR an HTTP request). Next event: `CallAlerting` (call-triggered) or `AppEvents.HttpRequest` (HTTP-triggered).
- **Termination sequence:** (1) `VoxEngine.terminate()` called / error / timeout with no active calls+ACD → (2) `AppEvents.Terminating` fires — timers and external resources are dead, but you may perform **exactly one HTTP request** in the handler (e.g. notify an external system) → (3) `AppEvents.Terminated` fires.
- **Standard library:** `setTimeout`, `clearTimeout`, `str2Bytes`, `base64_encode`, `uuidgen`, `crypto` set — names/behavior may differ slightly from browser equivalents; check the VoxEngine reference.
- **Logging:** `Logger.write()` writes to the session log. Log becomes available **immediately at session termination** in Call history — via Control panel (Calls section) or the `GetCallHistory` Management API. Panel log viewer: copy log/link, download `.txt`, highlighted events+timecodes, minimap, per-leg folding ("Highlight call lines").

**KALFA relevance:** validates the scenario architecture (Started → callPSTN → Connected → say/LLM loop → Disconnected → terminate). The one-HTTP-request-in-Terminating rule is exactly where KALFA's final `cb` status callback must live if not sent earlier.

## 3. Limits and restrictions (`guides.voxengine.limits`) — FULL LIST

- Max **1000 users per account** (Management API error 109 beyond; support can raise).
- Unanswered **incoming** call disconnected in **60 s**.
- Session without calls and without ACD requests terminated in **60 s**; with ≥1 ACD request — **120 min**.
- Scenario size ≤ **256×1024 Unicode chars**; JS memory ≤ **16 MB**; JS string ≤ **8,388,607 chars**.
- **Callback execution time ≤ 1 second** — heavy computation must be moved to your own infrastructure and accessed via HTTP.
- Max **100 active timers**; **10 media players**/session; **10 SIP REFERs**/call; SIP header ≤ 4095 B; single SIP header field ≤ 200 B; SIP packet ≤ 307200 B.
- After `Terminating`: timers/external resources unavailable; **one more HTTP request** allowed.
- **HTTP requests: max 3 active**, queued beyond that; **max 35 simultaneous (active+queued)** → exceeding throws “Exceeded the HTTP connection count limit!”. Before `Terminating`, VoxEngine waits **up to 90 s** for pending requests and runs their callbacks; remaining queued requests are **silently dropped** (no callback).
- **SMTP: 2 active / 10 simultaneous** (same queue semantics).
- HTTP **response size handled by VoxEngine ≤ 2 MB**.
- Session limited to **50 total call attempts** (in+out, successful+failed). Beyond → `CallEvents.Failed` code **403** “Call limit reached”. Docs explicitly say: use the **CallList module** for large numbers of outgoing calls; Conference module for many participants.
- Max **10 “progressing” (not yet answered) calls** at any moment → 403 beyond.
- Destinations **more expensive than $0.20/min** and **calls to Africa** are **blocked by default** (security); support enables; child accounts inherit the setting.
- All `call*` methods (`callPSTN`, `callSIP`, `callUser`, `callUserDirect`, `callConference`) trigger `Failed` with code **408 after 60 s** of no answer.
- `call.sendInfo` / `call.sendMessage` payload ≤ **8192 bytes**.
- Incoming WebSocket connections ≤ **(number of calls in session) + 3**; beyond → `AppEvents.NewWebSocketFailed`. Existing connections are not destroyed after a call ends.

**KALFA relevance:** the hard operating envelope for the AI-call scenario: 1-s callback budget (LLM work must be HTTP to Groq/KALFA), 3-active/35-total HTTP cap (LLM turn + ctx/cb calls share it), 2 MB response cap, 408 after 60 s ring, one final HTTP in Terminating, and per-session call-attempt caps that motivate CallList for campaigns.

## 4. Cloud IDE (`guides.voxengine.ide`)

Browser IDE inside the control panel: autocomplete of VoxEngine entities, syntax highlighting, hotkeys, minimap, tabs, auto-format, **Diff vs cloud-stored version** (side-by-side/inline), folding, go-to-definition, find/replace, F1 command palette, built-in debugger (set params before first run). **JS only**; the TS declaration file (`voxengine.d.ts` from CDN) helps offline editors, but code must be transpiled to JS before pasting.

**KALFA relevance:** low — KALFA deploys via voxengine-ci, not the web IDE; Diff is handy for verifying what is live in the cloud.

## 5. Type declarations (`guides.voxengine.type-declarations`)

Download `https://cdn.voximplant.com/voxengine_typings/voxengine.d.ts` and add to project/`tsconfig.json` for IDE type checking of scenario code. CDN file always tracks the latest platform changes (unversioned).

**KALFA relevance:** add to the repo tooling for scenario editing; prefer the versioned typings bundled with voxengine-ci (below).

## 6. VoxEngine CI (`guides.voxengine.ci`)

- npm package `@voximplant/voxengine-ci` (uses `@voximplant/apiclient-nodejs` under the hood — NB: KALFA memory flags that client's transitive axios/form-data vulnerabilities; CI is a dev-time tool though).
- Auth: **service-account JSON** from control panel → `.env`: `VOX_CI_CREDENTIALS=/path/to/vox_ci_credentials.json`, `VOX_CI_ROOT_PATH=/path/to/voxfiles`.
- `npx voxengine-ci init` downloads all apps/rules/scenarios + metadata; `init --force` re-inits from scratch.
- Project layout: `applications/<app>.<account>.voximplant.com/application.config.json` (`{"applicationName": ...}`) + `rules.config.json` (array of `{ruleName, scenarios[], rulePattern}` — rulePattern is a regex on caller IDs, default `.*`). Scenario sources ONLY in `voxfiles/scenarios/src`, filenames matching `*.voxengine.{js,ts}`; only scenarios referenced by rules.config.json get uploaded.
- `npx voxengine-ci upload --application-name X [--rule-name Y] [--dry-run] [--force]`; `--application-id`/`--rule-id` variants (ID wins if both given). `--force` overwrites changes made on the platform outside CI.
- **Built-in versioned type declarations**: include `node_modules/@voximplant/voxengine-ci/typings` in `tsconfig.json` (recommended over CDN d.ts because versioned).
- CI/CD templates for **GitLab** (remote include + `.voxengine-ci` extends, env `VOX_CI_CREDENTIALS`/`VOX_CI_CREDENTIALS_CONTENT`), **GitHub Actions** (secrets, node 16 in example), **Jenkins** (Freestyle or Jenkinsfile pipeline with NodeJS plugin + secret file binding).

**KALFA relevance:** confirms the already-adopted voxengine-ci redeploy path for the Branch B scenario (pending redeploy per memory); `--dry-run` before real upload; credentials JSON must stay out of git.

## 7. Working with API requests (`guides.voxengine.api`) — HTTP/WebSocket/email from scenarios

- `Net` namespace. **`Net.httpRequest(url, callback, [options])`** — callback receives `HttpRequestResult` with `e.code` (200…), `e.data`, `e.error`, `e.headers` (object), `e.raw_headers`, `e.text`. **`Net.httpRequestAsync(url, [options])`** returns a Promise resolving to the same result object.
- **WebSockets (outgoing):** `require(Modules.WebSocket)` → `VoxEngine.createWebSocket('wss://…')` → `webSocket.send(text)` → subscribe `WebSocketEvents.OPEN` / `MESSAGE` (handler gets `message`) etc. Deeper media-over-WS coverage lives in guides/media-streams/websocket.
- **Email:** `Net.sendMail(smtpHost, from, to, title, body, callback, {login, password, port})` and `Net.sendMailAsync(...)` (await) → `SendMailResult`.

**KALFA relevance:** this is the exact mechanism of the Groq bridge and ctx/cb callbacks; `httpRequestAsync` + result fields (`code`, `text`) are the contract. Email from scenario exists but KALFA uses IONOS/SMTP server-side instead.

## 8. Working with the Voximplant's API (`guides.voxengine.management-api`)

Make **Management API calls from inside a scenario**: (1) create a private API key under Service accounts; (2) **bind the key to the routing rule** via `SetRuleInfo` with `bind_key_id`; (3) in the scenario `require(Modules.VoximplantAPI)`; `const client = new VoximplantApi.Client();` then e.g. `client.SMS.sendSmsMessage({source, destination, smsBody})` or `client.History.getCallHistory({fromDate, toDate, count, timezone})` — Promise-based, `.then/.catch`.

**KALFA relevance:** enables in-call platform actions (e.g. SMS fallback after an unanswered AI call) without routing through KALFA's backend — but requires binding an API key to the rule (extra secret surface); KALFA currently triggers all side effects via its own cb endpoints, which stays cleaner.

## 9. Working with MCP servers (`guides.voxengine.mcp`)

Voximplant scenario can act as an **MCP client** (Model Context Protocol) over WebSocket/SSE: `require(Modules.MCP)` → `MCP.createClient({ mcpServerConnectionConfig: { transport: "sse", endpoint, headers: {Authorization: Bearer …}, clientName, clientVersion }, onWebSocketClose })`. Events via `MCP.ServerEvents`: `ConnectorInformation` (connected → call `listTools({})`), `ToolsList` (`event.data.payload.tools`), `ToolResult`, `MCPError`. Methods: `mcpClient.listTools`, `mcpClient.callTool({name, arguments})`, `mcpClient.close()`. Docs example pulls endpoint+token from **secret storage** (`VoxEngine.getSecretValue`).

**KALFA relevance:** a future-facing alternative for tool-calling voice agents — KALFA's `save_rsvp` / `mark_dnc` / `notify_owner` could be exposed as an MCP server consumed directly by the scenario, replacing bespoke ctx/cb JSON contracts.

## 10. Remote session management (`guides.voxengine.remote-sessions`)

- Starting a session via HTTP (`StartScenarios` Management API) returns **`media_session_access_url`** in the response.
- POSTing to that URL (e.g. `curl -d '{"param1":"value1"}' -H "Content-type: application/json" -X POST <media_session_access_url>`) triggers **`AppEvents.HttpRequest`** inside the running scenario, with the request body in `e.content`.
- Usable for arbitrary in-flight control: stop the scenario, pass extra data. Example: subscribe to `AppEvents.HttpRequest` inside `AppEvents.Started`, log `e.content`, then `setTimeout(() => VoxEngine.terminate(), 300)`. In the documented example flow, the session is terminated after the HTTP request is handled.

**KALFA relevance:** KALFA already stores/starts sessions via StartScenarios — persisting `media_session_access_url` gives a push channel INTO a live call: cancel a stuck call (stuck-call reconciler could terminate remotely), or inject data mid-call, complementing the outbound ctx polling pattern.

## 11. Key-value storage (`guides.voxengine.key-value-storage`)

- `require(Modules.ApplicationStorage)` — built-in DB of key-value pairs, **shared across the whole application**.
- **Unlimited pairs; key ≤ 200 chars; value ≤ 2000 chars.** `ApplicationStorage.put(key, value, ttlSeconds)` (example TTLs: day 86400, week 604800), `ApplicationStorage.get(key)` → `res.value` (null when absent). Both async (await), wrap in try/catch.
- Example use cases: cross-call counters; **phone-number masking** (order number as key, courier/customer numbers as values).
- Full worked example: call counter incremented per CallAlerting, answer + `say` count, terminate on PlaybackFinished.

**KALFA relevance:** an app-global scratch store that can smuggle per-call payloads past the 200-byte `script_custom_data` cap (KALFA writes JSON keyed by token via Management API/scenario, scenario `get`s it) — though KALFA's ctx-endpoint fetch already solves this; also usable for cheap cross-session counters (e.g. per-campaign dial counters) without hitting KALFA's DB.

## 12. Secret storage (`guides.voxengine.secrets`)

- Per-application **Secrets** section in the control panel (Add/edit/delete secret via UI).
- In scenario: `VoxEngine.getSecretValue('name')` → string or `undefined` if missing (example logs a fallback message). Synchronous read.

**KALFA relevance:** platform-native home for the **Groq API key** (currently served via ctx endpoint to keep it out of call history) — `getSecretValue` keeps it out of both the scenario source and `script_custom_data`; pairs with the pending leaked-Groq-key rotation. Rotation = update secret in panel, no scenario redeploy.

## 13. Custom data (`guides.voxengine.custom-data`)

- **`VoxEngine.customData([value])`** — session-scoped string, **up to 200 bytes**. Setter when called with an argument, getter without. Can be pre-set three ways: (a) popup when manually starting a rule; (b) **`script_custom_data` parameter of `StartScenarios`** — retrieved in-scenario via `VoxEngine.customData()`; (c) set at runtime in the scenario.
- Call history is searchable by this value: `GetCallHistory` with **`call_session_history_custom_data`**.
- **`Call.customData([value])`** — a second, independent 200-byte store **per Call object**; also accessible from web/mobile SDKs (`CallSettings.customData`) to pass data between scenario and client SDK.

**KALFA relevance:** authoritative confirmation of the **200-byte `script_custom_data` cap** (it IS the `VoxEngine.customData` session slot) — the documented reason for Branch B's minimal `{to,from,tok,u}` payload + ctx fetch. Bonus: `call_session_history_custom_data` search means putting KALFA's call-token in customData makes sessions findable in `GetCallHistory` for reconciliation.

---

## Cross-cutting takeaways for KALFA

1. **script_custom_data = 200 bytes, confirmed in docs** (session customData slot). Token-only payload + server-side fetch is the sanctioned pattern.
2. **HTTP budget per session:** 3 active / 35 total, 2 MB response, callbacks ≤ 1 s — the Groq bridge + ctx/cb traffic all share this; serialize LLM turns, keep responses small.
3. **Terminating = exactly one last HTTP request**, ≤ 90 s wait for pending, extra queued requests silently dropped → the final `cb` (call outcome) must be that request or earlier; never queue several at hangup.
4. **CallList is the docs-recommended path for high-volume outbound** (per-session 50-attempt / 10-progressing limits) — supports the campaign-dialing evaluation.
5. **Remote session URL (`media_session_access_url`)** from StartScenarios is a push/kill channel into live calls — useful for the stuck-call reconciler.
6. **Secrets storage** is the native place for the Groq key; **ApplicationStorage** (200-char key / 2000-char value, TTL) is a native side channel bigger than customData.
7. **Logs via `Logger.write`** are immediately available at termination through `GetCallHistory` — do not log guest PII (KALFA privacy rules).
8. **Cost guard:** >$0.20/min destinations blocked by default (Israel mobile typically under, but verify per-destination rates before campaigns).

---

## INVENTORY (all pages in scope; 13/13 fetched & read)

1. VoxEngine (folder) — `guides.voxengine`
2. VoxEngine concepts — `guides.voxengine.concepts`
3. Limits and restrictions — `guides.voxengine.limits`
4. Cloud IDE — `guides.voxengine.ide`
5. Type declarations — `guides.voxengine.type-declarations`
6. VoxEngine CI — `guides.voxengine.ci`
7. Working with API requests — `guides.voxengine.api`
8. Working with the Voximplant's API — `guides.voxengine.management-api`
9. Working with MCP servers — `guides.voxengine.mcp`
10. Remote session management — `guides.voxengine.remote-sessions`
11. Key-value storage — `guides.voxengine.key-value-storage`
12. Secret storage — `guides.voxengine.secrets`
13. Custom data — `guides.voxengine.custom-data`
