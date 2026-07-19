# Voximplant Docs Research — Group: guides-calls

Fleet research notes for KALFA. Scope: `guides.calls.*` (11 pages, DEEP — every page fetched via `getDoc` API and read; a second raw-JSON pass recovered list/table/alert content the extractor dropped).

NOTE: This session ran in plan mode (read-only + this plan file only), so these notes live here instead of `<scratchpad>/vox-research/guides-calls.md`. Content is complete and self-contained.

---

## 1. Calls (folder overview) — `guides.calls`

Section landing page. Key features listed: voice calls to/from phone numbers, SIP addresses and app users; video calls to/from users and SIP; screen sharing, recording, call transfers; AI voicemail detection during outgoing calls; platforms: web, iOS, Android, React Native.

**KALFA relevance**: orientation only.

## 2. Processing calls in scenarios — `guides.calls.scenarios`

The core VoxEngine outbound/inbound call guide.

- **Call a Voximplant user**: `VoxEngine.callUser({username, callerid, ...})`; peer-to-peer variant `callUserDirect` (direct device-to-device, better security/quality, no server routing).
- **Call a phone number (PSTN)**: `VoxEngine.callPSTN(number, callerid)`. Caller ID must be one of:
  1. A **real rented** Voximplant number (test numbers NOT allowed),
  2. Any number **verified** via automated confirmation call + code,
  3. The caller ID of an incoming call to a rented number (set `followDiversion: true` in CallPSTNParameters to re-use it).
- **US→US calls** additionally require `Call.ring()` on the incoming leg (not applicable to +972).
- **Call a SIP address**: `VoxEngine.callSIP`; TLS via `sips:` prefix or explicit TLS transport; UDP is default, TCP via parameter.
- **Incoming calls**: subscribe `AppEvents.CallAlerting`; `call.answer()` / `call.reject()`; `call.startEarlyMedia()` to play audio/TTS before answer. **Early media limit: 60 seconds max.**
- **SDK-originated calls have TWO legs**: SDK→scenario (arrives as CallAlerting, i.e., an *incoming* call in the scenario) and scenario→destination; bridge with `VoxEngine.easyProcess`.
- **Forwarding pattern** (FAQ): CallAlerting → `callPSTN` to target → `easyProcess(call1, call2)`; needs a routing rule.
- **Dial-time limiting** (FAQ): `setTimeout` + fallback `callPSTN` — relevant to no-answer handling in campaigns.
- **Failure diagnosis** (FAQ): subscribe `CallEvents.Failed`, read `e.code` (error-code list in event reference).
- **Shared state** (FAQ): scenarios attached to the SAME routing rule run in ONE JS context and share variables; across sessions use Key-value storage (`guides/voxengine/key-value-storage`).
- **ALERT — Destination restrictions**: calls costing **> $0.20/min** and calls **to Africa** are blocked by default for security; enable via support@voximplant.com.
- Voximplant web softphone at https://phone.voximplant.com (usable as agent workspace).

**KALFA relevance**: this is the canonical page for KALFA's outbound leg — `callPSTN` to +972 with a rented/verified caller ID, `CallEvents.Failed` `e.code` for reached/not-reached billing decisions, `setTimeout` for dial-timeout policy, KV storage for cross-session state.

## 3. Processing voice calls in SDKs — `guides.calls.voice`

Client-side (Web/iOS/Android/RN/Flutter) calling.

- `client.call(destination, settings)` → platform receives it, routing rule matches `e.destination` in scenario → scenario creates the second leg (`callUser`/`callPSTN`/`callSIP`) → `easyProcess` unites; `call.hangup()` ends.
- Incoming in app: `IncomingCall` event → `call.answer()` / `call.decline()`.
- **Reconnection**: with an active call the SDK retries ~30 s then stays Disconnected; Web SDK v5 has `ConnectionOptions.autoReconnect` (reconnects even with no active call).
- iOS background modes / Android foreground service needed for background calls; iOS closed-app call dies by 30 s cloud timeout unless hangup wired in AppDelegate.
- FAQ: mass user provisioning via Management API `AddUser`; auth via one-time key; Click-to-call widget exists; caller ID mandatory for PSTN.

