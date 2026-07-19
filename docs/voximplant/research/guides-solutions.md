# Voximplant Docs Research — Group: guides-solutions

> NOTE ON LOCATION: The task requested this file at `<scratchpad>/vox-research/guides-solutions.md`, but the session runs in plan mode which permits writing only this plan file. Content is complete here; move/copy as needed.
> Manifest: `/tmp/claude-10003/-var-www-vhosts-kalfa-me-beta/269356ba-ade0-4bc0-981a-f198fee3744f/scratchpad/vox-manifests/guides_solutions.txt` (9 pages). All 9 fetched and read in full via `https://voximplant.com/api/v2/getDoc?fqdn=...`. Plus 3 focus extras outside the manifest: `guides.calls.voicemail-detection`, `references.voxengine.calllist`, `references.voxengine.calllist.reportprogress`.
> Extraction gotcha (for other fleet agents): the stock `extract.js` misses code (`content_source.examples[].source`), tables (`content_table.rows` = array-of-arrays of strings), alerts (`title`/`description`) and some lists (`content_list.text` array). All were recovered here with a corrected inline extractor.

## Section overview: guides.solutions (folder)

"Ready-to-use solutions built with Voximplant. Feel free to use this code in any of your projects." Eight tutorials: click-to-call widget, call lists, editing call lists, caller ID shuffler, phone number masking, call tracking, cloud PBX, two-factor authorization.

---

## 1. Call lists for automated calls (`guides.solutions.call-lists`) — EXTRA DEEP

Voximplant's campaign-dialing feature: upload a CSV of contacts; the platform launches one VoxEngine scenario session **per row**, passing the row to the scenario as JSON via `VoxEngine.customData()`.

### CSV format
- Delimiter default `;` (configurable via `delimiter` param of CreateCallList). First row = column/parameter names. Encoding default UTF-8 (`encoding` param).
- Example: `first_name;last_name;phone_number;appointment_date`.
- **Daily calling window (per row)**: two extra columns with start/end times, **UTC+0, 24h `HH:mm:ss`** (e.g. `...;17:00:00;22:00:00`). Named `__start_execution_time`/`__end_execution_time` in results.
- **`call_schedule` column**: JSON array of `{day_of_week, start, end}`; `day_of_week` full name or 3-letter (`mon`); same day may appear twice for two windows per day.
- **`task_priority` column**: numeric, **0 = highest**, default 50 when absent. Prioritized tasks are processed first, then tasks per the list strategy (first attempts vs retry attempts); ties sorted by task ID. Affects only incomplete tasks. Non-numeric value → error `The 'task_priority' parameter is invalid`.
- **`next_attempt_time` column**: ISO 8601 with timezone (`2024-10-31T15:00:13.567+03:00`) — task will not start before that date.

