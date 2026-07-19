# Voximplant Docs Research — Group vox-ref-core (VoxEngine core reference)

Fleet: KALFA Voximplant documentation mapping. Group scope: `references.voxengine` root + AppEvents, CallEvents, ASREvents, PlayerEvents, RecorderEvents, WebSocketEvents, VoxEngine namespace, Logger, Crypto, ApplicationStorage, Net, PhoneNumber.
Depth: DEEP — all 69 manifest pages fetched via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` on 2026-07-19.
Note: written to this plan file because the orchestrator passed a literal `undefined/` base path and the session is in plan mode (only this file writable).

---

## 1. references.voxengine (root page)

Index of the whole VoxEngine scenario API: 12 event groups, ~30 module folders (AI, AMD, ApplicationStorage, CallList, Cartesia, Deepgram, ElevenLabs, Gemini, Google, IVR, Logger, Net, OpenAI, PhoneNumber, VoxTTS, VoximplantAvatar, Yandex...), core classes (Call, ASR, Player, Recorder, Conference, WebSocket, StreamingAgent), ~80 parameter interfaces, enums, and **global helper functions** available in every scenario without `require`:

- `base64_encode/base64_decode`, `bytes2hex/hex2bytes`, `bytes2str/str2bytes` (encoding, default utf-8)
- `setTimeout/clearTimeout`, `setInterval/clearInterval` — **setInterval minimum delay is 100 ms** (values <100 coerced to 100)
- `getLocalTime(timezone, date)` — converts a Date to a tz-database timezone; **`new Date()` in VoxEngine is always UTC+0**
- `uuidgen()` — unique id string
- `levenshtein_distance(str1, str2)` — edit distance helper
- `require(Modules.X)`, `trace(data)`
- Modules requiring `require(...)`: ACD, ASR, AI, AMD, ApplicationStorage, Conference, IVR, Recorder, SmartQueue, StreamingAgent. Net, Logger-as-namespace, PhoneNumber pages carry no require line on their leaf pages (Net/Crypto usable directly; PhoneNumber historically `require(Modules.PhoneNumber)` — not stated on these pages).
- Notable interfaces indexed here: TTSOptions (SSML-ish W3C options OR pass provider params raw via `request` JSON), URLPlayerRequest/Body/Header (URL player can POST with custom headers/body), WebSocketParameters, StorageKey/StoragePage, CallPSTNParameters, CallSayParameters.
- CallList folder exists at `references.voxengine.calllist` (out of this group's scope; noted for the CallList evaluation group).

**KALFA relevance:** the root page is the map for everything the AI-call scenario can use; `getLocalTime` (Asia/Jerusalem call-window logic, since Date() is UTC), `levenshtein_distance` (fuzzy-match Hebrew ASR answers), uuidgen (correlation ids for ctx/cb) are free built-ins.

## 2. AppEvents (references.voxengine.appevents) — session lifecycle

- **Started** — very first event of a session (incoming call OR StartScenarios HTTP request). Triggers ONCE; a second HTTP request creates a NEW session. Payload: `accessURL` / **`accessSecureURL`** (URLs for sending commands into this running session from outside — this is the `media_session_access_url` returned by StartScenarios), `accountId`, `applicationId`, `sessionId` (usable with Managing History API), `logURL` (direct link to call log), `conference_name`.
- **HttpRequest** — triggered when a Management-API HTTP request hits the session's access URL. Payload: `method`, `path`, `content` (body string), `headers` (only "X-" headers). Remote session management pattern (see guides/voxengine/remote-sessions).
- **CallAlerting** — incoming call arrives: `call`, `callerid`, `destination`, `displayName`, `fromURI`, `toURI`, `headers` (custom "X-" SIP headers + User-to-User), `customData` (from Web SDK client), `scheme` (codec info to pass into callUser/callSIP/answer).
- **Terminating** — session about to end (no calls/ACD left, or VoxEngine.terminate called). Timers/external resources are dead, BUT **exactly one HTTP request may be performed inside the handler** (e.g., notify external system). When it finishes (or none is made) → Terminated.
- **Terminated** — after Terminating; only `Logger.write` usable in its handler. Param `systemError`.
- **WebSocket** — new incoming WebSocket connection (`websocket` object + method/path/content/headers).
- **NewWebSocketFailed** — incoming WebSocket rejected; happens when incoming WS connections exceed **(number of calls in the session + 3)**.

**KALFA relevance:** Started.accessSecureURL + HttpRequest = the officially supported channel to push arbitrary-size context INTO a running scenario after StartScenarios — a first-class workaround for the 200-byte script_custom_data cap. Terminating's guaranteed single HTTP request = last-chance callback to KALFA `cb` endpoint for call-outcome reconciliation (complements the stuck-call reconciler).

## 3. CallEvents (references.voxengine.callevents) — call lifecycle (40 events)

Core lifecycle:
- **Ringing** — outgoing call got progress signal (headers included).
- **AudioStarted** — remote answered or early media started; fires on SIP **183 Session Progress regardless of actual media packets**; not in P2P mode.
- **Connected** — incoming: after Call.answer; outgoing: when remote answers. Payload: call, id, headers, optional customData (from client accept), scheme.
- **Disconnected** — call terminated (after being connected). Payload: **`cost` (account currency), `duration` (sec), `direction` (billing direction), `internalCode` (e.g. 486), `reason`, headers**. Frequent codes when terminated before answer: 408 not answered in 60 s, 603 rejected, 486 busy, 487 request terminated. NOT the end of the JS session — explicitly call VoxEngine.terminate when done.
- **Failed** — outgoing call terminated BEFORE connection. Payload: `code`, `reason`, headers. Frequent codes: 486 busy, 487 terminated, **404 invalid number, 480 unavailable, 402 insufficient funds, 603 rejected, 408 no answer within 60 s**.
- **StateChanged** — oldState/newState strings.

Playback (fired on the Call object for Call.say / Call.startPlayback):
- **PlaybackReady** — file downloaded to Voximplant cache or found in cache.
- **PlaybackStarted** — includes `duration`.
- **PlaybackFinished** — playback completed; optional `error`. **Call.stopPlayback prevents PlaybackFinished from firing** (gotcha for KALFA's terminal-hangup-on-PlaybackFinished pattern).

DTMF / tones:
- **ToneReceived** — DTMF received; **only after Call.handleTones is enabled**. `tone` (0-9,*,#), `type` (1 rfc2833, 2 inband, 3 SipInfo).
- **ToneDetected** — dial/busy/voicemail tone; only after Connected; **fires only once per call session**; `ProgressTone`, `VoicemailTone` booleans (legacy path; AMD module is the modern one).
- **BeepDetectionComplete / BeepDetectionError** — after Call.enableBeepDetection; `frequencies[]` Hz, `timeout` flag (voicemail-beep detection to time message playback).

Voicemail detection (VMD/AMD server): **AudioIdentificationStarted / Stopped / Error**.

Recording: **RecordStarted** (`url`), **RecordStopped** (`url`, `cost`, `duration`; fires after Disconnected), **RecordError**, **VideoTrackCreated**.

Media/quality: **FirstAudioPacketReceived**, **FirstVideoPacketReceived**, **AudioQualityDetected** (`quality` CallAudioQuality), **MediaStatisticsReceived** (after Call.monitorMediaStatistics; CallMediaStatistics for in/out streams), **Statistics**, **RtpStopped** (fires within **7 s** of RTP/RTCP stopping; all call types), **RtpResumed**, **MicStatusChange** (after Call.handleMicStatus).

SIP/other: **InfoReceived** (SIP INFO: mimeType, body), **MessageReceived** (text), **OnHold/OffHold**, **ReInviteReceived/Accepted/Rejected** (video/screenshare/hold renegotiation), **Forwarding**, **BlindTransferRequested** (after Call.handleBlindTransfer; `transferTo`), **TransferComplete/TransferFailed** (`role`: transferor|target|transferee; code/reason on failure), **PushSent**.

**KALFA relevance:** per-reached-contact billing maps directly onto Failed-vs-Disconnected + code table (486/408/404/402 = not reached; Connected+Disconnected with duration>0 = reached; `cost`/`duration` arrive in Disconnected for reconciliation). RtpStopped(7 s) is a robust dead-air guard; ToneReceived needs handleTones explicitly; stopPlayback suppressing PlaybackFinished matters to the say()-then-hangup flow.

## 4. ASREvents (references.voxengine.asrevents) — require(Modules.ASR)

- **Started** (instance created), **CaptureStarted** (voice detected, collecting audio), **SpeechCaptured** (audio captured, pre-recognition), **Result**, **InterimResult**, **ASRError**, **Stopped** (after ASR.stop; **payload includes `cost` and `duration`**).
- **Result** payload: `text` (some providers call it transcript), `confidence` (**0..100 or 0..1 depending on provider**; 0 = not confident), optional `channelTag`, `languageCode` (BCP-47, detected), `resultEndTime`. Docs strongly recommend: (a) create your own recognition timeout to bound recognition time, (b) decide whether to continue recognition inside the Result handler — otherwise **recognition continues automatically** (and keeps billing).
- **InterimResult** only fires with `ASRParameters.interimResults: true`.

**KALFA relevance:** for the Hebrew RSVP dialog, the Result-handler decision point + manual timeout are the exact hooks needed to bound per-turn latency/cost; confidence-scale ambiguity must be normalized per provider before thresholding yes/no/maybe intents.

## 5. PlayerEvents (references.voxengine.playerevents)

- **Created**, **PlaybackReady** (file cached/downloaded), **Started** (`duration`; NOT fired if createURLPlayer used `onPause:true` — fires after resume), **PlaybackFinished** (success or with `error`), **Error**, **Stopped** (after stop()), **PlaybackBuffering** (playing faster than loading), **PlaybackMarkerReached** (`offset`; via Player.addMarker), **AudioChunksPlaybackFinished** — only for **RealtimeTTSPlayer** instances; payload **`timeToFirstByte`** (ms, request→first audio byte).

**KALFA relevance:** if KALFA moves from Call.say to createTTSPlayer/RealtimeTTSPlayer (e.g., ElevenLabs realtime), TTFB telemetry comes free via AudioChunksPlaybackFinished; PlaybackMarkerReached enables barge-in-style timing marks.

## 6. RecorderEvents (references.voxengine.recorderevents) — require(Modules.Recorder)

- **Started** (`url` of record), **Stopped** (`cost` in account currency, `duration` sec), **RecorderError**.

**KALFA relevance:** recording cost/duration surfaces for per-call cost accounting; recording calls has Israeli-law consent implications (already tracked in the legal gate).

## 7. WebSocketEvents (references.voxengine.websocketevents)

- **CREATED** (`statisticsUrl` if statistics enabled), **OPEN**, **MESSAGE** (`text`), **CLOSE** (`code` WebSocketCloseCode, `reason`, `wasClean`), **ERROR**.
- **MEDIA_STARTED** — third-party audio stream begins playing (`encoding`, `tag`, `customParameters`).
- **MEDIA_ENDED** — fires after **1 second of silence** in the inbound stream; `mediaInfo` (WebSocketMediaInfo), `tag`. The `tag` names one of several audio streams multiplexed over a single WS (can feed 2 audios to 2 media units simultaneously).
- Instance handlers (`onopen/onmessage/onclose/onerror/oncreated`) run right before the addEventListener handlers.

**KALFA relevance:** core contract for a streaming TTS/voice bridge (ElevenLabs realtime option): 1-second-silence end-of-stream semantics + `tag` multiplexing; combine with AppEvents.NewWebSocketFailed limit (calls+3) and VoxEngine.allowWebSocketConnections for inbound sockets.

## 8. VoxEngine namespace (references.voxengine.voxengine) — 36 functions

Session/context:
- **customData(customData?)** → string — set/get custom string tied to the JS session. **Maximum size is 200 bytes** (this is the documented cap KALFA hit for script_custom_data). Session-level customData and Call.customData are independent; a value received from Web SDK does not overwrite VoxEngine's. Values are later retrievable from **call history via Management API or control panel** (audit trail).
- **getSecretValue(name)** → string|undefined — reads a secret stored in the Voximplant panel (undefined if missing). Native secret storage usable instead of shipping keys via HTTP.
- **terminate()** — ends session; only Terminating/Terminated fire afterwards. **Does not stop the current code block — put `return;` after it.**
- **addEventListener/removeEventListener(AppEvents, cb)** — non-function handler ⇒ error + scenario termination when invoked; removeEventListener without cb removes all handlers.

Outbound calling:
- **callPSTN(number, callerid, parameters?)** → Call — E.164 number. **Calls costing >20¢/min and calls to Africa are blocked by default.** CallerID must be: a rented real Voximplant number (test numbers forbidden), a number verified via confirmation call, or the caller ID of an incoming call to a rented number. Can trigger Failed at 60 s (session limits).
- **callSIP(to, parameters)** → Call — external SIP / same-app user; codecs G.722, G.711 u/a-law, Opus, iLBC, H.264, VP8; positional-fallback if parameters isn't an object.
- **callUser(parameters)** / **callUserDirect(incomingCall, username, parameters)** (P2P; say/sendDigits/sendMediaTo unusable; SDK-to-SDK only) / **callConference(conferenceId, callerid, displayName, headers?, scheme?)** / **callWhatsappUser(parameters)** (requires WhatsApp Business account; guides/integrations/whatsapp-calls).
- Helpers (easyprocess GitHub): **easyProcess(call1, call2, onEstablished?, direct?)**, **forwardCallToPSTN(numberTransform?, onEstablished?, {callerid})**, **forwardCallToSIP**, **forwardCallToUser**, **forwardCallToUserDirect**, **playSoundAndHangup(fileURL)** (terminates on playback end/fail/disconnect).

Media unit factories:
- **createTTSPlayer(text, parameters?)** → Player — **text >1500 chars ⇒ PlaybackFinished with error**; after first play the phrase is **cached up to 2 weeks per createTTSPlayer instance**, cache keyed by URL only, **shared across all applications and further sessions**.
- **createURLPlayer(request, parameters?)** → Player — **12 s download timeout**, formats mp3/ogg/flac/wav, **max file 10 MB**, same 2-week cross-app cache; a media unit sends to many but **receives only ONE audio stream — a new incoming stream replaces the previous one**.
- **createToneScriptPlayer(script, parameters?)**, **createSequencePlayer(parameters)** (segments of TTS/URL players).
- **createASR(parameters)** — `profile` required. **createRecorder(parameters)**, **createConference / destroyConference**, **createStreamingAgent(parameters)**.
- **createWebSocket(url, parameters?)** — **`wss://` accepts only domain addresses; `ws://` accepts domain or IP.**
- **sendMediaBetween(u1, u2) / stopMediaBetween(u1, u2)** — bind/unbind two media units bidirectionally.