**KALFA relevance**: low — KALFA has no in-app softphone; useful only if an owner-side "listen/join call" web client is ever added.

## 4. Processing video calls in SDKs — `guides.calls.video`

Video-call plumbing: `video: true` in scenario, `videoFlags`/`video` in SDK settings, Endpoint model, per-platform remote/local video-stream events (EndpointAdded → RemoteMediaAdded etc.), local video via `showLocalVideo`/renderers.

**KALFA relevance**: none (audio-only product).

## 5. Features available during a call — `guides.calls.features`  ★FOCUS: customData, SIP headers

- Mute: `muteMicrophone`/`unmuteMicrophone`; playback mute: `mutePlayback`/`unmutePlayback`.
- **Hold**: Web `setActive`, iOS `setHold`, Android `hold`; scenario hears `CallEvents.OnHold` → play music via `createURLPlayer`.
- **DTMF**: SDK `sendTone` (0-9, *, #); scenario receives `CallEvents.ToneReceived`.
- **Extra SIP headers**: pass via `extraHeaders` param of `callUser`/`callPSTN`/`callSIP` (CallUserParameters.extraHeaders) and of `Call.answer`; after disconnect read them from the call object's `headers` property. (Custom headers conventionally `X-`-prefixed.)
- **In-call messaging**: `call.sendMessage()` ↔ `CallEvents.MessageReceived` (also carries extra headers); `call.sendInfo(mimeType, body, xHeaders)` sends SIP INFO.
- **Custom data — TWO distinct properties, each up to 2000 characters** (verified from raw JSON):
  1. `VoxEngine.customData('...')` — session-level; set/read in scenario.
  2. `call.customData()` — per-call; can arrive populated from an SDK client (undefined for PSTN legs unless set).
  Example from docs: in CallAlerting, `e.call.customData()` returns value received from Web SDK; `VoxEngine.customData(v)` sets, `VoxEngine.customData()` gets.
- Video toggle `sendVideo(bool)`; gotcha: initializing SDK with both `sendVideo` and `receiveVideo` false permanently disables mid-call video enable.

**KALFA relevance**: HIGH. The 2000-char `VoxEngine.customData` / `call.customData` is a separate, much larger channel than the ~200-byte `script_custom_data` of StartScenarios — pattern: pass only an opaque token via `script_custom_data`, then have the scenario fetch full guest context from KALFA's ctx endpoint (already KALFA's design) or stash session state in `VoxEngine.customData` (it is also surfaced in call-history records for reconciliation). `ToneReceived` enables DTMF fallback RSVP ("press 1 to confirm") when speech fails.

## 6. SIP calls and registrations — `guides.calls.sip`  ★FOCUS: SIP headers/trunking

- Outbound to 3rd-party PBX: `callSIP`; TLS via `sips:`/transport; UDP default, TCP `;transport=tcp`.
- Inbound from PBX: **whitelist the PBX IP address (NOT the domain)** in control panel security settings; address formats: `destination@application.account.voximplant.com` or `app_id#account_id#destination@sip.voximplant.com` (destination digits-only in 2nd form); `e.destination` carries the user part. Cannot accept SIP calls from the voximplant.com domain itself.
- 3rd-party softphones (Linphone/Jitsi): Voximplant user = SIP account, app address = SIP domain; UDP/TCP/TLS.
- **SIP registrations** (Voximplant registers to an external PBX/provider as a softphone): create via control panel or Management API (`references/httpapi/sipregistration`); params: proxy (port/transport suffix allowed), username, password (+ optional outgoing proxy, auth user). Statuses: Successful / In progress (~2 min provisioning) / Failed (SIP error visible in tooltip). Status flips fire **email + HTTP callback** (`guides/management-api/callbacks`). Outbound via registration: pass `regId` (CallSIPParameters) to `callSIP`. Attach registration to an app + routing rule for inbound (rule pattern ignored — catches all).
- **Pricing gotcha**: SIP registrations are billed a MONTHLY fee immediately, even if created and deleted at once.

