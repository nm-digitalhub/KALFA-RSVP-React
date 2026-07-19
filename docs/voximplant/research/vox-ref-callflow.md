# Voximplant VoxEngine Reference Notes — group vox-ref-callflow

Fleet research notes. Scope: `references.voxengine.` prefixes `calllist`, `ivr` (+ivrstate/ivrsettings/ivrprompt), `amd`, `acdevents`, `conferenceevents`, `sequenceplayerevents`, `smartqueueevents`, `streamingagentevents`, `voicelist`, `voxtts` (+voxttsmodellist/voxttsvoicelist), `asrmodellist`, `asrprofilelist`, `measurementprotocol`.
Source: `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` (public docs API). 92 pages in scope, all fetched (folder pages return their entire subtree recursively; leaves cross-checked individually).

NOTE: written to this plan file because plan mode was active during the session; intended path was `<scratchpad>/vox-research/vox-ref-callflow.md`.

---

## 1. CallList module (FULL — user-goal focus)

Namespace for scenarios launched as part of a Voximplant **call list** (CSV-driven campaign dialing managed by the platform; the list itself is created/managed via the Management API — outside this group's scope). The scenario reports task outcomes back to the call-list engine with these 8 functions (each has a sync form taking an optional `callback(result)` and an `...Async` form returning `Promise<HttpRequestResult>` — `/docs/references/voxengine/net/httprequestresult`):

- **reportResult(result: string|Object, callback?)** / **reportResultAsync(result)** — reports SUCCESS, saves the report into the task's `result_data` field in the sheet, **stops further attempts for this task** and proceeds to the next task.
- **reportError(error: string|Object, callback?)** / **reportErrorAsync(error)** — reports a FAILED attempt and continues the call list (task remains eligible for retry).
  - **CRITICAL GOTCHA (verbatim semantics):** "If you do not call this method … the call list considers this task successful and does not make any more attempts to call this task." I.e. a scenario that ends without calling reportResult *or* reportError silently marks the task successful — no retry. Every code path (busy, no-answer, crash guard, timeout) must explicitly report.
- **reportProgress(progress: string|Object, callback?)** / **reportProgressAsync(progress)** — intermediate progress ping to the CallList module (no state change documented).
- **requestNextAttempt(data: Object, callback?)** / **requestNextAttemptAsync(data)** — "Editable call lists": changes parameters of the CURRENT task and requests another attempt with updated data. Can change exactly these task fields: `start_at`, `attempts_left`, `custom_data`, `start_execution_time`, `end_execution_time`, `next_attempt_time`. New values apply to all remaining attempts; global call-list settings are NOT changed.
  - If you do not set `attempts_left` manually, the engine auto-decrements it by 1.
  - After an unsuccessful attempt, provide an `error` field in the data object.
  - Cross-ref guide: `/docs/guides/solutions/editable-call-lists`.

**KALFA relevance:** This is the platform-native campaign dialer KALFA is evaluating. Per-task `custom_data` lives in the uploaded list row (not in `script_custom_data`), so the ~200-byte StartScenarios cap does not apply per guest; retry cadence (`next_attempt_time`, `attempts_left`) is task-editable at runtime (e.g. guest said "call me tomorrow" → requestNextAttempt with new `start_at`); `result_data` is a natural audit artifact for per-reached-contact billing. Mandatory-report semantics must be wired into every scenario exit path, matching KALFA's stuck-call reconciler philosophy.

## 2. AMD — Answering Machine Detection (focus)

Module (`require` per AMD guide `/docs/guides/calls/voicemail-detection`) that recognizes voicemail prompts with AI.

- **AMD.create(parameters: AMD.Parameters) → AnsweringMachineDetector**. Attach audio later via any `VoxMediaUnit.sendMediaTo` (i.e. route the call's media into the detector).
- **AMD.Parameters**: `model: AMD.Model` (required); `thresholds?: AMD.Thresholds`; `timeout?: number` ms — default **6500**, range 0–**20000**, and the timeout only starts counting after `CallEvents.Connected`.
- **AMD.Thresholds** (each 0.0–1.0, optional): `human`, `mimic`, `voicemail`.
- **AnsweringMachineDetector**: `detect()` → `Promise<DetectionComplete|DetectionError>`; `addEventListener/removeEventListener` (non-function handler ⇒ error + scenario termination); `id()`; props `call?`, `model`, `timeout?`.
- **AMD.Events.DetectionComplete** handler payload: `amd`, `call`, `callId`, `confidence?` (0–100, "not guaranteed to be accurate, consider it while handling the event"), `resultClass`, `resultSubtype?`.
- **AMD.Events.DetectionError**: `amd`, `callId?`, `message`.
- **AMD.ResultClass** enum: `HUMAN`, `VOICEMAIL`, `TIMEOUT` (recognition timeout reached), `CALL_ENDED` (hangup during detection).
- **AMD.ResultSubtype** enum: `MIMIC` ("AI-powered answering machine that mimics human voice and conversation style"), `NONE` (other machine types).
- **AMD.Model** enum is COUNTRY-specific: `BR`, `CL`, `CO`, `ES` (Spanish), `EU_GENERAL` ("General European multilingual model"), `KZ`, `MX`, `PE`, `PH`, `RU`, `US`. **There is NO Israel/Hebrew model.**

**KALFA relevance:** AMD could stop billing-relevant flows on voicemail (per-reached billing) and skip TTS monologues to machines, but with no IL model the only candidate is `EU_GENERAL`, which is untested for Hebrew/Israeli voicemail prompts — must be validated empirically on real +972 calls before trusting; treat `confidence` as advisory. `MIMIC` detection is a nice defense against AI answering services.

## 3. VoiceList (TTS voices for call.say / createTTSPlayer) — focus he-IL

Structure: `VoiceList.<Provider>[.Neural].<VoiceName>` consts, all typed `Voice`. Providers: Amazon (+Neural), Default (freemium), ElevenLabs, Google, IBM (+Neural), Microsoft (+Neural), SaluteSpeech, TBank, Yandex (+Neural), YandexV3. All premium TTS billed per Voximplant pricing. ~2.9k voice consts total across providers.

**Hebrew (he-IL) coverage — the complete picture:**
- **Google: 38 Hebrew voices** —
  - `he_IL_Chirp3_HD_*`: **30 voices** (16 male: Achird, Algenib, Algieba, Alnilam, Charon, Enceladus, Fenrir, Iapetus, Orus, Puck, Rasalgethi, Sadachbia, Sadaltager, Schedar, Umbriel, Zubenelgenubi; 14 female: Achernar, Aoede, Autonoe, Callirrhoe, Despina, Erinome, Gacrux, Kore, Laomedeia, Leda, Pulcherrima, Sulafat, Vindemiatrix, Zephyr).
  - `he_IL_Wavenet_A/B/C/D` (A,C female; B,D male).
  - `he_IL_Standard_A/B/C/D` (A,C female; B,D male).
  - No he-IL Neural2 / Studio / Journey families.
- **Microsoft Neural**: `he_IL_AvriNeural` (male), `he_IL_HilaNeural` (female) — only 2.
- **YandexV3**: `he_IL_naomi` (female, "Neural Yandex voice, Hebrew female, Naomi") — note plain `Yandex.Neural` folder has NO Hebrew, only YandexV3 does.
- **No Hebrew at all** in: Amazon (incl. Neural), IBM (incl. Neural), Default (freemium — 28 voices, mainstream EU/Asia locales only), SaluteSpeech (ru only + createBrandVoice), TBank (ru only).
- **ElevenLabs**: 20 named voices (Alice, Aria, Bill, Brian, Callum, Charlie, Charlotte, Chris, Daniel, Eric, George, Jessica, Laura, Liam, Lily, Matilda, River, Roger, Sarah, Will), each described by accent/style ("female, middle-aged, British, confident, news" etc.) — the reference does not state per-language coverage; plus `createBrandVoice(name: string) => Voice` — "To use this method, please contact support."

**KALFA relevance:** confirms the memory-recorded A/B plan (he_IL_Chirp3_HD family) has 30 candidate voices; Wavenet/Standard are the older fallbacks. If leaving Google: Microsoft Hila/Avri or YandexV3 Naomi are the only other in-platform Hebrew voices. ElevenLabs is already integrated as a native VoiceList provider — trying ElevenLabs voices for Hebrew is a one-line change to `call.say()`, no custom WebSocket bridge needed (voice quality in Hebrew must be tested; docs don't claim it).

## 4. VoxTTS (Voximplant native realtime TTS)

- **VoxTTS.createRealtimeTTSPlayer(parameters: RealtimeTTSPlayerParameters) → RealtimeTTSPlayer**; attach media via `sendMediaTo` or `VoxEngine.sendMediaBetween`.
- **RealtimeTTSPlayerParameters**: `apiKey?` (bring your own VoxTTS key), `createContextParameters` (required), `trace?` (diagnostic: uploads full WS message log to S3, URL appears in 'websocket.created').
- **CreateContextParameters** typedef: `{contextId?: string, create?: {modelId: VoxTTSModelList, voiceId: VoxTTSVoiceList, cloning: Object}}`.
- **VoxTTSSendParameters** typedef: `{contextId?: string, send_text: {text: string, flush_context: Object}}`.
- **RealtimeTTSPlayer** methods: `send(parameters)` (stream text chunks into the provider context), `clearBuffer()`, `pause()/resume()`, `stop()` (destroys instance), `sendMediaTo/stopMediaTo`, `addEventListener/removeEventListener` (PlayerEvents, e.g. PlaybackFinished), `id()`.
- **VoxTTSModelList** enum: single member `VoxTTS`. **VoxTTSVoiceList** enum: `Anna`, `Sergey` only — **no Hebrew**.

**KALFA relevance:** not usable for Hebrew today (2 Russian-named voices). Architecturally though, this contextId + send_text streaming player is the same realtime pattern as the ElevenLabs/Cartesia realtime players (docs cross-link cartesia paths) — the shape to adopt if moving from sentence-level `call.say()` to streamed LLM→TTS with barge-in (`clearBuffer`).

## 5. IVR module (DTMF menu state machine)

`require(Modules.IVR);`

- **IVRState(name, settings: IVRSettings, onInputComplete(input), onInputTimeout(input))** class; `enter(call)` starts the IVR at this state for a call; `input` prop holds user input after leaving a state; `settings` prop.
- **IVRSettings**: `type` — `select` (single digit routed via `nextStates` map; unmatched input → onInputComplete), `inputfixed` (fixed `inputLength`), `inputunknown` (free-length; `terminateOn` digit ends input, `inputValidator(input)=>boolean` checks completeness), `noinput` (just prompt → `nextState`); `prompt: IVRPrompt`; `timeout` ms (default **5000**).
- **IVRPrompt** typedef: either `{say, lang}` (TTS) or `{play}` (URL) — exactly one form.
- **IVR.reset()** — clears all IVRState instances to stop IVR logic (e.g., near call end).

**KALFA relevance:** ready-made deterministic fallback for RSVP capture — "הקישו 1 לאישור, 2 לסירוב" — when ASR/LLM fails, the guest stays silent, or as an accessibility path. `say`+`lang` works with the same TTS voices; niqqud-tuned text applies.

## 6. Module event namespaces

### ACDEvents (`require(Modules.ACD)`) — legacy operator-queue events
`Error` (internal/network only), `Offline` (all agents for the queue offline → request NOT queued), `OperatorCallAttempt` (ACD dials agent via callUser), `OperatorFailed` (agent declined; auto-redirects to next free agent; has `statusCode`), `OperatorReached` (established agent call), `QueueFull` (max_queue_size reached → not queued; defaults for max_queue_size/max_waiting_time are "unlimited", editable in control panel), `Queued`, `Waiting` (from ACDRequest.getStatus: `ewt` in MINUTES, `position`).

### SmartQueueEvents (`require(Modules.SmartQueue)`) — modern contact-center queue
`ClientDisconnected` (**gotcha: you must call `e.cancel()` inside the handler yourself** to cancel/remove the task), `EnqueueSuccess`, `Error` (`type: TerminationStatus`), `OperatorReached` (task success; `agentCall`), `TaskCanceled` (`status: TerminationStatus`), `TaskDistributed` (`operatorId`/`operatorName`; **can fire multiple times** if an agent doesn't respond within timeout), `Waiting` (**fires every 10–15 s**; `ewt` in MILLISECONDS, `position`, `code: TaskWaitingCode`).

### ConferenceEvents (`require(Modules.Conference)`)
`Started` (on createConference), `Stopped` (on Conference.stop), `EndpointAdded` / `EndpointManaged` / `EndpointRemoved` / `EndpointUpdated` (each carries `direction: SEND|RECEIVE|BOTH`, `mode: MIX|FORWARD` — MIX combines all streams, FORWARD sends a single stream; `endpoint`, `endpointId`), `ConferenceError` (`code`, `error`, `endpointId?`).

### SequencePlayerEvents
`Created`, `PlaybackReady` (fires when ALL segment audio files are downloaded to Voximplant cache, or already cached), `Started` (first segment starts), `PlaybackFinished` (success OR error; `error?`), `PlaybackMarkerReached` (`offset` — from SequencePlayer.addMarker), `Error`, `Stopped` (via stop()).

### StreamingAgentEvents (`require(Modules.StreamingAgent)`) — stream call media to external streaming platforms
`Connected`, `ConnectionFailed`, `Disconnected`, `Error` (object creation failed, e.g. bad server URL), `StreamError` (e.g. codec mismatch), `StreamStarted`, `StreamStopped`, `AudioStreamCreated`/`VideoStreamCreated` (`trackId`, −1 = no track), `AudioSwitched`/`VideoSwitched` (`reason`: "New stream" | "Set stream").

**KALFA relevance:** none of these five are needed for the current guest-confirmation flow (no human agents, no conferences, no livestreaming). SmartQueue is the documented pattern should KALFA ever add "transfer to the event owner / human" escalation; SequencePlayer markers could stitch pre-rendered niqqud audio segments with precise timing.

## 7. ASRModelList / ASRProfileList (`require(Modules.ASR)`)

Passed via `ASRParameters.model` / `ASRParameters.profile`.

**ASRModelList** (per provider):
- **Google** (8): `DEFAULT`, `command_and_search`, `phone_call` ("best for audio that originated from a phone call, typically 8 kHz"), `video`, each with `_enhanced` variant — **enhanced models cost more than the standard rate**.
- **Deepgram** (27): `DEFAULT`(=General), `conversational`, `finance(_enhanced)`, `general(_enhanced)`, `meeting(_enhanced)`, `phonecall(_enhanced)`, `video`, `voicemail`, `nova_general`, `nova_phonecall`, `nova2_{atc,automotive,conversationalai,drivethru,finance,general,medical,meeting,phonecall,video,voicemail}`, `nova3_general`, `nova3_medical`.
- **Amazon** (1): `DEFAULT` (phone-call oriented, 8 kHz).
- **Microsoft** (1): `DEFAULT`.
- **SaluteSpeech** (4): incl. `callcenter`. **TBank** (1): `DEFAULT`.
- **Yandex / YandexV3** (7 each): incl. `dates` (months/numbers; ru_RU only).

**ASRProfileList** (locales; Hebrew focus):
- **Google** (~154 locales): **`iw_IL` = Hebrew (Israel)** — note the legacy `iw` ISO code, not `he`. Also `ar_IL` = Arabic (Israel) and `ar_PS`. Massive global coverage.
- **Microsoft** (148): **`he_IL` Hebrew (Israel)** present.
- **Yandex** and **YandexV3** (17 each): **`he_IL` Hebrew (Israel)** present + `auto` (automatic language recognition).
- **Deepgram** (32): da, de, en(+AU/GB/IN/NZ/US), es(+419), fr(+CA), hi(+Latn), id, it, ja, ko, nl, no, pl, pt(+BR/PT), ru, sv, ta, tr, uk, zh(+CN/TW) — **NO Hebrew**.
- **Amazon** (5): English variants only — no Hebrew. **SaluteSpeech/TBank** (1 each): `ru_RU` only.

**KALFA relevance:** for Hebrew speech recognition inside VoxEngine the real options are **Google `iw_IL`** (pair with `phone_call`/`phone_call_enhanced` for 8 kHz telephony audio) and **Microsoft `he_IL`**; Yandex he_IL exists but is a RU-centric provider. **Deepgram — including nova-3 — cannot transcribe Hebrew here.** `ar_IL` enables an Arabic guest path later.

## 8. MeasurementProtocol

"Implementation of the Measurement Protocol v1" — i.e. Google **Universal Analytics** MP v1 client for scenarios. Chainable API: `setup(trackingId, debug, dataSource)`; `startSession(options)` / `endSession()` (force session boundary; other values ignored); `setSessionByCallerId(options)` (async; `callerId`, `userID`, `IPOverride`, `anonymizeIP`); `setTrafficSource(options)` (campaign name/source/medium/keyword/content/ID, `documentReferrer`, `googleAdsID`, `googleDisplayAdsID`); `setApplicationInfo({name, version, id, installerID})`; `sendEvent({category, action, label?, value?, nonInteractionHit?})`; `sendException({description?, isFatal?})`; `sendTiming({category?, name?, label?, time?})`; `sendSocial({network?, action?, trigger?})`; `sendItem` / `sendTransaction` (UA e-commerce hits: price/quantity/transactionId; revenue/tax/shipping).

**KALFA relevance:** effectively dead tech — UA MP v1 was retired by Google (GA4 uses a different protocol). Do NOT build call analytics on this; keep using KALFA's own ctx/cb callbacks + DB + Slack ops alerting.

---

## Cross-cutting gotchas recap

1. CallList tasks default to "successful, no retry" when the scenario reports nothing — report in every exit path.
2. `requestNextAttempt` auto-decrements `attempts_left` unless explicitly set; supply `error` after failed attempts.
3. AMD has no Israel model; timeout counts from CallEvents.Connected; `confidence` explicitly unreliable; non-function event handlers terminate the scenario.
4. Google Hebrew ASR profile uses legacy code `iw_IL` (easy to miss when searching "he").
5. Deepgram (all models incl. nova3) has no Hebrew profile in Voximplant.
6. Google `_enhanced` ASR models and all premium TTS voices carry higher rates.
7. Yandex Hebrew TTS voice exists only under `YandexV3`, not `Yandex.Neural`.
8. SmartQueue `ClientDisconnected` requires manual `e.cancel()`; `Waiting` ewt is ms in SmartQueue but MINUTES in legacy ACD.
9. VoxTTS `trace:true` uploads full WS logs to S3 — diagnostics only (privacy).
10. ElevenLabs/SaluteSpeech `createBrandVoice` requires contacting Voximplant support.

---

## INVENTORY (all 92 in-scope pages; ✓ = content fetched & read)

### Module events (5)
1. ✓ ACDEvents (events) — references.voxengine.acdevents
2. ✓ ConferenceEvents (events) — references.voxengine.conferenceevents
3. ✓ SequencePlayerEvents (events) — references.voxengine.sequenceplayerevents
4. ✓ SmartQueueEvents (events) — references.voxengine.smartqueueevents
5. ✓ StreamingAgentEvents (events) — references.voxengine.streamingagentevents

### AMD (9)
6. ✓ AMD (ref_folder) — references.voxengine.amd
7. ✓ Events (events) — references.voxengine.amd.events
8. ✓ AnsweringMachineDetector (class) — references.voxengine.amd.answeringmachinedetector
9. ✓ Parameters (interface) — references.voxengine.amd.parameters
10. ✓ Thresholds (interface) — references.voxengine.amd.thresholds
11. ✓ create (function) — references.voxengine.amd.create
12. ✓ Model (enum) — references.voxengine.amd.model
13. ✓ ResultClass (enum) — references.voxengine.amd.resultclass
14. ✓ ResultSubtype (enum) — references.voxengine.amd.resultsubtype

### ASRModelList (9)
15. ✓ ASRModelList (ref_folder) — references.voxengine.asrmodellist
16. ✓ Amazon (ref_folder) — references.voxengine.asrmodellist.amazon
17. ✓ Deepgram (ref_folder) — references.voxengine.asrmodellist.deepgram
18. ✓ Google (ref_folder) — references.voxengine.asrmodellist.google
19. ✓ Microsoft (ref_folder) — references.voxengine.asrmodellist.microsoft
20. ✓ SaluteSpeech (ref_folder) — references.voxengine.asrmodellist.salutespeech
21. ✓ TBank (ref_folder) — references.voxengine.asrmodellist.tbank
22. ✓ Yandex (ref_folder) — references.voxengine.asrmodellist.yandex
23. ✓ YandexV3 (ref_folder) — references.voxengine.asrmodellist.yandexv3

### ASRProfileList (9)
24. ✓ ASRProfileList (ref_folder) — references.voxengine.asrprofilelist
25. ✓ Amazon (ref_folder) — references.voxengine.asrprofilelist.amazon
26. ✓ Deepgram (ref_folder) — references.voxengine.asrprofilelist.deepgram
27. ✓ Google (ref_folder) — references.voxengine.asrprofilelist.google
28. ✓ Microsoft (ref_folder) — references.voxengine.asrprofilelist.microsoft
29. ✓ SaluteSpeech (ref_folder) — references.voxengine.asrprofilelist.salutespeech
30. ✓ TBank (ref_folder) — references.voxengine.asrprofilelist.tbank
31. ✓ Yandex (ref_folder) — references.voxengine.asrprofilelist.yandex
32. ✓ YandexV3 (ref_folder) — references.voxengine.asrprofilelist.yandexv3

### CallList (9)
33. ✓ CallList (ref_folder) — references.voxengine.calllist
34. ✓ reportError (function) — references.voxengine.calllist.reporterror
35. ✓ reportErrorAsync (function) — references.voxengine.calllist.reporterrorasync
36. ✓ reportProgress (function) — references.voxengine.calllist.reportprogress
37. ✓ reportProgressAsync (function) — references.voxengine.calllist.reportprogressasync
38. ✓ reportResult (function) — references.voxengine.calllist.reportresult
39. ✓ reportResultAsync (function) — references.voxengine.calllist.reportresultasync
40. ✓ requestNextAttempt (function) — references.voxengine.calllist.requestnextattempt
41. ✓ requestNextAttemptAsync (function) — references.voxengine.calllist.requestnextattemptasync

### IVR (5)
42. ✓ IVR (ref_folder) — references.voxengine.ivr
43. ✓ reset (function) — references.voxengine.ivr.reset
44. ✓ IVRState (class) — references.voxengine.ivrstate
45. ✓ IVRSettings (interface) — references.voxengine.ivrsettings
46. ✓ IVRPrompt (typedef) — references.voxengine.ivrprompt

### MeasurementProtocol (23)
47. ✓ MeasurementProtocol (ref_folder) — references.voxengine.measurementprotocol
48. ✓ SendEventOptions (interface) — .measurementprotocol.sendeventoptions
49. ✓ SendExceptionOptions (interface) — .measurementprotocol.sendexceptionoptions
50. ✓ SendItemOptions (interface) — .measurementprotocol.senditemoptions
51. ✓ SendSocialOptions (interface) — .measurementprotocol.sendsocialoptions
52. ✓ SendTimingOptions (interface) — .measurementprotocol.sendtimingoptions
53. ✓ SendTransactionOptions (interface) — .measurementprotocol.sendtransactionoptions
54. ✓ SetApplicationInfoOptions (interface) — .measurementprotocol.setapplicationinfooptions
55. ✓ SetSessionByCallerIdOptions (interface) — .measurementprotocol.setsessionbycalleridoptions
56. ✓ SetTrafficSourceOptions (interface) — .measurementprotocol.settrafficsourceoptions
57. ✓ StartSessionOptions (interface) — .measurementprotocol.startsessionoptions
58. ✓ endSession (function) — .measurementprotocol.endsession
59. ✓ sendEvent (function) — .measurementprotocol.sendevent
60. ✓ sendException (function) — .measurementprotocol.sendexception
61. ✓ sendItem (function) — .measurementprotocol.senditem
62. ✓ sendSocial (function) — .measurementprotocol.sendsocial
63. ✓ sendTiming (function) — .measurementprotocol.sendtiming
64. ✓ sendTransaction (function) — .measurementprotocol.sendtransaction
65. ✓ setApplicationInfo (function) — .measurementprotocol.setapplicationinfo
66. ✓ setSessionByCallerId (function) — .measurementprotocol.setsessionbycallerid
67. ✓ setTrafficSource (function) — .measurementprotocol.settrafficsource
68. ✓ setup (function) — .measurementprotocol.setup
69. ✓ startSession (function) — .measurementprotocol.startsession

### VoiceList (15)
70. ✓ VoiceList (ref_folder) — references.voxengine.voicelist
71. ✓ Amazon (ref_folder) — references.voxengine.voicelist.amazon
72. ✓ Amazon/Neural (ref_folder) — references.voxengine.voicelist.amazon.neural
73. ✓ Default (ref_folder) — references.voxengine.voicelist.default
74. ✓ ElevenLabs (ref_folder) — references.voxengine.voicelist.elevenlabs
75. ✓ Google (ref_folder) — references.voxengine.voicelist.google
76. ✓ IBM (ref_folder) — references.voxengine.voicelist.ibm
77. ✓ IBM/Neural (ref_folder) — references.voxengine.voicelist.ibm.neural
78. ✓ Microsoft (ref_folder) — references.voxengine.voicelist.microsoft
79. ✓ Microsoft/Neural (ref_folder) — references.voxengine.voicelist.microsoft.neural
80. ✓ SaluteSpeech (ref_folder) — references.voxengine.voicelist.salutespeech
81. ✓ TBank (ref_folder) — references.voxengine.voicelist.tbank
82. ✓ Yandex (ref_folder) — references.voxengine.voicelist.yandex
83. ✓ Yandex/Neural (ref_folder) — references.voxengine.voicelist.yandex.neural
84. ✓ YandexV3 (ref_folder) — references.voxengine.voicelist.yandexv3

### VoxTTS (8)
85. ✓ VoxTTS (ref_folder) — references.voxengine.voxtts
86. ✓ RealtimeTTSPlayer (class) — references.voxengine.voxtts.realtimettsplayer
87. ✓ RealtimeTTSPlayerParameters (interface) — references.voxengine.voxtts.realtimettsplayerparameters
88. ✓ createRealtimeTTSPlayer (function) — references.voxengine.voxtts.createrealtimettsplayer
89. ✓ CreateContextParameters (typedef) — references.voxengine.voxtts.createcontextparameters
90. ✓ VoxTTSSendParameters (typedef) — references.voxengine.voxtts.voxttssendparameters
91. ✓ VoxTTSModelList (enum) — references.voxengine.voxttsmodellist
92. ✓ VoxTTSVoiceList (enum) — references.voxengine.voxttsvoicelist