WebSocket toggles: **allowWebSocketConnections()** (must call to accept incoming WS), **enable/disableTraceForIncomingWebsockets**, **enable/disableStatisticsForIncomingWebsockets**.
Queues: **enqueueACDRequest(queueName, callerid, parameters?)** (require Modules.ACD), **enqueueTask(SmartQueueTaskParameters)**.

**KALFA relevance:** confirms the 200-byte customData cap is a platform constant (Branch A/B gate); getSecretValue can replace the ctx-endpoint delivery of the Groq key; callPSTN caller-ID rules mean KALFA must rent/verify an Israeli number (+972) before production dialing; TTS cache (2 weeks, cross-app) makes repeated Hebrew prompts nearly free; the 1500-char say() limit shapes prompt chunking.

## 9. Net (references.voxengine.net)

- **httpRequest(url, callback, options)** and **httpRequestAsync(url, options)** → Promise<HttpRequestResult>. Defaults: **GET, TCP connect timeout 6 s, total timeout 90 s** — both **can only be decreased**. HTTPS by prefixing `https://`.
- **HttpRequestOptions**: `method` (GET default; postData applies to POST/PUT/PATCH), `postData` (raw UTF-8 string or byte array from str2bytes), `headers` (default `User-Agent: VoxEngine/1.0`), `params`, `rawOutput` (data as byte list; otherwise data undefined and body in `text`), `timeout`, `connectionTimeout`, `enableSystemLog` (**default false — POST body not logged**).
- **HttpRequestResult**: `code` = HTTP 2xx-5xx or internal: **0 VoxEngine limits violated (e.g., HTTP request count exceeded), -1 unknown, -2 malformed URL, -3 host not found, -4 connection error, -5 too many redirects, -6 network error, -7 timeout, -8 internal, -9 response larger than 2 MB**; `text` (non-binary body), `data` (raw bytes if rawOutput), `headers` + `raw_headers`, `error`.
- **sendMail / sendMailAsync(mailServerAddress, from, to, title, body, options?)** — direct SMTP; SendMailOptions: login/password/port/cc/bcc/html; SendMailResult: SMTP `code` + `error`.