**KALFA relevance**: MEDIUM-LOW today (KALFA dials PSTN directly), but SIP registration is the documented path if KALFA ever routes calls through an Israeli SIP trunk provider for better +972 caller-ID/rates; extra-header passing matters if bridging to any PBX.

## 7. Call recording — `guides.calls.recording`  ★FOCUS: recording

- Start with `call.record(params)` in scenario; saved to Voximplant cloud **or custom S3-compatible storage** (`guides/integrations/s3`). `video: true` for video.
- Alternative: `Recorder` module (`createRecorder`) — **audio only**.
- Recorder parameters (full list at `references/voxengine/recorderparameters`); most common:
  - `expire`: cloud retention — 3 or 6 months, 1, 2, or 3 years
  - `contentDispositionFilename`: filename in cloud
  - `hd_audio`: true → 192 kbps / 48 kHz (default is 32 kbps / 8 kHz)
  - `lossless`: FLAC output
  - `stereo`: stereo vs mono
- Video record format: MP4 (H.264) or WEBM (VP8) depending on calling SDK; Web SDK `H264first: true` prioritizes MP4.
- **Retrieve the URL**: subscribe `CallEvents.RecordStarted`, copy `e.url`.
- Record-access HTTP errors: 401 auth failed, 403 broken link/invalid URI, 404 file deleted/not found, 416 range not satisfiable (plus S3-specific errors on own storage).

**KALFA relevance**: HIGH for compliance/audit. Record AI confirmation calls with `stereo` (agent/guest channel separation aids QA), capture `RecordStarted.e.url` into KALFA's cb payload, mind `expire` retention vs privacy policy; S3-compatible storage option keeps recordings under KALFA's control (guest PII). Israeli law: recording disclosure handled at prompt level.

## 8. Call streaming — `guides.calls.streaming`

RTMP livestreaming of a single Call object to YouTube / Twitch / Restream.io: require `StreamingAgent` module, `createStreamingAgent({credentials})`, `call.sendMediaTo(agent)`; **H.264 only**; mixed multi-participant streaming not available. Per-platform credential walkthroughs (stream key + server URL).

**KALFA relevance**: none.

## 9. Call transferring — `guides.calls.transferring`  ★FOCUS: transfers

Blind-transfer handling (SIP REFER initiated by a callee, e.g., SIP phone):

- **New mode**: `call.handleBlindTransfer(true)` keeps the third leg (transfer target) inside the SAME session → `CallEvents.BlindTransferRequested` fires with params: `call` (active call), `transferTo` (username/number of target), `headers` (optional SIP headers from the REFER), `name`.
- Scenario then dials target (`callUser` or `callSIP` — for callSIP get target from `headers`), and notifies the transferor via `call.notifyBlindTransferSuccess()` or `call.notifyBlindTransferFailed(code, reason)`.
- Can change caller ID shown to the target via `displayName` and pass custom headers to the target.
- **Legacy mode** (`handleBlindTransfer` false/unset): REFER spawns a NEW session (two sessions total); transferor saw as caller ID; handled via `TransferComplete` / `TransferFailed` events.