### Scenario contract (VoxEngine `CallList` module, `require(Modules.CallList)`)
- `AppEvents.Started` fires per CSV record; parse `VoxEngine.customData()` (JSON of the row).
- **`CallList.reportResult(result, callback)` / `reportResultAsync(result)`** — mark task success; arbitrary object serialized into the `result_data` column (e.g. `{result:true, duration, rating}`).
- **`CallList.reportError(err, callback)` / `reportErrorAsync(err)`** — mark attempt failed; engine either schedules a retry (per `num_attempts` + `interval_seconds`) or writes failure to `result_data` when attempts are exhausted.
- **`CallList.reportProgress` / `reportProgressAsync`** (from module reference, focus probe): "Report progress to the CallList module" — intermediate progress reporting; params `progress` (+`callback`). (Full param docs live in `references.voxengine.calllist.*`, another group's scope.)
- **`CallList.requestNextAttempt(data, callback)` / `requestNextAttemptAsync(data)`** — use after an **unsuccessful** attempt to change task parameters and schedule another attempt instead of finishing the task. Updates **only the current task** (not global list settings); updated values persist for all remaining attempts of that task. Callback style gets `Net.HttpRequestResult`; async style resolves with it / rejects with the result object.
  - Editable fields (table on page):
    | Field | Meaning |
    |---|---|
    | `custom_data` | new data source for the task (JSON string passed to next run) |
    | `attempts_left` | attempts remaining; **auto-decremented by 1 if not set**; `0` ⇒ current attempt is final and task marked failed |
    | `start_at` | earliest Unix timestamp (seconds) for next attempt |
    | `start_execution_time` / `end_execution_time` | daily window `HH:MM:SS` 24h, **UTC** |
    | `next_attempt_time` | ISO 8601 alternative scheduling field |
    | `error` | error details from the failed attempt — **strongly recommended**; warning logged if omitted |

### Launching / managing (Management API)
- Launch via `CreateCallList` (HTTP Management API; page links `references/httpapi/calllists#createcalllist`). Documented params: `account_name`, `api_key`, `rule_id` (routing rule with the scenario), `priority` (dialing priority among multiple lists), `max_simultaneous` (max concurrently processed CSV rows), `num_attempts`, `name`, `file_content` (CSV in request body), `interval_seconds` (delay before next attempt), `encoding`, `delimiter`.
- Results via `GetCallListDetails`: returns CSV with original columns plus `__start_execution_time`, `__end_execution_time`, `result_data` (JSON you reported), `last_attempt` timestamp, `attmepts_left` [sic — typo in product output], `status_id`, `status` (`Processed`).
- Real-time alternative: `Net.httpRequest` from the scenario to your backend; or store in `customData` and read later via `GetCallHistory` param `call_session_history_custom_data`.
- Task editing from backend: `EditCallListTask` (e.g. set `next_attempt_time`).

### Limits & gotchas
- **Balance gate: call lists do not run if account balance < $1**; they auto-resume after top-up. (ALERT on page + FAQ.)
- **Cannot delete an in-progress call list** — pause it or wait for completion.
- `next_attempt_time` restrictions (from editable-call-lists page): no past times; max **9 months** in the future — invalid values fall back to request time + configured interval.
- The docs' example scenario uses `Modules.AI` AMD with `AMD.Model.RU` — see voicemail section below for country support caveat.

### Code examples (essence)
1. **Call list example scenario**: per-row data → `AMD.create({model:AMD.Model.RU})` passed as `callPSTN(number, callerId, {amd})` param; on `AMD.Events.DetectionComplete` with `result.resultClass === AMD.ResultClass.VOICEMAIL` → `reportErrorAsync('Voicemail')` + terminate; on `Connected` → `call.say(...)` (Amazon en_US_Joanna), replay message up to 4× via `PlaybackFinished` counter; `Disconnected` → `reportResultAsync({result:true, duration})`; `Failed` → `reportErrorAsync({result:false,msg:'Failed',code})`.
2. **requestNextAttempt / Async examples**: on `CallEvents.Failed`, rotate to next number (`custom_data.index`), set `attempts_left`, `start_at = now+1s`, window `05:00:00`–`18:00:00`, pass `error: err`, then terminate.
3. **DTMF survey**: `call.handleTones(true)`; `CallEvents.ToneReceived` → store `e.tone` as rating → `stopPlayback`, thank, hangup; rating included in `reportResultAsync` → lands in `result_data`.
4. **ASR survey**: `VoxEngine.createASR({profile: ASRProfileList.Google.en_US, phraseHints:['One'..'Five']})`, `call.sendMediaTo(asr)` after playback, `ASREvents.SpeechCaptured` → `stopMediaTo`, `ASREvents.Result` with `e.confidence > 50` → accept `e.text`.

**KALFA relevance**: This is the campaign-dialing engine KALFA is evaluating. Per-row scenario launch replaces per-guest `StartScenarios` calls and sidesteps the 200-byte `script_custom_data` cap: the CSV row (arbitrary columns: guest token, name, event id) arrives via `customData()` uncapped. Built-in retry (`num_attempts`/`interval_seconds`), per-task scheduling (`call_schedule`, priorities, `next_attempt_time` — e.g. guest asks "call me back tomorrow" → `requestNextAttempt` with `next_attempt_time`), daily windows in UTC (Israel = UTC+2/+3 — convert!), throughput control via `max_simultaneous`, and result harvesting via `GetCallListDetails`/`GetCallHistory` map directly onto per-reached-contact billing reconciliation. Gotchas for KALFA: $1 balance kill-switch (account currently at $2.88!), windows/UTC conversion, AMD not available for Israel.

---

## 2. Editing call lists (`guides.solutions.editable-call-lists`) — DEEP

Covers editing call-list task parameters **during list progression**.

- Editable params list: `start_at`, `attempts_left` (0 ⇒ final fail; unset ⇒ auto-decrement), `custom_data` (unset ⇒ task data intact), `start_execution_time`, `end_execution_time` (both `HH:MM:SS` 24h **UTC**).
- ALERT: if `start_execution_time` > `end_execution_time`, the window **wraps midnight** (calls after start on day 1 and before end on day 2).
- Mechanism: `CallList.requestNextAttempt()` accepts new params, applies them, then performs another call attempt with the new params.
- Example pattern: CSV row carries a comma-separated `numbers` pool + `index` in custom_data; on `CallEvents.Failed` rotate index and retry via `requestNextAttempt` — multi-number fallback per contact.
- **Next-attempt date, 3 ways**: (1) real-time via Management API `EditCallListTask` with `next_attempt_time`; (2) at creation via a `next_attempt_time` CSV column; (3) in-scenario via `requestNextAttempt({next_attempt_time})`. Format `2024-10-31T15:00:13.567+03:00`.
- Restrictions: no past dates; ≤ 9 months ahead; violations fall back to request-time + interval.

**KALFA relevance**: `EditCallListTask` gives KALFA's backend server-side control over scheduled attempts (guest replied on WhatsApp meanwhile → cancel/postpone the task); in-scenario `requestNextAttempt` implements "call me later" and schedule_callback (an open item in KALFA's conversation design).