**KALFA relevance:** hard envelope for ctx/cb callbacks into Next.js: 6 s connect / 90 s total, 2 MB response cap, and a per-session HTTP-request count limit (code 0) — retries and the Terminating single-request rule must fit inside it; enableSystemLog default false keeps guest PII out of Voximplant logs.

## 10. ApplicationStorage (references.voxengine.applicationstorage) — require(Modules.ApplicationStorage)

Key-value store scoped to the Voximplant application, promise-based:
- **put(key, value, ttl)** → Promise<StorageKey> — create/update. **Key ≤200 chars**; namespace convention `ns:rest` (text before colon), no colon ⇒ key itself is the namespace. **Value ≤2000 chars.** **TTL 0..7,776,000 s (90 days)**, converted to `expireAt` Unix timestamp; **pricing tiered by day-ranges 0-30 / 31-60 / 61-90**.
- **get(key)** → Promise<StorageKey|null>.
- **keys(pattern?, count?)** → Promise<StoragePage> — list keys by namespace pattern; count default **1000**.
- **remove(key)** → Promise<StorageKey> (returned ttl always 0).
- Related interfaces: StorageKey (result of get/put/delete), StoragePage (result of keys).

**KALFA relevance:** the native answer to the 200-byte script_custom_data cap — pre-stage the full per-call context (guest name/nikud text, event data, callback token; ≤2000 chars) under a short key, pass only the key in script_custom_data, `get` it at scenario start; per-application scope matches KALFA's single-app setup; TTL a few days covers campaign windows at the lowest pricing tier. (Cross-check with the KALFA-side alternative: Started.accessSecureURL push or ctx-endpoint fetch.)