**KALFA relevance**: LOW-MEDIUM. KALFA's likely "escalate to human/event owner" is NOT a SIP blind transfer — it's an in-session bridge (`callPSTN` owner + `easyProcess`/sendMediaTo per guide #2). Blind transfer only matters if SIP endpoints/PBX agents enter the picture.

## 10. Voicemail and beep detection — `guides.calls.voicemail-detection`  ★FOCUS: outbound campaigns

- **AMD (answering machine detection) module** (`references/voxengine/amd`): ML/AI distinguishes live person vs voicemail prompt vs conversational-AI robot on outgoing calls; adapts behavior (e.g., drop an MP3 into the inbox). Works for any call type incl. SIP. Usage: create AMD instance and pass as call parameter, or create inside the call — event-based or async-await styles. Quality improves over time (ML).
- **CRITICAL ALERT — supported countries ONLY: Brazil, Colombia, Kazakhstan, Mexico, Russia.** Other countries (i.e., **Israel is NOT supported**) must contact Voximplant support to ask for it.
- **Beep detection** (separate, frequency-based, not country-limited):
  - `call.enableBeepDetection({frequencies: [...], timeout: ms})`, `call.disableBeepDetection()`
  - `CallEvents.BeepDetectionComplete` → `frequencies` (detected, ≥1), `timeout` (undefined = beep detected OK, true = timeout reached, false = detection disabled)
  - `CallEvents.BeepDetectionError` → `reason`

**KALFA relevance**: CRITICAL for per-reached-contact billing. AMD is the natural "was a human reached?" gate but is NOT available for Israel without a support request — KALFA must either (a) ask Voximplant support to enable AMD for +972, (b) use frequency-based beep detection tuned to Israeli carrier voicemail beeps, or (c) detect voicemail conversationally via the Groq LLM bridge (silence/greeting heuristics). This directly affects who counts as "reached."

## 11. Web autoplay and device access — `guides.calls.sdk-errors`

Browser-only: autoplay policies (Chrome MEI, Safari per-site), render a manual play button, `PlaybackError` event; mic permission mandatory for calls (`MicAccessResult` true/false; declined mic → `Call.Failed`); camera optional (falls back to mic-only); common getUserMedia exception table.

**KALFA relevance**: none for outbound PSTN; only if a browser softphone is added later.

## 12. Call quality detection — `guides.calls.quality-detection`

Scenario-side: subscribe `CallEvents.AudioQualityDetected`; `quality` = `HD` or `STANDARD`; visible in logs; use for badges/analytics.

**KALFA relevance**: LOW — could be logged per campaign call for QA of the he-IL TTS/telephony path.

---

## Cross-cutting gotchas (this group)

1. AMD unsupported for Israel out of the box (support request required) — the single biggest campaign-dialing gap for KALFA in this section.
2. Early media limited to 60 s.
3. Calls > $0.20/min and calls to Africa blocked by default (support unlock).
4. PSTN caller ID: rented real number, or verified external number; test numbers unusable.
5. `VoxEngine.customData`/`call.customData` = 2000 chars each — bypasses the 200-byte StartScenarios cap for in-session state (and shows up in call history).
6. SIP registrations bill a monthly fee immediately upon creation.
7. Whitelist PBX by IP, never domain; can't take SIP calls from voximplant.com domain.
8. Recorder default is 8 kHz/32 kbps — set `hd_audio` for analysis-grade recordings; retention `expire` max 3 years.
9. Scenarios on the same routing rule share one JS context; cross-session state needs Key-value storage.
10. This group's pages consistently defer specifics to `references/voxengine/*` (Call, CallEvents, AMD, Recorder, CallSIPParameters, CallUserParameters) — covered by the references_voxengine group.

## INVENTORY (all 11 pages in scope — all fetched & read)

1. Calls (folder) — guides.calls
2. Processing calls in scenarios — guides.calls.scenarios
3. Processing voice calls in SDKs — guides.calls.voice
4. Processing video calls in SDKs — guides.calls.video
5. Features available during a call — guides.calls.features
6. SIP calls and registrations — guides.calls.sip
7. Call recording — guides.calls.recording
8. Call streaming — guides.calls.streaming
9. Call transferring — guides.calls.transferring
10. Voicemail and beep detection — guides.calls.voicemail-detection
11. Web autoplay and device access — guides.calls.sdk-errors
12. Call quality detection — guides.calls.quality-detection

(12 entries = 1 folder landing page + 11 tutorials; the manifest has 12 lines — `wc -l` reports 11 because the last line has no trailing newline. All 12 fetched and read.)