---

## 3. Caller ID shuffler (`guides.solutions.callerid-shuffler`)

Problem: repeated campaign calls from one caller ID get marked "Probably spam" by CID-identification apps, reducing answer rates.

- Simple: array `callerIds[]`, pick `Math.floor(Math.random()*...)` per attempt, pass as callPSTN callerid. (NB: the doc's snippet has a bug — `array.length` instead of `storage.callerIds.length`.)
- Stateful: `require(Modules.ApplicationStorage)` (key-value storage). Key = destination number, value `{cid, result}` with TTL (`86400` day / `604800` week). Logic: previous success ⇒ reuse same CID; previous failure ⇒ pick another (example just picks random); no history ⇒ random from pool.

**KALFA relevance**: Low/negative — KALFA calls from one verified Israeli number, and CID rotation to dodge spam labeling is legally risky in Israel (spam-law/DNC exposure). The useful part is the **ApplicationStorage pattern** (per-destination call history with TTL) — usable for retry/DNC state across sessions.

---

## 4. Phone number masking (`guides.solutions.phone-number-masking`)

Courier↔customer proxy calling without revealing numbers, via key-value storage.

- Both parties call one rented number; scenario asks for a 5-digit order number via DTMF (`handleTones(true)` + `ToneReceived` accumulation); `ApplicationStorage.get(orderNumber)` → `{courier, client}`; matches caller id to decide callee; bridges with `VoxEngine.callPSTN` + `sendMediaBetween`; `#` → agent transfer; hold music via `startPlayback('...mp3')`; full call recorded (`call.record({hd_audio:true})`, URL from `CallEvents.RecordStarted`); stats POSTed to backend on disconnect via `Net.httpRequestAsync`.
- Robust DTMF UX: input timers (8s no-input timer, 1.5s hint timer), repeat prompt, goodbye phrases; a `say()` promise helper wrapping `call.say` + `PlaybackFinished`.
- KVS populated **from the backend** via Management API `SetKeyValueItem` (Python client example; key=order number, value=JSON of both numbers, `ttl=864000`); service account `credentials.json` (Service accounts section, role allowing the method); `APPLICATION_ID` from panel URL; `DelKeyValueItem` to disconnect the pair; VoxEngine side is `ApplicationStorage`.

**KALFA relevance**: The KVS bridge (Management API `SetKeyValueItem` from backend → `ApplicationStorage.get` in-scenario) is a clean **workaround for the 200-byte `script_custom_data` cap**: write the full guest payload to KVS keyed by a short token, pass only the token in StartScenarios. Also a good reference for production-grade DTMF timeout/retry UX and the `say()`-as-promise helper (KALFA already uses a similar pattern).

---

## 5. Call tracking (`guides.solutions.call-tracking`)

Marketing call-tracking: rent numbers per channel, forward, log everything.

- On `AppEvents.CallAlerting`: `Net.httpRequest` to your web service with the dialed number → response body = forwarding (agent) number → `VoxEngine.callPSTN(agent_number, dialed_number)` + `VoxEngine.easyProcess(e.call, _call, onConnected)`; webservice non-200 ⇒ `call.reject(603)`.
- Recording via `_call.record()` + `RecordStarted.url`; final stats logged in `AppEvents.Terminating` (dialed number, agent, date, duration, record URL / failure code+reason) — push to backend with `Net.httpRequest`.
- Results also via panel Calls section or `GetCallHistory` (`call_session_history_custom_data` for your own `customData`).

**KALFA relevance**: Validates KALFA's existing architecture — fetching per-call parameters over HTTP at scenario start (the ctx endpoint) instead of stuffing data into custom_data, and `AppEvents.Terminating` as a last-chance callback to KALFA's cb endpoint for billing-grade call outcome reporting.

---

## 6. Cloud PBX (`guides.solutions.cloud-pbx`)

Build a company PBX: extension dialing, transfer, business-hours routing, queues, conferencing, recording.

- 3 scenarios + routing-rule patterns: incoming (default pattern), local extension calls (`1[0-9]{2}`), outgoing PSTN (`[0-9]+`).
- Incoming: working-hours matrix per weekday (+manual GMT offset math), greeting mp3 per state, DTMF extension entry with timeout, simultaneous ring of all operators via `VoxEngine.callUser({username, callerid, displayName})`, first-answer wins (others hung up), `playProgressTone('RU')`, `sendMediaBetween`.
- Local: `VoxEngine.forwardCallToUser(callback, true)` with recording after connect. Outgoing: `CallAlerting` → `callPSTN` with authorized caller ID (`officeNumber`).
- Softphone: Voximplant's Vue.js voice&video demo app as web softphone.

**KALFA relevance**: Low. Only reusable bits: `callUser`/simultaneous-ring pattern if KALFA ever adds an "escalate to human owner" leg, and the working-hours guard pattern (though call lists do this natively).

---

## 7. Two-factor authorization (`guides.solutions.2fa`)

OTP delivery via call or SMS.

- **Call**: backend triggers Management API **`StartScenarios`** with `script_custom_data` = JSON `{"phone":"...","code":"1234"}`; scenario parses `VoxEngine.customData()`, spaces digits for TTS (`String(code).replace(/(\d)/g,'$1 ')`), `VoxEngine.createTTSPlayer(text,{voice, onPause:true})`, on `Connected` → `sendMediaTo(call)` + `resume()`, hangup on `PlaybackFinished`. Example curl uses `-H "$(bash token.sh)"` (JWT header) + `api_key` style params.
- **SMS**: number must support SMS + SMS enabled; one-way via `A2PSendSms` (`src_number`, `dst_numbers`, urlencoded `text`; response has `message_id` per destination + `fragments_count`); two-way alternative (`SendSmsMessage`) per Sending SMS guide.

**KALFA relevance**: Direct mini-precedent of KALFA's exact trigger pattern (StartScenarios + JSON script_custom_data). The digit-spacing regex is the docs' own trick for TTS clarity — same trick applies in Hebrew niqqud-tuned prompts when reading numbers/dates. SMS fallback path (KALFA already has ExtrA SMS; Voximplant SMS availability for +972 not covered here).

---

## 8. Click-to-call web widget (`guides.solutions.click-to-call`)

Website button for VoIP calls without leaving the site (Vue app, github.com/voximplant/click-to-call).

- Cloud side: app + widget user + two scenarios/rules: mic-check (rule mask `testmic`, top of list) and call scenario below it. Mic check: `Modules.Recorder` + `createRecorder({hd_audio:true})`, `call.sendMessage(...)`, `handleMicStatus(true)` + `MicStatusChange` to detect mic stop, plays your recording back.
- Call destinations: user (`VoxEngine.forwardCallToUser((c1,c2)=>true, true)`), PSTN (`forwardCallToPSTN(null,null,{callerid})` — needs rented/verified caller ID), SIP (`callSIP(e.toURI,{callerid,displayName})` + `easyProcess`).
- Widget: `.env` with `VUE_APP_USER/PASSWORD/NUMBER/TEST_NUMBER=testmic`; `x-` GET params are sent as headers to the VoxEngine scenario; build via vue-cli.

**KALFA relevance**: Minimal (KALFA is outbound PSTN). Possible future: "test call" button in the owner dashboard using the widget's user-login pattern; `x-` param → scenario headers is a handy data channel for web-originated calls.

---

## FOCUS EXTRAS (outside manifest)

### Voicemail & beep detection (`guides.calls.voicemail-detection`)
- AMD (`Modules.AI`, `AMD.create({model: AMD.Model.XX})`): ML classification of live person vs voicemail vs AI robot on outbound calls.
- **Supported countries ONLY: Brazil, Colombia, Kazakhstan, Mexico, Russia** — others must contact Voximplant support. ⇒ **No out-of-the-box AMD model for Israel/Hebrew.**
- Usage: pass `amd` in `callPSTN`/`callSIP` params, or create after `CallEvents.AudioStarted` with `{model, call}` then `detector.detect()` (await-able). `AudioStarted` recommended because voicemail systems can answer in early media (pre-connected). Result: `DetectionComplete` with `result.resultClass` (`AMD.ResultClass.VOICEMAIL`) + `result.confidence` (%); `DetectionError` event. Works for SIP calls too.
- **Beep detection** (leave-message-after-beep): `call.enableBeepDetection({frequencies:[915,1371,1777], timeout:6000})`; `CallEvents.BeepDetectionComplete` (`e.frequencies === undefined` ⇒ timeout) / `BeepDetectionError`.

**KALFA relevance**: KALFA cannot rely on Voximplant AMD for +972 without a support engagement; fallback = current duration/DTMF/LLM heuristics, or beep detection (frequency-based, country-agnostic) to at least detect answering-machine beeps before speaking.

### CallList module reference (`references.voxengine.calllist`, focus probe)
- Module methods confirmed in tree: `reportError(Async)`, `reportResult(Async)`, `reportProgress(Async)` ("Report progress to the CallList module"; params `progress`, `callback`), `requestNextAttempt(Async)`. Full per-method pages are in the references_voxengine group's scope.
- **"ManageQueue" does not exist anywhere in the docs tree** (grep over full tree.json: zero hits). Closest concepts: the httpapi call-list management method family (`CreateCallList`, `CreateManualCallList`, `StartNextCallTask`, `AppendToCallList`, `RecoverCallList`, `StopCallListProcessing`, `GetCallLists`, `GetCallListDetails`, `EditCallListTask`, `CancelCallListTask` — under `references.httpapi.calllists`, covered by the httpapi group) and SmartQueue (contact-center product).

---

## INVENTORY (all pages in scope, per manifest)

| fqdn | kind | title | read |
|---|---|---|---|
| guides.solutions | folder | Solutions | FULL |
| guides.solutions.click-to-call | tutorial | Click-to-call web widget | FULL |
| guides.solutions.call-lists | tutorial | Call lists for automated calls | FULL (extra deep) |
| guides.solutions.editable-call-lists | tutorial | Editing call lists | FULL (deep) |
| guides.solutions.callerid-shuffler | tutorial | Caller ID shuffler | FULL |
| guides.solutions.phone-number-masking | tutorial | Phone number masking | FULL |
| guides.solutions.call-tracking | tutorial | Call tracking | FULL |
| guides.solutions.cloud-pbx | tutorial | Cloud PBX | FULL (incoming-calls scenario code in full; local/outgoing scenario code skimmed via structure pass) |
| guides.solutions.2fa | tutorial | Two-factor authorization | FULL |

Focus extras (not in manifest): guides.calls.voicemail-detection (tutorial, FULL) · references.voxengine.calllist (ref_folder, summary) · references.voxengine.calllist.reportprogress (function, summary).
