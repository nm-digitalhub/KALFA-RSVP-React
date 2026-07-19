# VoxEngine Reference — Gap A Synthesis (72 pages)

> Note on process: this sub-agent session had plan mode active, which restricts it to
> read-only actions plus edits to this one plan file. The requested scratchpad write
> (`vox-research/vox-ref-gap-a.md` via Bash heredoc) was therefore not performed — the
> full synthesis below was written here instead and is also being relayed directly to
> the team lead as the final message text.

Source: `scratchpad/vox-research/raw/gap-a-raw.md` (72 pages, fully read, lines 1-4801).
Cross-reference: `scratchpad/vox-manifests/voxengine-orphans.txt`.

---

## 1. Call (class) — EXTRA DEPTH

Represents a single audio/video call leg (inbound or outbound). This is the core object
KALFA's outbound RSVP scenario drives from `AppEvents.CallAlerting`/`CallEvents.Connected`
through hangup.

**Identity / metadata methods**
- `callerid()` → string — the CallerID shown to the callee. **Only real rented numbers
  work as CallerID; Voximplant test numbers cannot be used.** Direct implication for
  KALFA: whatever number is configured as caller ID for outbound RSVP calls must be a
  real purchased/verified number, not a test number.
- `displayName()` → string — human-readable caller name shown to callee (the "person's
  name" version of callerid).
- `clientType()` → string — one of `'pstn' | 'sip' | 'user' | 'wab'`. Lets scenario code
  branch behavior by leg type (e.g., a WhatsApp Business [`'wab'`] leg vs PSTN).
- `number()` → string — dialed number of the call.
- `id()` → string — unique call id within the JS session.
- `incoming()` → boolean.
- `state()` → string — `TERMINATED | CONNECTED | PROGRESSING | ALERTING`.
- `toString()` → human-readable status string (debug/log use).
- `customData(customData?: string)` → get/set a string tied to the Call object, **max
  200 bytes**. Can arrive pre-set from WEB/iOS/Android SDK `call()`/`answer()` calls;
  always overwritable in scenario code. KALFA relevance: this is the natural place to
  smuggle `{eventId, guestId, token}`-style correlation data onto a leg if not already
  passed via scenario script args — but the 200-byte cap means only compact identifiers
  (not full JSON with names), consistent with the already-known 200-byte
  `script_custom_data` cap noted in the Branch A/B bridge plan.

**Answering / rejecting**
- `answer(extraHeaders?, parameters?: CallAnswerParameters)` — non-P2P leg answer. Can be
  preceded by `startEarlyMedia()`.
- `answerDirect(peerCall, extraHeaders?, parameters?)` — P2P-only answer variant.
- `decline(code, extraHeaders?)` / `reject(code, extraHeaders?)` — reject with a SIP
  status code (3xx/4xx/5xx/6xx). `reject()` fires `CallEvents.Disconnected` immediately
  and app termination events ~60s later; `decline()` doc is terser but semantically the
  same rejection path for incoming calls.
- `ring(extraHeaders?)` — device-level ringback (depends on endpoint behavior, not cloud).
- `playProgressTone(country: 'US'|'RU')` — cloud-generated, country-specific dial tone;
  needs `startEarlyMedia()` first if call isn't connected yet.

**Media/playback — the ones the brief asked for extra depth on**
- `say(text: string, parameters?: CallSayParameters)` — TTS to a **connected** call only.
  Hard limit: **text > 1500 characters** triggers `PlayerEvents.PlaybackFinished` with an
  error instead of playing. Supports a `<say-as stress='1'></say-as>` tag to force
  syllable stress — useful for Hebrew name/word pronunciation tuning beyond niqqud (see
  `voximplant-say-no-ssml` memory: full SSML is read literally by Google he-IL, but this
  specific stress tag is documented as a supported exception worth testing). **Gotcha
  restated in this page**: each Call can *send* media to any number of media units but
  can only *receive* one audio stream — a new incoming stream always replaces the
  previous one. This applies to `say()`, `startPlayback()`, `sendMediaTo()`, `ring()`,
  `playProgressTone()` alike — they all compete for the single outbound-media slot when
  layered.
- `startPlayback(url: string, parameters?: StartPlaybackParameters)` — play a hosted
  audio file to an answered call. Formats: mp3, ogg, flac, wav; **max file size 10 MB**;
  cached after first play. Stoppable via `stopPlayback()`. `StartPlaybackParameters` (own
  page) exposes `loop` and `progressivePlayback` (chunked delivery to cut playback
  latency, default false).
- `record(parameters?: CallRecordParameters)` — starts recording in+out audio for the
  call, fires `CallEvents.RecordStarted`. Default quality **8kHz/32kbps mp3**. Full
  `CallRecordParameters` breakdown below (see §4, Recorder family).
- `handleTones(doHandle: boolean, supportedDtmfTypes?: DTMFType)` — toggles DTMF
  processing (in-band, RFC 2833, SIP INFO). Default `doHandle = true`, default type
  `ALL`. When enabled, each DTMF digit both fires `CallEvents.ToneReceived` **and is
  stripped from the audio stream** (so it won't leak into recordings/ASR as noise).
- `sendDigits(digits: string)` — send DTMF outbound; accepts `0-9 * # p` (p = pause).
- `hangup(extraHeaders?)` — attempts call termination. Fires `CallEvents.Disconnected` if
  the call was active, or `CallEvents.Failed` if it was an outgoing call never
  connected. If no other active calls/SmartQueue requests remain in the session,
  `AppEvents.Terminating`/`AppEvents.Terminated` fire **60 seconds later** (documented
  session-limit behavior — matters for scenario cleanup timing expectations).
- `enableBeepDetection(parameters: CallEnableBeepDetectionParameters)` /
  `disableBeepDetection()` — detects beeps (e.g., voicemail beep) in the call audio.
  Params: `frequencies` (Hz array, optional) and `timeout` (ms, optional). This is
  distinct from `amd` (Answering Machine Detection, a boolean/config prop on the
  `CallPSTNParameters`/`CallSIPParameters`/`CallUserParameters` interfaces) — AMD
  classifies human-vs-machine pickup, beep detection specifically catches the tone (e.g.
  to time a voicemail drop). KALFA relevance: if RSVP calls ever need voicemail-drop
  behavior instead of just hanging up on machine pickup, this is the mechanism.
- `handleMicStatus(handle: boolean)` — default **false**; when enabled, fires
  `CallEvents.MicStatusChange` on each mic-state change (WebRTC/SDK legs only,
  meaningless for PSTN).
- `startEarlyMedia(extraHeaders?, scheme?, maxVideoBitrate?, audioLevelExtension?,
  conferenceCall?, disableDtxForAudio?)` — informs the endpoint that early media is
  being sent before the call is formally answered (voicemail-style prompts / hold
  music). **Unanswered calls can only stay in "early media" state for 60 seconds**
  (session limit). Does not let you *listen* to the far end, only push audio to it.
- `monitorMediaStatistics(parameters: MonitorMediaStatisticsParameters)` — turns on
  periodic `CallEvents.MediaStatisticsReceived` events. `interval` must be **3–10
  seconds**; `monitor` toggles on/off.
- `vad()` → boolean — Voice Activity Detection status. Including ASR on the call
  **implicitly activates VAD**, so `vad()` reflects that side-effect rather than being
  independently configurable here. (Do not confuse this with `RecorderVad`, an unrelated
  *video-layout* highlight-box interface — see §4.)

**Media routing**
- `sendMediaTo(mediaUnit: VoxMediaUnit, parameters?: SendMediaParameters)` /
  `stopMediaTo(mediaUnit)` — attach/detach this call's outbound audio+video to another
  media unit (Call, Player, Recorder, ASR, WebSocket, Conference, etc.). Same
  one-inbound-stream-at-a-time caveat applies.
- `sendMessage(text: string)` — text message to the call (SDK clients), **max 8192
  bytes**.
- `sendInfo(mimeType, body, headers?)` — SIP INFO message, body **max 8192 bytes**.

**Transfer**
- `handleBlindTransfer(handle: boolean)` — enables `CallEvents.BlindTransferRequested`
  for a third-leg transfer flow; paired with `notifyBlindTransferSuccess()` /
  `notifyBlindTransferFailed(code, reason)` to ack/nack the transfer initiator.
- `transferTo(parameters: TransferToParameters)` — REFER-based transfer to a 3rd-party
  SIP provider; success → `CallEvents.TransferComplete`, failure →
  `CallEvents.TransferFailed`. (`TransferToParameters` itself is not in this corpus
  chunk — likely covered in gap-b.)

**KALFA relevance (Call class overall):** This is the single most load-bearing class for
the outbound AI RSVP call feature. Every element of the current scenario (say() for
Hebrew TTS via Google he-IL, handleTones/sendDigits for any DTMF fallback, hangup timing,
customData size cap already discovered independently in Branch B, real-CallerID
requirement) maps directly onto documented, not-guessed behavior here.

---

## 2. Call-related parameter interfaces — EXTRA DEPTH on TTS/Say

### CallSayParameters (interface) — parameters for `Call.say()`
- `voice` — optional; from `VoiceList`; **default `VoiceList.Amazon.en_US_Joanna`**.
  Available for providers: Amazon, Google, IBM, Microsoft, SaluteSpeech, T-Bank, Yandex,
  **ElevenLabs**. (KALFA uses Google he-IL per prior verification — worth remembering
  the platform *default* voice is Amazon/English, so the Hebrew voice must always be
  passed explicitly, never rely on default.)
- `ttsOptions` — optional TTS tuning object (pitch etc.). **`TTSOptions.pitch` support
  depends on language+dictionary combination; unsupported combos fire
  `CallEvents.PlaybackFinished` with error 400** instead of throwing synchronously — a
  silent-looking runtime failure mode to guard against in Hebrew-voice tuning
  experiments. Providers: Amazon, Google, IBM, Microsoft, SaluteSpeech, T-Bank, Yandex.
- `progressivePlayback` — optional, default **false**; chunked delivery to cut
  before-playback delay. Providers: Amazon, Google, IBM, Microsoft, SaluteSpeech,
  T-Bank, Yandex (note: **not** listed for ElevenLabs here, unlike `voice`).
- `request` — optional passthrough object for provider-native TTS parameters bypassing
  Voximplant's abstraction. Providers: Google, SaluteSpeech, T-Bank, YandexV3. This is
  the escape hatch if a specific Google he-IL TTS knob isn't exposed by `ttsOptions`.

Note: `TTSOptions` itself, `TTSPlayerParameters`, `TTSPlaybackParameters`, and
`TTSPlayerSegment` are **not** in this 72-page corpus chunk (referenced only) — they
were very likely assigned to the sibling gap-b agent; don't treat their absence here as
"undocumented."

### CallAnswerParameters (interface) — `Call.answer()`
`conferenceCall` (default false), `disableDtxForAudio` (default false),
`disableExtPlayoutDelay`, `disableExtVideoOffset`, `disableExtVideoOrientation` (RTP
header ext for `3gpp:video-orientation`; disabling it makes non-supporting browsers
render correctly but raises battery draw), `disableExtVideoTiming`, `displayName`,
`maxVideoBitrate` (kbps), `scheme` (internal codec info). Mostly video/WebRTC-oriented —
low relevance for KALFA's audio-only PSTN outbound calls except `displayName`.

### CallEnableBeepDetectionParameters — see Call.enableBeepDetection above.
`frequencies` (Hz[], optional), `timeout` (ms, optional).

### CallMediaStatistics / CallMediaStatisticsSample (interfaces)
`CallMediaStatistics` = `{ in, out }`, each a `CallMediaStatisticsSample`:
`audioLevel` (dB), `id`, `jitter`, `numPackets`, `packetLoss`. Feeds
`CallEvents.MediaStatisticsReceived` when `monitorMediaStatistics` is on. Useful for
post-call QA on call audio quality (relevant to the voice-call-qa-analyst domain).

### CallPSTNParameters — `VoxEngine.callPSTN()`
`amd` (Answering Machine/voicemail Detector, optional), `followDiversion` (optional,
default false — use inbound caller ID for the *outbound* leg from the scenario).

### CallSIPParameters — `VoxEngine.callSIP()`
`allow180After183` (default false, enables `CallEvents.Ringing`), `amd`, `authUser`
(defaults to callerid if unset), `callerid` (no whitespace allowed), `disableDtxForAudio`,
`displayName`, `headers` (X- prefixed custom SIP headers), `outProxy`, `password`,
`regId`, `scheme`, `strictCodecList` (default false), `video`.

### CallUserParameters / CallUserDirectParameters — `VoxEngine.callUser()` /
`callUserDirect()`
Overlapping video/WebRTC-era props (`amd`, `analyticsLabel` for push-notification
tagging, `callerid`, `conferenceCall`, `disableDtx*`, `disableExt*` RTP header toggles,
`displayName`, `extraHeaders` — note the `'VI-CallTimeout'` header controls no-answer
hangup, **10–400 seconds, default 60**, `maxVideoBitrate`, `pushNotificationTimeout`
**10000–60000ms, default 20000**, triggered only after `CallEvents.Failed` with *480 User
Offline*, `scheme`, `strictCodecList`, `username`, `video`,
`videoOrientationExtension` default **true**). Not relevant to PSTN outbound RSVP calls
but relevant if KALFA ever calls a Voximplant SDK "user" (app users) directly.

### CallWhatsappUserParameters — `VoxEngine.callWhatsappUser()`
`callerid` (must be a WhatsApp Business account phone number, no whitespace), `number`
(WA number to call), `headers`, `disableDtxForAudio`. **Directly relevant**: this is the
documented API surface for placing a *voice call over WhatsApp* rather than PSTN — worth
flagging to whoever owns the WhatsApp channel as a possible alternative/fallback call
path, distinct from the existing WhatsApp *messaging* integration.

### CallRecordParameters — see §4 (grouped with Recorder family for stereo/VAD depth).

### MonitorMediaStatisticsParameters — see Call.monitorMediaStatistics above.
`interval` (3–10s), `monitor` (bool).

### StartPlaybackParameters — see Call.startPlayback above. `loop`, `progressivePlayback`.

---

## 3. ASR (class) + ASRModel + ASRProfile + ASRParameters — EXTRA DEPTH, Hebrew flow

### ASR (class)
Provides speech recognition. An ASR instance receives audio piped in *from* a `Call`,
`Player`, or `Conference` via that source's `sendMediaTo(asrInstance)` — ASR is a sink,
not something that pulls audio itself. Created via `VoxEngine.createASR(ASRParameters)`,
passing **either** `language` **or** `dictionary`. Requires
`require(Modules.ASR)`.
- `constructor(id, language, dictionary)` — documented but you don't call this directly;
  `VoxEngine.createASR` is the factory.
- `id()`, `language()`, `dictionary()` (→ `string[]`) — accessors.
- `addEventListener`/`removeEventListener` for `ASREvents` (e.g. `ASREvents.Stopped`,
  `ASREvents.Result`, `ASREvents.InterimResult` — these event names come from
  cross-references in `ASRParameters`, the `ASREvents` page itself is outside this
  corpus chunk).
- `stop()` — fires `ASREvents.Stopped`. **"Do not call any other ASR functions/handlers
  after `ASR.stop`"** — hard rule, treat the instance as dead after stop.

### ASRModel / ASRProfile (classes)
Both are effectively marker/typed-constant classes, not object with methods documented
here: `ASRModel` "represents an ASR recognition model" (see `ASRModelList` for the full
enum, not in this chunk); `ASRProfile` "represents a profile that specifies an ASR
provider and a language to use" (see `ASRProfileList`, also not in this chunk). In
practice you don't construct these — you reference constants from the corresponding
List enums when filling `ASRParameters.model` / `ASRParameters.profile`.

### ASRParameters (interface) — the real depth
Every property below is **provider-gated** (the doc explicitly lists which of
Amazon/Deepgram/Google/Microsoft/SaluteSpeech/T-Bank/Yandex/YandexV3 support it) — this
matters a lot because a Hebrew (he-IL) recognition setup on this account is presumably
Google-backed (matching the existing Google he-IL TTS choice), and several rich
features are **Google-only**:
- `profile` — "ASR provider and language to use" (all providers) — likely the primary
  Hebrew selector (`ASRProfileList` entry for Google + he-IL).
- `model` — recognition model tuned to domain (all providers except IBM-style — actually
  listed: Amazon, Deepgram, Google, Microsoft, SaluteSpeech, T-Bank, Yandex, YandexV3).
  Defaults to `"default"` if unset.
- `singleUtterance` — **default false**. This is a critical turn-taking gotcha for a
  conversational RSVP bot: with `singleUtterance:false`,
  1. if speech < 60s, `ASREvents.Result` fires at an **unpredictable time** — the doc
     literally recommends muting the mic once speech is judged over to increase the
     chance of catching the Result event promptly;
  2. if speech > 60s, `ASREvents.Result` fires **every 60 seconds** regardless of
     pause.
  Setting `singleUtterance: true` makes `ASREvents.Result` fire after every utterance —
  the natural choice for a turn-based phone conversation, matching the platform's
  "anti-hangup conversation design" pattern already tracked in memory. **SaluteSpeech
  defaults this to `true`** unlike everyone else — a provider-specific default
  inversion worth remembering if that provider is ever tried.
- `interimResults` — optional; if true, `ASREvents.InterimResult` fires repeatedly as
  speech streams in (Amazon, Deepgram, Google, SaluteSpeech, T-Bank, Yandex — **not
  Microsoft**). Useful for barge-in detection (user starts talking while bot is still
  speaking) since you get partial hypotheses before the final Result.
- `phraseHints` (Google-only) — biases recognition toward a supplied word list without
  hard-limiting to it. Directly useful for RSVP: bias toward "כן / לא / אולי" or guest
  first names.
- `speechContexts` (Google-only) — finer-grained version of phraseHints: `{phrases:
  string[], boost: 1..20}` weighting.
- `profanityFilter` — default false; masks all but first char of filtered words
  (Amazon, Deepgram, Google, Microsoft, SaluteSpeech, T-Bank, Yandex, YandexV3).
- `maxAlternatives`, `beta` (opt into Google v1p1beta1 Speech API),
  `alternativeLanguageCodes` (up to 3 extra BCP-47 tags, **requires beta:true**),
  `enableAutomaticPunctuation`, `enableWordConfidence`, `enableWordTimeOffsets`,
  `enableSeparateRecognitionPerChannel`, `diarizationConfig`, `metadata`,
  `transcriptNormalization`, `useEnhanced`, `adaptation`, `enableSpokenEmojis`,
  `enableSpokenPunctuation` — **all Google-only**, several gated behind `beta:true`.
- `headers` — `{'x-data-logging-enabled': true}`-style request headers (Amazon,
  Deepgram, Google, Microsoft, SaluteSpeech, T-Bank, Yandex, YandexV3).
- `request` — direct passthrough to the provider (Deepgram, Google, SaluteSpeech,
  T-Bank, Yandex, YandexV3) — same escape-hatch pattern as `CallSayParameters.request`.

**KALFA relevance (ASR):** if/when the RSVP bot's ASR path is audited or extended
(barge-in, better Hebrew name recognition, DNC-phrase detection), `singleUtterance` and
`interimResults` are the two properties to check first, and `phraseHints`/
`speechContexts` are the concrete Google-only levers for biasing recognition toward
RSVP vocabulary (yes/no/maybe, guest names) — assuming Google is the configured
provider, which should be verified against the live scenario code rather than assumed.

---

## 4. Recorder family — EXTRA DEPTH on stereo/VAD

### Recorder (class) — standalone audio/video recorder
`require(Modules.Recorder)`. Minimal API: `addEventListener`/`removeEventListener` for
`RecorderEvents` (e.g. `RecorderEvents.Stopped`), `id()`, `mute(doMute)` (mutes the
whole record **without detaching media sources** — i.e. recording continues as silence,
sources stay attached), `stop()` (fires `RecorderEvents.Stopped`).

### ConferenceRecorder (class) — recorder bound to a Conference
Same `addEventListener`/`id`/`mute`/`stop` shape as `Recorder`, plus:
- `setConference(conference: Conference)` — bind/rebind which conference to record.
- `getPriority()` / `setPriority(priority: Endpoint[])` (returns `Promise<void>`) —
  ordered endpoint list controlling video layout priority in the recorded conference
  video.
- `update(parameters: UpdateRecorderVideoParameters)` — live-update video recording
  params mid-recording (interface itself not in this chunk).

### CallRecordParameters — `Call.record()` params (the per-call recorder)
- `stereo` (default **false**) — **behaves differently depending on which API you use**,
  this is the key gotcha the brief flagged:
  - For the standalone **Recorder module**: `stereo` has **no effect** — it always
    records stereo with both streams mixed into both channels.
  - For **`Call.record()`**: if `stereo:false`, stereo file with mixed streams in both
    channels (same as Recorder); if `stereo:true`, the **call-endpoint→cloud** stream
    goes to the **left** channel and **cloud→call-endpoint** goes to the **right**
    channel. This means `Call.record({stereo:true})` is the only path that gives you a
    channel-separated recording (guest voice isolated from bot voice) — directly useful
    for QA/transcription pipelines that want per-speaker channels without diarization.
- `hd_audio` (default false) — false → 8kHz/32kbps mp3; true → "wideband" 48kHz/192kbps
  mp3. **Incompatible with `lossless:true`**. Transcription quality is *not* affected by
  this setting either way.
- `lossless` (default false) — flac output; **incompatible with `hd_audio:true`**.
- `transcribe` (bool) — creates a call-record transcription; **not available for the
  Recorder module**, only for `Call.record()`.
- `language` — transcription language, drawn from `ASRLanguage` (requires
  `require(Modules.ASR)` to access the constants) — **not available for Recorder
  module**.
- `dict` — transcription dictionary/word-bias list, same "higher chance, not a hard
  limit" semantics as ASR's `phraseHints`; **no effect on Recorder module**.
- `format` — `"json"` for structured transcription output; **not available for Recorder
  module**.
- `labels` — 2-string array naming the two streams in the transcript output (defaults to
  "Left"/"Right" if omitted or single-string); **requires `transcribe:true`**; **not
  available for Recorder module**.
- `provider` — transcription provider override.
- `expire` — storage retention, default `RecordExpireTime.THREEMONTHS`.
- `secure` — restricts record access without Management API auth (**only meaningful via
  `VoxEngine.createRecorder`**, i.e. not via `Call.record()` directly per the doc
  wording — worth double-checking against live behavior if secure storage of RSVP call
  recordings becomes a requirement, since these are PII-adjacent).
- `recordNamePrefix` — S3 file-name prefix, **custom S3-compatible storage only**.
- `video`, `videoParameters` — video recording toggle + `RecorderVideoParameters`.

### RecorderParameters (interface) — same shape as `CallRecordParameters` minus the
`stereo` prop, used for the *standalone* `VoxEngine.createRecorder()` factory (backs both
`Recorder` and `ConferenceRecorder`). Adds `name` (recorder name for call history).

### RecorderVad (interface) — **NOT audio VAD** — video layout highlight box
`color` (hex, default `#009933`) and `thickness` (px; default 3 if frame width > 1280,
else 1). Specifies the highlight frame drawn around the currently-speaking
participant's video tile in a **recorded conference video layout**. This is set via
`RecorderVideoParameters.vad` / `UpdateRecorderVideoParameters.vad` — i.e., it's a video
UI concern, unrelated to `Call.vad()` (audio voice-activity-detection status, activated
as a side effect of attaching ASR). **Don't conflate the two "VAD" concepts** — this
was explicitly worth flagging since the naming collision is easy to misread.

### RecorderVideoParameters (interface) — conference video recording layout
`background` (HTML color), `bitrate` (kbps), `customData`, `direction` (LTR/RTL frame
ordering — potentially relevant if KALFA ever records/renders a video conference for
Hebrew-context UI, though current scope is audio-only), `fps`, `height`/`width` (px),
`labels` (bool — show participant names on tiles, config via `RecorderLabels`),
`layout` (`grid` | `tribune` | `custom`), `layoutPriority` (which tile is bigger in
`tribune` mode — `vad` for "biggest tile follows whoever's speaking" or a fixed
participant id), `layoutSettings` (custom layout via `RecorderDrawArea`), `mixing`
(single combined video file vs. not), `objectFit`, `profile` (video quality profile),
`vad` (bool — whether to draw the speaking-highlight box at all).

### RecorderDrawArea / RecorderGridDefinition / RecorderLabels (interfaces)
`RecorderDrawArea`: `{grid, height, left, priority, top, width}` — one video frame's
geometry in a custom layout. `RecorderGridDefinition`: `{colCount, rowCount, fromCount,
toCount?}` — grid sizing rules. `RecorderLabels`: name-tag styling —
`background`(#c7c7cc default), `color`(#000000 default), `font`
(`RecorderLabelFont.ROBOTO_REGULAR` default), `height`(24px default), `margin`(8px
default), `position` (`RecorderLabelPosition.BOTTOM_RIGHT` default), `textAlign`
(`RecorderLabelTextAlign.MIDDLE_LEFT` default), `width`(104px default).

**KALFA relevance (Recorder family):** All video-layout machinery (grid/tribune/custom,
labels, VAD highlight box) is conference-video-specific and low priority given KALFA's
outbound calls are audio-only 1:1. The one high-value item is `Call.record({stereo:
true, transcribe: true, language, ...})` as a documented way to get a channel-separated,
transcribed recording of an RSVP call for QA — worth checking against
`voice-call-qa-analyst` needs and against the `secure` caveat given recordings contain
guest PII.

---

## 5. Player / SequencePlayer

### Player (class)
Audio player instance, created via `VoxEngine.createTTSPlayer`,
`VoxEngine.createToneScriptPlayer`, or `VoxEngine.createURLPlayer` (none of those
factory pages are in this chunk). API: `addEventListener`/`removeEventListener` for
`PlayerEvents` (e.g. `PlaybackFinished`, `PlaybackMarkerReached`), `addMarker(offset:
number)` (ms offset from start/end; **not supported by the ElevenLabs provider**),
`id()`, `pause()`/`resume()`, `sendMediaTo`/`stopMediaTo`, `stop()` (destroys the
instance).

### SequencePlayer (class)
Multi-segment player (audio + URL segments chained), created via
`VoxEngine.createSequencePlayer(SequencePlayerParameters)`. Same
pause/resume/stop/sendMediaTo/stopMediaTo shape as `Player`, plus `addMarker(offset,
segment: PlaybackParameters)` — marker is scoped to a specific segment rather than the
whole sequence. Events: `SequencePlayerEvents` (e.g. `PlaybackFinished`,
`PlaybackMarkerReached`).

### SequencePlayerParameters / SequencePlaybackParameters (interfaces)
Both are essentially `{ segments: [...] }` wrappers — `SequencePlayerParameters` for
`VoxEngine.createSequencePlayer`, `SequencePlaybackParameters` for the Avatar-engine
`VoiceChannelParameters.playback` field. The actual segment shape
(`SequencePlaybackSegment`/`SequencePlayerSegment` typedefs) is not in this chunk.

**KALFA relevance:** `SequencePlayer` is the mechanism for stitching together
pre-recorded prompt clips with dynamic TTS segments in one continuous playback (e.g., a
fixed intro clip + dynamically generated guest name) — worth considering if the RSVP
script wants to mix pre-baked audio (celebrant sound clip) with live TTS.

---

## 6. Conference / Endpoint / ConferenceParameters / EndpointParameters

### Conference (class)
`require(Modules.Conference)`. `add(parameters: EndpointParameters)` → `Endpoint` — only
works for conferences created with "video conference" checked in the routing rule,
otherwise `ConferenceEvents.ConferenceError` code **102**. **Max 100 endpoints.**
`get(id)`, `getList()`, `id()`, `sendMediaTo`/`stopMediaTo`, `stop()` (fires
`ConferenceEvents.Stopped`), events via `ConferenceEvents`.

### ConferenceParameters — `VoxEngine.createConference()`
Single prop: `hd_audio` — default false (8kHz/32kbps, free); true = 48kHz/192kbps,
**billed additionally**.

### Endpoint (class) — a remote media unit inside a conference (could itself be a Call,
ASR, Recorder, or Player)
`getCall()` → `Call` (only if the endpoint isn't a player/recorder), `getDirection()` →
`SEND|RECEIVE|BOTH`, `getMode()` → `MIX|FORWARD`, `id()`, `manageEndpoint(parameters:
ReceiveParameters)` → `Promise<void>` (live-toggle which streams this endpoint
receives), `setDisplayName(displayName)` (fires `EndpointEvents.InfoUpdated` on SDK
clients).

### EndpointParameters — `Conference.add()` args
`call` (Call to connect), `direction` (SEND/RECEIVE/BOTH), `displayName`,
`maxVideoBitrate`, `mode` (MIX/FORWARD), `receiveParameters` (applied immediately on
add), `scheme`.

### ReceiveParameters / ParticipantReceiveParameters (interfaces)
`ReceiveParameters` keys by endpoint id string, the `all` keyword, or the `new` keyword,
mapping to a `ParticipantReceiveParameters` (`{audio, video}` arrays: `["default"]` = all
streams, `[]` = none, or explicit stream ids like `["v1","v10"]`).

**KALFA relevance:** Multi-party conferencing (Endpoint/Conference/ReceiveParameters) is
not currently part of the 1:1 outbound RSVP call flow, but the 100-endpoint cap and
per-endpoint stream-selection API are worth knowing if a future feature ever needs a
"family conference call" or an operator-listen-in mode.

---

## 7. WebSocket (class) + related parameter interfaces — EXTRA DEPTH

### WebSocket (class)
Bidirectional WS connection (outgoing *or* incoming) for streaming audio/data — the
backbone of any realtime bridge (this is exactly the class family the current Groq
bridge and any future realtime-LLM integration rides on).
- `constructor(url: string, parameters: WebSocketParameters)` (the params interface
  itself is outside this chunk).
- `addEventListener`/`removeEventListener` for `WebSocketEvents` (e.g.
  `WebSocketEvents.OPEN`).
- `close()` — closes the connection or in-flight connection attempt.
- `id()` → string.
- `send(data: string)` — enqueue outbound data.
- `sendMediaTo(mediaUnit, parameters?: SendMediaParameters)` /
  `stopMediaTo(mediaUnit, parameters?: SendMediaParameters)` — **stopMediaTo here takes
  an optional `SendMediaParameters` second arg**, unlike every other class's
  `stopMediaTo(mediaUnit)` (Call/Player/SequencePlayer/Conference/Yandex client all take
  just the mediaUnit) — a small but real signature asymmetry worth remembering when
  writing generic media-routing helper code.
- `clearMediaBuffer(parameters?: ClearMediaBufferParameters)` — flush buffered outbound
  media (`{tag}` — tag-scoped clear for multiplexed streams).
- **Recommended chunk duration for real-time audio: 20 ms** (documented directly on
  `sendMediaTo`) — a concrete tuning number for any custom WS audio bridge, including
  the Branch B Groq bridge if it streams raw audio rather than just text tokens.
- Props: `onclose`, `oncreated`, `onerror`, `onmediaended` (after end of audio stream),
  `onmediastarted` (when playback begins), `onmessage`, `onopen`, `readyState`, `url`
  (for outgoing: the target URL; for incoming: the session URL).

### ClearMediaBufferParameters — `{ tag }` — used by both `WebSocket.clearMediaBuffer`
and `Yandex.RealtimeAPIClient.clearMediaBuffer`.

### SendMediaParameters — `{ customParameters, encoding, tag }` — the shared
"WebSocket-interaction-only" params object accepted (as optional 2nd arg) by
`sendMediaTo` across nearly every media-producing class (Call, Player, SequencePlayer,
Conference, WebSocket, Yandex client). Confirms these params only matter when the
*target* media unit is a WebSocket — for Call-to-Call or Call-to-Player routing they're
inert.

**KALFA relevance:** The `WebSocket` class (plus `SendMediaParameters`/
`ClearMediaBufferParameters`) is the primitive underneath any "raw audio out over a
socket" integration. The already-implemented Branch B bridge (payload
`{to,from,tok,u}`, Groq key served via ctx endpoint) is presumably built on this or on
the higher-level `StreamingAgent`/xAI/Yandex realtime-client wrappers rather than the
raw `WebSocket` class directly — worth a quick code check to confirm which layer is
actually in use before assuming raw-WebSocket semantics apply.

---

## 8. StreamingAgent (class) — EXTRA DEPTH (as requested)

`require(Modules.StreamingAgent)`. Represents a connection to an external **streaming
platform** (the doc is generic about "streaming platforms" — likely something like
RTMP/WHIP-style destinations for conference broadcast, not a voice-AI construct despite
the name's overlap with "streaming AI agent" terminology).
- `activeAudioTrack()` / `activeVideoTrack()` → `number` (track id, or **-1** if none
  active).
- `audioTracks()` / `videoTracks()` → `StreamingAgentTrack[]` (the track-shape interface
  is not in this corpus chunk).
- `addEventListener`/`removeEventListener` for `StreamingAgentEvents` (e.g.
  `StreamingAgentEvents.Connected`).
- `id()` → string.
- `setActiveTrack({audioTrack?, videoTrack?})` — pins a specific track as active.
  **Default mode** (not pinned): active video track = whichever started sending data
  most recently; active audio track = always the first one. Setting `audioTrack`/
  `videoTrack` to **-1** returns to default mode. Once a video track is explicitly
  pinned, it does **not** get silently replaced the way it does in default mode.
- `stop()` — stops streaming, fires `StreamStopped`. **"Do not call any other streaming
  methods after `StreamingAgent.stop`"** — same dead-instance rule as `ASR.stop()`.

**KALFA relevance:** Low — this class is about pushing conference audio/video *out* to
an external streaming/broadcast platform (multi-track selection logic), which doesn't
match KALFA's 1:1 outbound-call use case. Flagging so nobody confuses it with the
Groq/LLM "streaming agent" concept used informally elsewhere in the project — they are
unrelated APIs that happen to share vocabulary.

---

## 9. SmartQueue family

### SmartQueueTask (class)
`require(Modules.SmartQueue)`. A task for one agent (call or chat), created via
`VoxEngine.enqueueTask(SmartQueueTaskParameters)`.
- `end(description: string, terminationStatus?: TerminationStatus)` — ends the task;
  defaults to `TerminationStatus.CLIENT_TERMINATE` if status omitted.
- `addEventListener`/`removeEventListener` for `SmartQueueEvents` (e.g.
  `SmartQueueEvents.OperatorReached`).
- Props: `agentCall` (the agent's Call object), `clientCall` (the client's Call object),
  `id`, `parameters` (the original `SmartQueueTaskParameters`).

### SmartQueueTaskParameters — `VoxEngine.enqueueTask()` args
`call` (the task's Call), `customData` (retrievable later via `GetSQState` HTTP API),
`extraHeaders` (X- prefixed, passed to the agent leg), `maxVideoBitrate`,
`operatorSettings` (`SmartQueueOperatorSettings`), `priority` (1–100, default **50**),
`queue`, `scheme`, `skills` (`SmartQueueSkill[]`), `timeout` (seconds to wait for
agent acceptance), `video`.

### SmartQueueOperatorSettings — `{mode, operatorId, timeout}` (timeout default **0**) —
routes the task to a *specific* operator by id within a timeout window.

### SmartQueueSkill — `{level: 1-5, name}` — required-skill tagging for task/agent
matching.

### SmartQueueTaskStatus (interface, but documents an enum-like set of states) —
`CONNECTED`, `CONNECTING`, `DISTRIBUTING`, `ENDED`, `FAILED`.

**KALFA relevance:** SmartQueue is a call-center/operator-routing feature (skills-based
distribution, priority queues). Not applicable to the current outbound-only RSVP bot,
but would become relevant if KALFA ever added a human-operator escalation path for
guests who need a live agent (e.g., "press 0" during a call) — that's the documented
mechanism for it.

---

## 10. ACD family

### ACDRequest (class) — `require(Modules.ACD)`
A request enqueued to the (older/simpler) ACD queue (distinct from SmartQueue).
`addEventListener`/`removeEventListener` for `ACDEvents`; `cancel()` (removes from
queue); `getStatus()` — must only be called **after** the request is successfully
queued (`ACDEvents.Queued`) — triggers `ACDEvents.Waiting`, whose event payload's `ewt`
property gives estimated wait time in minutes; `id()` — usable as the `acd_request_id`
param to the `GetACDHistory` HTTP API for history lookups.

### ACDEnqueueParameters — `VoxEngine.enqueueACDRequest()` args
`customData`, `headers` (X- prefixed; special `'VI-CallTimeout'` header — **10–400s,
default 60** — switches to another agent if the current one doesn't answer in time),
`priority` (1–100, ties broken by HTTP-request arrival order), `video` (audio-only vs
video pricing differs).

**KALFA relevance:** Same category as SmartQueue — an older/simpler operator-queue
primitive, not used by the current outbound bot. Noting it exists as an alternative
(simpler, priority-only) escalation mechanism if SmartQueue's skill-matching is overkill
for a future "talk to a human" feature.

---

## 11. IVR family

### IVRState (class) — `require(Modules.IVR)`
`constructor(name, settings: IVRSettings, onInputComplete, onInputTimeout)`. `enter(call:
Call)` — starts the IVR from this state for the given call. Props: `input` (set when the
state is left, holds the captured user input), `settings`.

### IVRSettings — per-state config
`type`: `select | inputfixed | inputunknown | noinput`. `nextState` (for `noinput`),
`nextStates` (map for `select` — falls through to `onInputComplete` if no match),
`inputLength` (for `inputfixed`), `inputValidator` (for `inputunknown` — function
receiving the input string so far, decides if it's complete), `terminateOn` (digit that
force-completes `inputunknown` input), `timeout` (ms, **default 5000**), `prompt`
(prompt/audio settings object — `IVRPrompt` typedef, not in this chunk).

**KALFA relevance:** This is a classic DTMF-menu IVR construct — a fundamentally
different interaction model from the current natural-language voice-agent RSVP flow
(ASR/TTS conversation). Low relevance unless KALFA ever wants a "press 1 to confirm,
press 2 to decline" fallback path for guests whose ASR recognition repeatedly fails —
which is a plausible degrade-gracefully design worth keeping in mind given the
project's stated "anti-hangup conversation design" goal (a DTMF fallback state machine
built on `IVRState` could be the concrete implementation of such a fallback, using
`inputfixed`/`type` with `timeout` tuned to the RSVP yes/no/maybe input set).

---

## 12. Voice (class) — bare page
"Represents a language and a voice for TTS." No methods/props documented on this page at
all — it's purely a type marker; the actual enumerable values live in the (out-of-chunk)
`VoiceList`. Referenced everywhere `CallSayParameters.voice` and similar TTS `voice`
props point.

---

## 13. RichContent family (Avatar/chat-channel rich messages)

`RichContent` (interface, avatar text-channel payload — `TextChannelParameters.richContent`):
optional `audio`, `buttons` (`RichContentButtons`), `contact`
(`RichContentContact`), `externalLink` (`RichContentExternalLink`), `file`
(`RichContentFile`), `image` (`RichContentFile` reused), `location`
(`RichContentLocation`), `text`, `video` (`RichContentMedia`).

Sub-interfaces (all thin data bags, no methods):
- `RichContentButtonAction` — `{type, uri?}` (uri only for `"uri"` type).
- `RichContentButtonItem` — `{action, payload (message sent to avatar on click), text}`.
- `RichContentButtons` — `{items: RichContentButtonItem[], text}`.
- `RichContentContact` — `{avatar, name, number}`.
- `RichContentExternalLink` — `{caption, url}`.
- `RichContentFile` — `{caption, contentType, fileName, fileSize, url}` (used for both
  images and generic files).
- `RichContentLocation` — `{address, latitude, longitude}`.
- `RichContentMedia` — `{caption, contentType, duration, fileName, fileSize, url}` (used
  for both video and audio).

**KALFA relevance:** This whole family belongs to the **Avatar Engine** (text/chat
channel rich messaging — buttons, cards, location pins), not the voice-call engine. Not
applicable to phone-based RSVP confirmation, but directly relevant vocabulary if KALFA
ever adds a chat-based (WhatsApp/web-chat) conversational agent using Voximplant's
Avatar product rather than hand-rolled webhook logic — the button/payload model here
looks structurally similar to WhatsApp interactive-button messages already used
elsewhere in the project.

---

## 14. ApplicationStorage family

`StorageKey` — `{expireAt, key, value}` — result shape from
`ApplicationStorage.get/put/delete`. `expireAt` derives from the `ttl` passed to `put`.
`StoragePage` — `{keys}` — result shape from `ApplicationStorage.keys` (paginated key
listing). Both require `require(Modules.ApplicationStorage)`.

**KALFA relevance:** A built-in scenario-scoped key/value store with TTL. Potentially
useful as a lightweight alternative to round-tripping to KALFA's own ctx/cb HTTP
endpoints for small, ephemeral per-call state, though the existing ctx/cb design
(external, auditable, already integrated with the app's DB) is very likely still the
right home for anything that needs to persist beyond the call or be queried by KALFA's
own backend.

---

## 15. Misc small interfaces

- `ChannelParameters` — `{text?, voice?}` — Avatar channel-parameter wrapper (both
  optional), used in `AvatarResponseParameters.channelParameters`.
- `ConferenceParameters` — covered in §6.
- `EndpointParameters` — covered in §6.
- `ParticipantReceiveParameters` / `ReceiveParameters` — covered in §6.
- `SendMediaParameters` / `ClearMediaBufferParameters` — covered in §7.
- `SequencePlaybackParameters` / `SequencePlayerParameters` — covered in §5.
- `MonitorMediaStatisticsParameters` — covered in §1/§2.
- `CallMediaStatistics(Sample)` — covered in §2.

---

## 16. xai namespace (3 pages)

`XAI.RealtimeTTSPlayer` (class) — realtime streaming TTS player against xAI's audio
API. `addEventListener`/`removeEventListener` (`PlayerEvents`), `clearBuffer()`, `id()`,
`pause()`/`resume()`, `send(parameters: Object)` (passthrough to xAI provider context,
per [xAI's streaming-TTS-websocket docs]), `sendMediaTo`/`stopMediaTo`, `stop()`.

`XAI.RealtimeTTSPlayerParameters` (interface) — `apiKey` (optional; use your own xAI
account key), `connectionParameters` (optional object, **must contain `voice` and
`language`**, per xAI's connection docs), `privacy` (default false — disables WS logging
when true), `statistics` (optional), `trace` (diagnostic-only; produces an S3-uploaded
plaintext transcript of all WS traffic — **support-only, do not leave enabled**).

`XAI.createRealtimeTTSPlayer(parameters?)` → `RealtimeTTSPlayer` — factory; media
streams attach later via `sendMediaTo` or `VoxEngine.sendMediaBetween`.

**KALFA relevance:** A second, independent realtime-TTS provider option (xAI, alongside
Yandex's realtime API below) that Voximplant now ships first-class support for. Given
KALFA's current stack uses Google he-IL TTS + a Groq LLM bridge, this is not in active
use, but it's a documented alternative worth knowing about if Google he-IL TTS quality
or latency ever becomes a blocker — **caveat**: xAI's TTS language/voice support for
Hebrew is unverified here and would need to be checked against xAI's own docs before
considering a switch.

## 17. yandex namespace (5 pages)

`Yandex.RealtimeAPIClient` (class) — a realtime bidirectional bridge to Yandex's
"speech-realtime" API (closely modeled on OpenAI-style realtime session semantics:
conversation items, response create/cancel, session update).
- `addEventListener`/`removeEventListener` for `Yandex.Events` or
  `Yandex.RealtimeAPIEvents`.
- `close()` — closes the connection or attempt.
- `conversationItemCreate/Delete/Retrieve/Truncate(parameters: Object)` — manage
  conversation history server-side.
- `id()` / `webSocketId()`.
- `responseCancel(parameters)` / `responseCreate(parameters)` — cancel/trigger model
  inference.
- `sendMediaTo`/`stopMediaTo`/`clearMediaBuffer` — same media-routing shape as
  `WebSocket`.
- `sessionUpdate(parameters)` — reconfigure the session live.

`Yandex.RealtimeAPIClientParameters` — `apiKey`, `folderId` (Yandex Cloud folder id),
`model` (default **`speech-realtime-250923`**), `onWebSocketClose` (callback),
`privacy`/`statistics`/`trace` (same semantics as the xAI params above).

`Yandex.createRealtimeAPIClient(parameters)` → `Promise<RealtimeAPIClient>`.

`Yandex.Events` (2 constants): `WebSocketMediaEnded` (fires after **1s of silence**
ending an inbound audio stream from a 3rd party over the WS; carries `mediaInfo` and an
optional `tag` for disambiguating multiplexed streams), `WebSocketMediaStarted`
(carries `customParameters`, `encoding`, `tag`).

`Yandex.RealtimeAPIEvents` (~35 constants) — a near-complete mirror of an
OpenAI-Realtime-style server event set: `ConnectorInformation`, `ConversationItemCreated
/Deleted/Retrieved/Truncated`,
`ConversationItemInputAudioTranscriptionCompleted/Delta/Failed/Segment`, `Error`,
`HTTPResponse`, `InputAudioBufferCleared/Committed/DTMFEventReceived/
SpeechStarted/SpeechStopped/TimeoutTriggered`, `MCPListToolsCompleted/Failed/InProgress`
(Yandex's realtime API supports **MCP tool calling** server-side), `OutputAudioBuffer
Cleared/Started/Stopped`, `RateLimitsUpdated`, `ResponseContentPartAdded/Done`,
`ResponseCreated/Done`, `ResponseFunctionCallArgumentsDelta/Done`,
`ResponseMCPCallArgumentsDelta/Done/Completed/Failed/InProgress`,
`ResponseOutputAudioDone`, `ResponseOutputAudioTranscriptDelta/Done`,
`ResponseOutputItemAdded/Done`, `ResponseOutputTextDelta/Done`, `SessionCreated
/Updated`, `Unknown`, `WebSocketError`. Every event carries `{client, data:
{customEvent?, payload}}`.

**KALFA relevance:** This is a **built-in, first-party alternative to the hand-rolled
Groq WebSocket bridge** (Branch B) — Voximplant now ships a native realtime-API client
wrapper (currently for Yandex; xAI has an analogous realtime **TTS-only** player, not a
full conversational client) that handles session lifecycle, conversation items, VAD-driven
turn events (`InputAudioBufferSpeechStarted/Stopped`), DTMF-in-realtime-session
(`InputAudioBufferDTMFEventReceived`), and even server-side MCP tool calling, all as
native VoxEngine objects instead of a custom WS payload/bridge. This does **not**
directly replace the Groq integration (different vendor), but it's strong evidence that
Voximplant's own realtime-client abstraction is a viable target if the project ever
needs to swap providers or reduce custom-bridge maintenance — worth flagging to
whoever owns the Branch B bridge design as a "here's what the platform now offers
natively" data point, not an immediate action item.

---

## INVENTORY — all 72 pages covered

1. references.voxengine.xai — XAI (ref_folder)
2. references.voxengine.xai.realtimettsplayer — RealtimeTTSPlayer (class)
3. references.voxengine.xai.realtimettsplayerparameters — RealtimeTTSPlayerParameters (interface)
4. references.voxengine.xai.createrealtimettsplayer — createRealtimeTTSPlayer (function)
5. references.voxengine.yandex — Yandex (ref_folder)
6. references.voxengine.yandex.events — Events (events)
7. references.voxengine.yandex.realtimeapievents — RealtimeAPIEvents (events)
8. references.voxengine.yandex.realtimeapiclient — RealtimeAPIClient (class)
9. references.voxengine.yandex.realtimeapiclientparameters — RealtimeAPIClientParameters (interface)
10. references.voxengine.yandex.createrealtimeapiclient — createRealtimeAPIClient (function)
11. references.voxengine.acdrequest — ACDRequest (class)
12. references.voxengine.asr — ASR (class)
13. references.voxengine.asrmodel — ASRModel (class)
14. references.voxengine.asrprofile — ASRProfile (class)
15. references.voxengine.call — Call (class)
16. references.voxengine.conference — Conference (class)
17. references.voxengine.conferencerecorder — ConferenceRecorder (class)
18. references.voxengine.endpoint — Endpoint (class)
19. references.voxengine.ivrstate — IVRState (class)
20. references.voxengine.player — Player (class)
21. references.voxengine.recorder — Recorder (class)
22. references.voxengine.sequenceplayer — SequencePlayer (class)
23. references.voxengine.smartqueuetask — SmartQueueTask (class)
24. references.voxengine.streamingagent — StreamingAgent (class)
25. references.voxengine.voice — Voice (class)
26. references.voxengine.websocket — WebSocket (class)
27. references.voxengine.acdenqueueparameters — ACDEnqueueParameters (interface)
28. references.voxengine.asrparameters — ASRParameters (interface)
29. references.voxengine.callanswerparameters — CallAnswerParameters (interface)
30. references.voxengine.callenablebeepdetectionparameters — CallEnableBeepDetectionParameters (interface)
31. references.voxengine.callmediastatistics — CallMediaStatistics (interface)
32. references.voxengine.callmediastatisticssample — CallMediaStatisticsSample (interface)
33. references.voxengine.callpstnparameters — CallPSTNParameters (interface)
34. references.voxengine.callrecordparameters — CallRecordParameters (interface)
35. references.voxengine.callsipparameters — CallSIPParameters (interface)
36. references.voxengine.callsayparameters — CallSayParameters (interface)
37. references.voxengine.calluserdirectparameters — CallUserDirectParameters (interface)
38. references.voxengine.calluserparameters — CallUserParameters (interface)
39. references.voxengine.callwhatsappuserparameters — CallWhatsappUserParameters (interface)
40. references.voxengine.channelparameters — ChannelParameters (interface)
41. references.voxengine.clearmediabufferparameters — ClearMediaBufferParameters (interface)
42. references.voxengine.conferenceparameters — ConferenceParameters (interface)
43. references.voxengine.endpointparameters — EndpointParameters (interface)
44. references.voxengine.ivrsettings — IVRSettings (interface)
45. references.voxengine.monitormediastatisticsparameters — MonitorMediaStatisticsParameters (interface)
46. references.voxengine.participantreceiveparameters — ParticipantReceiveParameters (interface)
47. references.voxengine.receiveparameters — ReceiveParameters (interface)
48. references.voxengine.recorderdrawarea — RecorderDrawArea (interface)
49. references.voxengine.recordergriddefinition — RecorderGridDefinition (interface)
50. references.voxengine.recorderlabels — RecorderLabels (interface)
51. references.voxengine.recorderparameters — RecorderParameters (interface)
52. references.voxengine.recordervad — RecorderVad (interface)
53. references.voxengine.recordervideoparameters — RecorderVideoParameters (interface)
54. references.voxengine.richcontent — RichContent (interface)
55. references.voxengine.richcontentbuttonaction — RichContentButtonAction (interface)
56. references.voxengine.richcontentbuttonitem — RichContentButtonItem (interface)
57. references.voxengine.richcontentbuttons — RichContentButtons (interface)
58. references.voxengine.richcontentcontact — RichContentContact (interface)
59. references.voxengine.richcontentexternallink — RichContentExternalLink (interface)
60. references.voxengine.richcontentfile — RichContentFile (interface)
61. references.voxengine.richcontentlocation — RichContentLocation (interface)
62. references.voxengine.richcontentmedia — RichContentMedia (interface)
63. references.voxengine.sendmediaparameters — SendMediaParameters (interface)
64. references.voxengine.sequenceplaybackparameters — SequencePlaybackParameters (interface)
65. references.voxengine.sequenceplayerparameters — SequencePlayerParameters (interface)
66. references.voxengine.smartqueueoperatorsettings — SmartQueueOperatorSettings (interface)
67. references.voxengine.smartqueueskill — SmartQueueSkill (interface)
68. references.voxengine.smartqueuetaskparameters — SmartQueueTaskParameters (interface)
69. references.voxengine.smartqueuetaskstatus — SmartQueueTaskStatus (interface)
70. references.voxengine.startplaybackparameters — StartPlaybackParameters (interface)
71. references.voxengine.storagekey — StorageKey (interface)
72. references.voxengine.storagepage — StoragePage (interface)