## 11. Crypto (references.voxengine.crypto)

- **hmac_sha256(key, data)** → string; **md5(data)**; **sha1(data)**; **sha256(data)** — all return hex-ish string hashes for use in HTTP requests.

**KALFA relevance:** enables HMAC-signing the cb payloads to KALFA (verify authenticity server-side) without extra dependencies — stronger than bearer-token-only, pairs with getSecretValue for the signing key.

## 12. Logger (references.voxengine.logger)

- **write(message)** — writes to the session logger; logs stored in call history (manage.voximplant.com/calls). **Max message length 15,000 chars.**
- **hideTones(flag)** — disable DTMF logging (default false = DTMF logged).

**KALFA relevance:** call logs live in Voximplant's call history — do not Logger.write guest PII/tokens; call hideTones(true) if DTMF ever carries sensitive digits.

## 13. PhoneNumber (references.voxengine.phonenumber)

- **getInfo(number, country?)** → Info — number in country format or E.164 (leading +); country as 2-letter code.
- **Info**: `number` (E.164, +…), `region` (ISO 3166-1 2-letter), `numberType` (FIXED_LINE, MOBILE, FIXED_LINE_OR_MOBILE, TOLL_FREE, PREMIUM_RATE, SHARED_COST, VOIP, PERSONAL_NUMBER, PAGER, UAN, VOICEMAIL, UNKNOWN), `isPossibleNumber` (length check), `isValidNumber`, `isValidNumberForRegion`, `location` (city/state/country), `error` (INVALID_COUNTRY_CODE, NOT_A_NUMBER, TOO_SHORT_AFTER_IDD, TOO_SHORT_NSN, TOO_LONG_NSN).

**KALFA relevance:** in-scenario validation of +972 guest numbers (isValidNumber + numberType MOBILE) before/instead of failing a paid dial attempt; complements KALFA-side normalization.

---

## Cross-cutting gotchas (this group)

1. `VoxEngine.customData` max 200 bytes; separate from `Call.customData`; both visible later in call history via Management API.
2. Outgoing-call methods can fire `Failed` at 60 s (session limits page governs).
3. `terminate()` does not break the current block — `return;` after it.
4. `Call.stopPlayback` suppresses `CallEvents.PlaybackFinished`.
5. `ToneReceived` requires `Call.handleTones`; `ToneDetected` fires once, only post-Connected.
6. Net: timeouts only decreasable (6 s/90 s), 2 MB response cap, per-session request-count limit (code 0).
7. Incoming WebSockets limited to (calls in session + 3); `wss://` requires a domain, not an IP.
8. TTS/URL player cache: 2 weeks, keyed by URL only, shared across ALL applications/sessions (careful with per-guest dynamic audio URLs — vary the URL).
9. `AppEvents.Terminating` handler: exactly one HTTP request allowed; `Terminated`: only Logger.write.
10. ASR Result: confidence scale is provider-dependent (0..1 vs 0..100); recognition auto-continues unless stopped in the handler.
11. setInterval floor 100 ms; `new Date()` is UTC — use getLocalTime for Asia/Jerusalem.
12. `MEDIA_ENDED` = 1 s of silence, not an explicit end-of-stream marker.

## INVENTORY — all 69 pages in scope (fqdn | kind | title) — all fetched

1. references.voxengine | root | VoxEngine
2. references.voxengine.asrevents | events | ASREvents
3. references.voxengine.appevents | events | AppEvents
4. references.voxengine.callevents | events | CallEvents (40 event constants incl. Connected, Disconnected, Failed, Ringing, AudioStarted, PlaybackReady/Started/Finished, ToneReceived, ToneDetected, RecordStarted/Stopped/Error, RtpStopped/Resumed, MediaStatisticsReceived, Transfer*, ReInvite*, AudioIdentification*, BeepDetection*, BlindTransferRequested, InfoReceived, MessageReceived, MicStatusChange, OnHold/OffHold, PushSent, StateChanged, Statistics, Forwarding, FirstAudio/VideoPacketReceived, AudioQualityDetected, VideoTrackCreated)
5. references.voxengine.playerevents | events | PlayerEvents
6. references.voxengine.recorderevents | events | RecorderEvents
7. references.voxengine.websocketevents | events | WebSocketEvents
8. references.voxengine.applicationstorage | ref_folder | ApplicationStorage
9. references.voxengine.applicationstorage.get | function | get
10. references.voxengine.applicationstorage.keys | function | keys
11. references.voxengine.applicationstorage.put | function | put
12. references.voxengine.applicationstorage.remove | function | remove
13. references.voxengine.crypto | ref_folder | Crypto
14. references.voxengine.crypto.hmac_sha256 | function | hmac_sha256
15. references.voxengine.crypto.md5 | function | md5
16. references.voxengine.crypto.sha1 | function | sha1
17. references.voxengine.crypto.sha256 | function | sha256
18. references.voxengine.logger | ref_folder | Logger
19. references.voxengine.logger.hidetones | function | hideTones
20. references.voxengine.logger.write | function | write
21. references.voxengine.net | ref_folder | Net
22. references.voxengine.net.httprequestoptions | interface | HttpRequestOptions
23. references.voxengine.net.httprequestresult | interface | HttpRequestResult
24. references.voxengine.net.sendmailoptions | interface | SendMailOptions
25. references.voxengine.net.sendmailresult | interface | SendMailResult
26. references.voxengine.net.httprequest | function | httpRequest
27. references.voxengine.net.httprequestasync | function | httpRequestAsync
28. references.voxengine.net.sendmail | function | sendMail
29. references.voxengine.net.sendmailasync | function | sendMailAsync
30. references.voxengine.phonenumber | ref_folder | PhoneNumber
31. references.voxengine.phonenumber.info | interface | Info
32. references.voxengine.phonenumber.getinfo | function | getInfo
33. references.voxengine.voxengine | ref_folder | VoxEngine (namespace)
34. references.voxengine.voxengine.addeventlistener | function | addEventListener
35. references.voxengine.voxengine.allowwebsocketconnections | function | allowWebSocketConnections
36. references.voxengine.voxengine.callconference | function | callConference
37. references.voxengine.voxengine.callpstn | function | callPSTN
38. references.voxengine.voxengine.callsip | function | callSIP
39. references.voxengine.voxengine.calluser | function | callUser
40. references.voxengine.voxengine.calluserdirect | function | callUserDirect
41. references.voxengine.voxengine.callwhatsappuser | function | callWhatsappUser
42. references.voxengine.voxengine.createasr | function | createASR
43. references.voxengine.voxengine.createconference | function | createConference
44. references.voxengine.voxengine.createrecorder | function | createRecorder
45. references.voxengine.voxengine.createsequenceplayer | function | createSequencePlayer
46. references.voxengine.voxengine.createstreamingagent | function | createStreamingAgent
47. references.voxengine.voxengine.createttsplayer | function | createTTSPlayer
48. references.voxengine.voxengine.createtonescriptplayer | function | createToneScriptPlayer
49. references.voxengine.voxengine.createurlplayer | function | createURLPlayer
50. references.voxengine.voxengine.createwebsocket | function | createWebSocket
51. references.voxengine.voxengine.customdata | function | customData
52. references.voxengine.voxengine.destroyconference | function | destroyConference
53. references.voxengine.voxengine.disablestatisticsforincomingwebsockets | function | disableStatisticsForIncomingWebsockets
54. references.voxengine.voxengine.disabletraceforincomingwebsockets | function | disableTraceForIncomingWebsockets
55. references.voxengine.voxengine.easyprocess | function | easyProcess
56. references.voxengine.voxengine.enablestatisticsforincomingwebsockets | function | enableStatisticsForIncomingWebsockets
57. references.voxengine.voxengine.enabletraceforincomingwebsockets | function | enableTraceForIncomingWebsockets
58. references.voxengine.voxengine.enqueueacdrequest | function | enqueueACDRequest
59. references.voxengine.voxengine.enqueuetask | function | enqueueTask
60. references.voxengine.voxengine.forwardcalltopstn | function | forwardCallToPSTN
61. references.voxengine.voxengine.forwardcalltosip | function | forwardCallToSIP
62. references.voxengine.voxengine.forwardcalltouser | function | forwardCallToUser
63. references.voxengine.voxengine.forwardcalltouserdirect | function | forwardCallToUserDirect
64. references.voxengine.voxengine.getsecretvalue | function | getSecretValue
65. references.voxengine.voxengine.playsoundandhangup | function | playSoundAndHangup
66. references.voxengine.voxengine.removeeventlistener | function | removeEventListener
67. references.voxengine.voxengine.sendmediabetween | function | sendMediaBetween
68. references.voxengine.voxengine.stopmediabetween | function | stopMediaBetween
69. references.voxengine.voxengine.terminate | function | terminate

Fetch method note: pages 34, 36-41, 51, 55, 64-69 fetched in full; pages 35, 42-50, 52-54, 56-63 fetched and verified (title/kind/params/description) — their full bodies are verbatim duplicates of the children dump captured from page 33 (references.voxengine.voxengine), which was fetched in full.
