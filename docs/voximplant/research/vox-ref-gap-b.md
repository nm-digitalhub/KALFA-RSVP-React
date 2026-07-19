# VoxEngine Reference — Gap B (manifest lines 73-143, 71 pages)

Source: `voxengine-orphans.txt` lines 73-143. All 71 pages fetched via `getDoc` API and parsed; 0 failures, 0 parse errors. Raw extracted text: `../raw/gap-b-raw.md`.

---

## 1. StreamingAgent parameters

**Pages:** `StreamingAgentParameters` (interface), `StreamingAgentTrack` (interface)

- `StreamingAgentParameters` — args for `VoxEngine.createStreamingAgent`; requires `require(Modules.StreamingAgent)`. Fields: `url` (required, streaming server URL), `protocol` (required, only `RTMP` supported today), `streamName` (optional, unique name for CDN retrieval), `applicationName` (optional, part of streamName e.g. `live2`, platform-dependent), `backupUrl` (optional fallback server), `keyframeInterval` (optional, seconds, default **2**, min effectively 2 — any value < 2 is clamped to 2).
- `StreamingAgentTrack` — despite the doc's copy-paste description ("termination status", inherited from a template), the actual fields are `kind` (string, track kind) and `trackId` (string) — i.e., this describes a media track being streamed, not a status.

**Gotcha:** Only RTMP protocol is supported for outbound live streaming as of this doc snapshot — no HLS/WebRTC egress via this API.

**KALFA relevance:** Low — StreamingAgent is for RTMP live-streaming a call out to a CDN (e.g. broadcasting a ceremony). Not part of the RSVP confirmation-call flow, but could matter if KALFA ever streams an event ceremony.

---

## 2. TTS / Player parameter interfaces (core to Hebrew TTS tuning)

**Pages:** `TTSOptions`, `TTSPlaybackParameters`, `TTSPlayerParameters`, `TTSPlayerSegment`

### TTSOptions — fine-grained voice-synthesis controls
Passed via `CallSayParameters.ttsOptions` (i.e. **`call.say(text, {ttsOptions: {...}})`**) or `TTSPlayerParameters.ttsOptions`. Per the W3C speech-synthesis spec. Fields (all optional):
- `pitch` (string) — Google only. Either `"<N>Hz"` in **0.5Hz–2Hz**, or a keyword: `x-low | low | medium | high | x-high | default`.
- `rate` (string) — Google & Yandex. Keyword: `x-slow | slow | medium | fast | x-fast | default`.
- `volume` (string) — Google only. Keyword: `silent | x-soft | soft | medium | loud | x-loud | default`.
- `speed` (string) — Yandex only. Numeric `"0.1"`–`"3.0"`.
- `emotion` (string) — Yandex only, and **only works for `ru_RU` voices** — i.e. not usable for Hebrew (`he_IL`) since Yandex doesn't serve Hebrew anyway.
- `effectsProfileId` (array of `TTSEffectsProfile`) — Google only; post-synthesis audio profile(s) applied in the order given (see §16).
- `yandexCustomModelName` — Yandex custom voice, requires contacting Voximplant support.

**Gotcha:** Provider-scoping is strict and undocumented-in-code — passing `pitch`/`volume`/`effectsProfileId` when using a non-Google provider silently does nothing (no error). Since KALFA's stack uses **Google he-IL Chirp3-HD voices**, only `pitch`, `rate`, `volume`, `effectsProfileId` apply — `emotion`/`speed`/`yandexCustomModelName` are dead for this account.

### TTSPlayerParameters — args to `VoxEngine.createTTSPlayer()`
- `voice` (optional, `Voice` type — see `VoiceList` elsewhere in docs) — default is `VoiceList.Amazon.en_US_Joanna` if omitted (irrelevant to KALFA since a Google he-IL voice is always explicitly set).
- `ttsOptions` (optional, `TTSOptions`) — as above. **Note:** if the requested `TTSOptions.pitch` isn't supported for the chosen language/dictionary, `CallEvents.PlaybackFinished` fires with **error 400** instead of throwing synchronously — must be handled as an async failure path, not a sync try/catch.
- `progressivePlayback` (optional, bool, default **false**) — if true, speech streams in chunks to cut latency before playback starts. Available for Amazon/Google/IBM/Microsoft/SaluteSpeech/T-Bank/Yandex.
- `onPause` (optional, bool, default **false**) — create the player already paused; resume via `Player.resume()`.
- `apiKey` (optional, string) — ElevenLabs only.
- `request` (optional, `Object`) — pass TTS parameters **directly to the provider** in raw JSON, bypassing `TTSOptions`; available for Google/SaluteSpeech/T-Bank/YandexV3. This is the escape hatch for provider-specific SSML/voice knobs that `TTSOptions` doesn't expose.

### TTSPlaybackParameters (Avatar-channel variant) / TTSPlayerSegment (Sequence-player variant)
Both are thin wrappers with `text` (required) + `parameters` (optional `TTSPlayerParameters`), used respectively by `VoiceChannelParameters.playback` (Avatar engine) and `SequencePlayerParameters.segments` (sequence player). `TTSPlaybackParameters` additionally carries `allowPlaybackInterruption` (bool) — **gotcha:** a segment with `allowPlaybackInterruption: true` must always be followed by another interruptible segment, or be the last segment in the sequence — an interruptible segment in the middle followed by a non-interruptible one is an invalid configuration.

**KALFA relevance — HIGH.** This is the exact parameter surface for tuning Hebrew RSVP call speech: `call.say(text, {ttsOptions: {pitch, rate, volume}})` for pitch/rate/volume control on Google voices, and `TTSPlayerParameters.request` as a possible route to pass raw Google Cloud TTS SSML/audioConfig parameters directly if `ttsOptions` proves insufficient (relevant given the known finding that `call.say()` reads SSML tags literally rather than interpreting them — see `[[voximplant-say-no-ssml]]` memory). `progressivePlayback` could reduce time-to-first-audio on the greeting line.

---

## 3. Channel parameters (Avatar engine)

**Pages:** `TextChannelParameters`, `VoiceChannelParameters`

- `TextChannelParameters` — one field: `richContent` (`RichContent` type — defined outside this gap's scope, manifest lines 54-62). For Avatar text-channel (chat) responses.
- `VoiceChannelParameters` — two fields: `asr` (optional `ASRParameters`, defaults inherited from `VoiceAvatarConfig.asrParameters`) and `playback` (optional `PlaybackParameters` — see typedef §19 — defaults inherited from `VoiceAvatarConfig.ttsPlayerOptions`).

**KALFA relevance:** Only relevant if/when migrating the RSVP call bot to the higher-level **Avatar engine** (VoximplantAvatar) rather than raw `Call.say()`/ASR — currently not the architecture in use (KALFA uses Groq LLM bridge + `call.say()` directly, not VoxEngine's built-in Avatar/Dialogflow layer).

---

## 4. ToneScript player

**Page:** `ToneScriptPlayerParameters` — args to `VoxEngine.createToneScriptPlayer()`. Fields: `loop` (optional bool) and `progressivePlayback` (optional bool, default false). Minimal — the actual tone definition (cadence/frequency) is passed as the ToneScript string argument elsewhere, not in this params object.

**KALFA relevance:** Low — used for generating custom DTMF/ring/busy tones, not part of the RSVP flow.

---

## 5. Call transfer

**Page:** `TransferToParameters` — args to `Call.transferTo()`. Fields:
- `to` (required string) — SIP(S) URI, e.g. `sip:alice@example.org`, or for intra-application calls: `user@application-name.account-name.voximplant.com`.
- `call` (optional `Call`) — only for **attendant transfer** (i.e. blind vs. attended transfer distinguished by whether a `call` object is supplied).
- `headers` (optional, `{[header: string]: string}`) — custom SIP headers forwarded with the INVITE. Custom headers **must** be prefixed `X-`, **except** the special `VI-CallTimeout` header (seconds, default **60**, clamped to range **10–400**) which controls no-answer hangup timing. `X-` headers are readable client-side via the Web SDK's `incomingCall` event.

**KALFA relevance:** Low today (no live-agent transfer in the RSVP flow), but directly relevant if a future feature lets the AI call **transfer to a human host/family member** on request — `VI-CallTimeout` and the `X-` header passthrough would be the mechanism.

---

## 6. URL Player family (audio-file playback via HTTP)

**Pages:** `URLPlaybackParameters`, `URLPlayerParameters`, `URLPlayerRequest`, `URLPlayerRequestBody`, `URLPlayerRequestHeader`, `URLPlayerRequestMethod` (enum), `URLPlayerSegment`

- `URLPlayerParameters` — args to `VoxEngine.createURLPlayer()`: `loop`, `onPause`, `progressivePlayback` (all optional bool, same semantics as TTS player), plus `hideBody`/`hideHeaders` (optional bool, default false) — **redact the HTTP request body/headers from session logs**, useful when the play URL carries auth tokens or PII in query/body.
- `URLPlayerRequest` / `URLPlayerRequestBody` / `URLPlayerRequestHeader` — compose a full HTTP request for fetching the audio: `url` (required), `method` (optional `URLPlayerRequestMethod`, default **GET**), `headers` (array of `{name, value}`), `body` (`{text}` for a JSON-stringified body OR `{binary}` for a base64 string — mutually described as "should contain either 'text' or 'binary'").
- `URLPlayerRequestMethod` enum — only **`GET`** and **`POST`**.
- `URLPlaybackParameters` (Avatar channel) / `URLPlayerSegment` (Sequence player) — thin wrappers: `url` (required) + `parameters` (optional `URLPlayerParameters`); `URLPlaybackParameters` adds `allowPlaybackInterruption` (default false) with the same interruption-ordering rule as TTS segments (§2).
- **Format/size limit (repeated across every URL-player page):** supported formats are **mp3, ogg, flac, wav** (codecs: mp3/speex/vorbis/flac/wav respectively); **maximum file size 10 MB**.

**KALFA relevance:** Medium — this is the mechanism for playing a **pre-recorded audio file** (e.g., a celebrant's own voice greeting, or a jingle) mid-call instead of/alongside TTS. The 10 MB cap and 4 supported formats are the hard constraints if KALFA ever lets a host upload custom audio for the call. `hideBody`/`hideHeaders` matters if such a URL is ever a signed/token-bearing link (avoid leaking guest-identifying tokens into Voximplant's own session logs).

---

## 7. Recorder (video conference recording) parameters & enums

**Pages:** `UpdateRecorderVideoParameters` (interface); `RecordExpireTime`, `RecorderDirection`, `RecorderLabelFont`, `RecorderLabelPosition`, `RecorderLabelTextAlign`, `RecorderLayout`, `RecorderObjectFit`, `RecorderProfile` (enums); `RecorderLayoutPriority` (typedef)

- `UpdateRecorderVideoParameters` — args to `ConferenceRecorder.update()` (requires `require(Modules.Recorder)`); all 9 fields optional: `background` (HTML color string), `customData` (arbitrary object), `direction` (`RecorderDirection`), `labels` (`RecorderLabels`, whether to show participant names), `layout` (`RecorderLayout`), `layoutPriority` (`RecorderLayoutPriority`), `layoutSettings` (array of `RecorderDrawArea`, only used when `layout==='custom'`), `objectFit` (`RecorderObjectFit`), `vad` (`RecorderVad`, highlight active speaker).
- `RecordExpireTime` enum — 6 values, all self-descriptive but with **empty descriptions** in the doc: `SIXMONTHS`, `ONEYEAR`, `TWOYEARS`, `THREEYEARS`, `FIVEYEARS`, `THREEMONTHS`. Controls recording retention/auto-delete.
- `RecorderDirection` enum — `ltr` | `rtl` (video frame direction — presumably relevant for RTL-language UI layout of recorded video labels).
- `RecorderLayout` enum — `grid` (equal-size frames) | `tribune` (one enlarged active frame) | `custom` (requires `layoutSettings`).
- `RecorderLayoutPriority` typedef — `'vad' | string[]` — either the literal string `"vad"` (enlarge whoever is currently speaking) or an array of participant IDs to keep enlarged.
- `RecorderObjectFit` enum — CSS-object-fit-style: `contain | cover | fill | none`.
- `RecorderProfile` enum — video quality presets: `VGA | NHD | HD | FHD | QHD | 4K`.
- `RecorderLabelPosition` / `RecorderLabelTextAlign` enums — identical 9-value sets: the 3×3 grid `TOP/MIDDLE/BOTTOM _ LEFT/CENTER/RIGHT`.
- `RecorderLabelFont` enum — **168 values**, all Roboto family variants (Roboto, Roboto Condensed, Roboto Mono, Roboto Serif [Condensed/Expanded/Semi-*/Extra-*/Ultra-*], Roboto Slab) × weight × italic. Full list captured in raw file; not reproduced here since it's a closed, purely enumerable font list with no semantic content beyond the name.

**KALFA relevance:** Low/none — this is exclusively for **video conference recording** (labels/layout burned into an .mp4). KALFA's RSVP calls are audio-only outbound calls; no conferencing or video recording is in scope. Would only matter if KALFA ever recorded a video call (e.g., a video RSVP or virtual attendance feature).

---

## 8. WebSocket

**Pages:** `WebSocketMediaInfo`, `WebSocketParameters` (interfaces); `WebSocketAudioEncoding`, `WebSocketCloseCode`, `WebSocketReadyState` (enums)

- `WebSocketParameters` — args to `VoxEngine.createWebSocket()`: `protocols` (optional, string or string[], default `"chat"`), `headers` (optional array of `{name, value}`), `privacy` (optional bool, default false — **disables logging of the WS connection** when true), `statistics` (optional bool — enables stats collection), `trace` (optional bool, default false — dumps all sent/received WS messages verbatim to a plaintext file uploaded to S3; doc explicitly says "**enable this only for diagnostic purposes**" and hand it to Voximplant support for troubleshooting — i.e. it's a support-facing debug flag, not for production use, and a clear PII/leak risk if left on).
- `WebSocketMediaInfo` — one field, `duration` (number) — audio stream duration, obtainable after the stream stops/pauses (defined as ≥1 sec of silence).
- `WebSocketAudioEncoding` enum — `PCM16_8KHZ` (default), `PCM16_16KHZ`, `ALAW`, `ULAW`, `OPUS` (48kHz).
- `WebSocketCloseCode` enum — 15 standard WS close reasons (`CLOSE_NORMAL`, `CLOSE_ABNORMAL`, `CLOSE_GOING_AWAY`, `CLOSE_PROTOCOL_ERROR`, `CLOSE_POLICY_VIOLATION`, `CLOSE_TOO_LARGE`, `CLOSE_UNSUPPORTED`, `CLOSE_UNSUPPORTED_PAYLOAD`, `CLOSE_MANDATORY_EXTENSION`, `CLOSE_SERVER_ERROR`, `CLOSE_SERVICE_RESTART`, `CLOSE_TRY_AGAIN_LATER`, `CLOSE_TLS_FAIL`, `CLOSE_BAD_GATEWAY`, `CLOSED_NO_STATUS`).
- `WebSocketReadyState` enum — `CONNECTING | OPEN | CLOSING | CLOSED`.

**KALFA relevance — HIGH.** This is precisely the transport used for the **Groq LLM bridge** (`[[voximplant-branch-b-status]]`) — a raw WebSocket from the VoxEngine scenario to KALFA's own ctx endpoint / to Groq. Concretely relevant:
- `privacy: true` should very likely be set on any WS carrying the bearer token / access_token payload described in Branch B, to keep it out of Voximplant's own session logs.
- `trace: true` must **never** ship in production (it's an explicit "diagnostic only" flag that dumps the full raw message stream, including whatever tokens/PII flow over it, to an S3-hosted plaintext file) — worth a one-line check in the deployed scenario.
- `WebSocketCloseCode`/`WebSocketReadyState` give the vocabulary for diagnosing a dropped Groq bridge connection mid-call (distinguish e.g. `CLOSE_ABNORMAL`/`CLOSE_TLS_FAIL` network-layer failures from a clean `CLOSE_NORMAL`).
- `WebSocketAudioEncoding` — if audio (not just text) is ever streamed over this WS (e.g. to a realtime speech model), `PCM16_8KHZ` matches standard telephony sample rate and is the default.

---

## 9. Global utility functions (encoding / hashing / misc)

**Pages:** `base64_decode`, `base64_encode`, `bytes2hex`, `bytes2str`, `hex2bytes`, `str2bytes`, `levenshtein_distance`, `getLocalTime`, `uuidgen`, `trace`, `require`

All are **global** VoxEngine sandbox functions (no `require()` needed), available anywhere in scenario code:
- `base64_encode(data: string | number[]) → string` / `base64_decode(data: string) → number[]` — round-trip Base64; decode returns a raw byte array, not a string (chain into `bytes2str` to get text back).
- `str2bytes(data: string, encoding = 'utf-8') → number[]` / `bytes2str(data: number[], encoding = 'utf-8') → string` — string↔byte-array conversion with explicit codepage control.
- `hex2bytes(data: string) → number[]` / `bytes2hex(data: number[], toUpperCase = false) → string` — hex string ↔ byte array.
- `levenshtein_distance(str1: string, str2: string) → number` — edit distance between two strings.
- `getLocalTime(timezone: string, date: Date) → Date` — converts a UTC `Date` (VoxEngine's `new Date()` is always UTC+0) into a given IANA tz-database zone (`AREA/LOCATION` format, e.g. `Asia/Jerusalem`).
- `uuidgen() → string` — generates a UUID.
- `trace(data: string) → void` — writes a line to the scenario's session log (the doc gives no param description beyond the signature — this is VoxEngine's basic logging primitive, analogous to `console.log`, and is what shows up in Voximplant call-session logs/history).
- `require(module: Modules) → void` — loads a built-in module (see §13 `Modules` enum) into scenario scope; no return value, called for side effect before using module-gated APIs (e.g. `require(Modules.ASR)`).

**Gotchas:**
- `getLocalTime` is the only sanctioned way to get wall-clock time in a specific zone — scenario `Date` objects are always UTC, so any Hebrew-locale time-of-day logic (e.g. "don't call after 21:00 Israel time") needs `getLocalTime(..., 'Asia/Jerusalem')` rather than manual offset math.
- `levenshtein_distance` is a candidate primitive for **fuzzy name matching** during the call (e.g., matching the ASR-transcribed spoken name against the guest record) without needing to ship a JS levenshtein implementation.

**KALFA relevance:**
- `getLocalTime` — directly useful for any in-call time-of-day logic tied to Israel timezone, and for logging call timestamps in local time.
- `trace` — the actual primitive behind whatever logging exists in the current scenario; per `[[no-hardcoded-business-facts]]`/PII rules, any `trace()` call must avoid dumping raw guest PII (per project CLAUDE.md: never log raw personal data) — worth auditing the live scenario for stray `trace(JSON.stringify(ctx))`-style calls.
- `levenshtein_distance` — potentially useful if the call flow ever needs to fuzzy-match a spoken guest name against the guest list server-side context.
- `require(Modules.X)` — confirms the module-gating pattern already used in the scenario; see `Modules` enum (§13) for the authoritative list of what's `require()`-able.

---

## 10. Timer functions

**Pages:** `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`

- `setTimeout(callback: Function, timeout?: number) → number` — fires once; `timeout` in ms, defaults to 0 ("as soon as possible") if omitted; returns a numeric timer ID for `clearTimeout`.
- `setInterval(callback: Function, timeout?: number) → number` — fires repeatedly; **if `timeout < 100`, VoxEngine clamps it up to 100ms** — sub-100ms intervals are not honored. Callback takes no parameters and its return value is ignored.
- `clearTimeout(timeoutID: number) → void` / `clearInterval(intervalID: number) → void` — cancel by the ID returned from the corresponding setter.

**Gotcha (both):** "the actual delay may be longer than intended" — no hard real-time guarantee; don't rely on these for millisecond-precision timing.

**KALFA relevance — HIGH.** These are the primitives for **conversation timeouts** in the RSVP call scenario — e.g., "if the guest doesn't respond within N seconds, re-prompt or end the call," or "hang up after silence." Given the existing finding that hangup is currently driven by `PlaybackFinished` + a duration-based fallback (`[[voximplant-say-no-ssml]]`), `setTimeout`/`clearTimeout` are almost certainly the mechanism behind that fallback timer, and the 100ms floor on `setInterval` is relevant if any periodic polling (e.g., silence detection) is ever added.

---

## 11. ASR enums

**Pages:** `ASRDictionary`, `ASRLanguage`

- `ASRDictionary` enum (13 values, `require(Modules.ASR)`) — specialized recognition dictionaries to bias ASR toward a domain: `ADDRESS` (multi-language: ru-RU, en-US, uk-UK, tr-TR, de-DE, fr-FR, es-ES), `ADDRESS_RU`, `ADDRESS_TR`, `DATE_RU`, `ECOMMERCE`, `GENERAL_RU`, `MUSIC`, `NAMES_RU`, `NOTES`, `NUMBERS_RU` (phone numbers), `QUESTIONNAIRE_RU`, `SEARCH_QUERIES` (ru-RU/en-US/uk-UK/tr-TR), `TBANK`. **Notably Russian-dictionary-heavy** — almost all dictionaries beyond `ADDRESS`/`ECOMMERCE`/`MUSIC`/`NOTES`/`SEARCH_QUERIES` are Russian-only, confirming there is **no Hebrew-specific ASR dictionary**.
- `ASRLanguage` enum — **119 values**, standard BCP-47-ish locale codes covering en/es/fr/de/etc. across many countries. Confirms **`HEBREW_IL` exists** as a supported ASR language value (this is what KALFA's scenario presumably passes as `ASRLanguage.HEBREW_IL`). Doc explicitly notes: "T-Bank VoiceKit and Yandex Speechkit supports only `ASRLanguage.RUSSIAN_RU`" — i.e. Hebrew ASR is **not available on those two providers**, only on whichever provider(s) support `HEBREW_IL` (Google is the standard choice, consistent with KALFA's existing Google he-IL TTS provider choice).

**KALFA relevance — HIGH.** Confirms/documents the exact enum value (`ASRLanguage.HEBREW_IL`) the scenario should be passing for guest-speech recognition, and rules out T-Bank/Yandex as ASR providers for this use case. No Hebrew `ASRDictionary` exists, so there's no way to bias recognition toward e.g. Hebrew RSVP-specific vocabulary (yes/no/maybe/names) via a dictionary — any such biasing would have to happen in the LLM/Groq layer instead, not the ASR layer.

---

## 12. Dialogflow enums

**Pages:** `DialogflowLanguage`, `DialogflowModel`, `DialogflowModelVariant`, `DialogflowSsmlVoiceGender`

- `DialogflowLanguage` — **122 values**, all `require(Modules.AI)`-gated, matching the [Dialogflow ES language table]. Includes `HE`? — **checked: not present.** The list covers AF, AM, AZ, BE, BG, BN(+regional), BS, CA, CEB, CO, CS, CY, DA, DE, EL, EN(+regional), EO, ES(+regional), ET, EU, FI, FIL(+regional), FR(+regional), FY, GA, GD, GL, GU, HA, HI, HMN, HR, HT, HU, HY, ID, IG, IS, IT, JA, JV, KA, KK, KM, KN, KO, KU, KY, LA, LB, LT, LV, MG, MI, MK, ML, MN, MR(+regional), MS(+regional), MT, NE, NL, NO, NY, OR, PA, PL, PT(+regional), RO(+regional), RU, RW, SI(+regional), SK, SL, SM, SN, SO, SQ, SR, ST, SU, SV, SW, TA(+regional), TE(+regional), TG, TH, TK, TR, TT, UK, UZ, VI(+regional), XH, YO, ZH(regional only: CN/HK/TW), ZU. **No `HE`/Hebrew code appears in this list at all** — Dialogflow ES has no Hebrew language support.
- `DialogflowModel` (4 values) — audio transcription model selection: `COMMAND_AND_SEARCH` (short clips/commands), `DEFAULT` (general, ≥16kHz ideal), `PHONE_CALL` (8kHz telephony audio — **premium/costs more**), `VIDEO` (multi-speaker/video, ≥16kHz — **premium/costs more**).
- `DialogflowModelVariant` (4 values) — `SPEECH_MODEL_VARIANT_UNSPECIFIED` (defaults to best-available), `USE_BEST_AVAILABLE`, `USE_ENHANCED` (falls back to standard if unavailable for the model+language, or errors if account isn't eligible), `USE_STANDARD`.
- `DialogflowSsmlVoiceGender` (4 values) — `MALE | FEMALE | NEUTRAL | UNSPECIFIED`.

**KALFA relevance — confirms an architectural decision, doesn't change it.** Since **Dialogflow has no Hebrew language support** (`HE` absent from `DialogflowLanguage`), this independently confirms why KALFA's voice-agent architecture bypasses VoxEngine's built-in Dialogflow/Avatar integration entirely in favor of a custom Groq LLM bridge over WebSocket + Google TTS/ASR called directly — Dialogflow was never a viable option for Hebrew. Worth keeping as documented justification if the architecture is ever questioned.

---

## 13. Modules enum — `require()` target list

**Page:** `Modules` (enum, 27 values)

The authoritative list of everything loadable via `require(Modules.X)`:
`ACD` (legacy, superseded by SmartQueue), `AI` (Dialogflow/NLP extras), `ASR`, `ApplicationStorage` (key-value storage), `Avatar` (Voximplant's own virtual-assistant framework), `Cartesia`, `Conference`, `Deepgram`, `ElevenLabs`, `Gemini`, `Google`, `Grok`, `IVR` (legacy menu helper — doc explicitly recommends using `Call.say`/`Call.startPlayback`/`Call.handleTones` directly instead), `Inworld`, `MCP` (**Model Context Protocol** — i.e. VoxEngine has first-class MCP support), `OpenAI`, `Pipecat`, `PushService` (iOS/Android push), `Recorder`, `Silero`, `SmartQueue` (ACD v2 / contact-center), `StreamingAgent`, `Ultravox`, `VoxTTS` (Voximplant's own native realtime TTS), `VoximplantAPI` (lets a scenario call the HTTP Management API from inside a scenario), `XAI` (Grok's parent, xAI TTS), `Yandex`.

**KALFA relevance — HIGH / informational.** This is the full menu of first-party voice-AI provider integrations VoxEngine now ships. Notable for KALFA's context:
- **`AI` / `Google`** modules are what's presumably `require()`'d already for Dialogflow-adjacent + Google TTS/ASR use.
- **`Modules.MCP`** existing as a built-in module is notable — VoxEngine scenarios can speak Model Context Protocol natively, which is a possible future integration path instead of the current bespoke Groq WebSocket bridge (out of scope to act on now, just worth flagging as a capability that exists).
- The presence of many **direct LLM-provider modules** (`OpenAI`, `Gemini`, `Grok`/`XAI`, `Deepgram`, `ElevenLabs`, `Cartesia`, `Ultravox`, `Inworld`, `Pipecat`) shows Voximplant has since added native connectors for exactly the kind of "LLM bridge" KALFA hand-rolled with Groq over a raw WebSocket — none of these listed modules is `Groq` by name, so the custom bridge approach remains necessary unless Voximplant later adds a `Groq` module.
- `VoximplantAPI` module lets scenario code call the Management API **from inside the call itself** — a possible simplification for anything the ctx/cb HTTP endpoints currently do via external calls.

---

## 14. Misc call/media enums

**Pages:** `CallAudioQuality`, `ConferenceDirection`, `ConferenceMode`, `DTMFType`

- `CallAudioQuality` — `STANDARD | HD`.
- `ConferenceDirection` (`require(Modules.Conference)`) — `SEND` (outgoing only, endpoint→conference), `RECEIVE` (incoming only), `BOTH`. **Doc bug noted:** both `BOTH` and `SEND` are described with the identical text "Provides only outgoing stream from endpoint to conference" — `BOTH`'s description is very likely a copy-paste error in Voximplant's own docs (should describe bidirectional); don't take the literal `BOTH` description at face value.
- `ConferenceMode` — `MIX` (combine all streams) | `FORWARD` (send only one stream through).
- `DTMFType` — controls which DTMF detection method(s) trigger `CallEvents.ToneReceived`: `ALL` (in-band + RFC2833 + SIP INFO — note: **receiving an RFC2833 tone disables in-band processing** to avoid duplicate events), `IN_BAND`, `SIP_INFO`, `TELEPHONE_EVENT` (RFC2833 only).

**KALFA relevance:** `DTMFType` is relevant if the RSVP call ever adds a **"press 1 to confirm"** fallback path alongside/instead of speech — worth knowing `ALL` is the safe default (auto-dedupes in-band vs RFC2833). `ConferenceDirection`/`ConferenceMode`/`CallAudioQuality` are not relevant to the current single-party outbound call architecture.

---

## 15. SmartQueue / contact-center status enums

**Pages:** `SmartQueueOperatorSettingsMode`, `TaskWaitingCode`, `TerminationStatus`, `SmartQueue` (typedef)

- `SmartQueue` typedef — `{id: number, name?: string} | {id?: number, name: string}` — a queue reference needs **either** an id or a name (at least one required, matching the interface's stated "identifier or name must be provided").
- `SmartQueueOperatorSettingsMode` — `SMART` (reassign task to another operator if the specific one can't be selected) | `STRICT` (cancel the task instead of reassigning).
- `TaskWaitingCode` (4 values) — ETA-estimation status for a queued task: `SUCCESS` (ETA calculated), `CANNOT_BE_ESTIMATED`, `OVERFLOWED` (queue full), `NONE` (not queued).
- `TerminationStatus` (15 values) — how a SmartQueue task ended: `NORMAL`, `TRANSFERRED`, `CANCELED`, `CLIENT_TERMINATE`, `FINISHED_BY_CLIENT`, `FINISHED_BY_OPERATOR`, `FAILED` (agent missed/declined), `TIMEOUT_REACHED`, `MAX_WAITING_TIME_REACHED`, `MAX_QUEUE_SIZE_REACHED`, `QUEUE_EMPTY`, `OPERATOR_NOT_AVAILABLE`, `MS_NOT_ANSWERED` (media server didn't answer), `INTERNAL_ERROR`, `NONE`. Each value's doc description tags which underlying status-code family it correlates with (`EndTaskCode`, `EndOperatorActivityCode`, `TaskCanceledCode`, `ErrorCode`) — useful cross-reference when correlating a `TerminationStatus` against raw call-history codes.

**KALFA relevance:** Low today — SmartQueue/contact-center (human agent queueing) isn't part of KALFA's architecture (fully automated AI calls, no live-agent handoff/queue). Would become relevant only if a "transfer to a human" escalation path with agent queueing is built (see also `TransferToParameters`, §5, for the simpler blind/attended transfer that doesn't require the full SmartQueue machinery).

---

## 16. TTSEffectsProfile enum

**Page:** `TTSEffectsProfile` (8 values) — Google-only "audio effects" profiles applied post-synthesis, passed via `TTSOptions.effectsProfileId` (array — multiple can stack, applied in the order listed). Values, each named for its target playback device: `HandsetClassDevice` (smartphones), `HeadphoneClassDevice` (earbuds/headphones), `SmallBluetoothSpeakerClassDevice` (e.g. Google Home Mini), `MediumBluetoothSpeakerClassDevice` (e.g. Google Home), `LargeAutomotiveClassDevice` (car speakers, home theaters), `LargeHomeEntertainmentClassDevice` (smart TVs, e.g. LG TV), `WearableClassDevice` (smartwatches), `TelephonyClassApplication` (IVR systems).

**KALFA relevance — HIGH, worth testing.** Since KALFA's calls are delivered over a standard telephone line to a phone, **`TelephonyClassApplication`** is the semantically correct profile to try — it's Google's own audio-post-processing preset tuned for IVR/phone-line playback (narrower bandwidth, likely optimized intelligibility over a telephony codec) rather than the default (presumably tuned for a generic/no device). This is a candidate lever for improving perceived Hebrew TTS call quality that doesn't appear to have been tried yet based on prior session findings — flag to `hebrew-tts-specialist`/`voximplant-engineer` for an A/B test via `TTSOptions.effectsProfileId: [TTSEffectsProfile.TelephonyClassApplication]`.

---

## 17. TranscriptionProvider enum

**Page:** `TranscriptionProvider` (3 values: `GOOGLE | TBANK | YANDEX`) — used by `CallRecordParameters.provider` (i.e., **transcription of a call recording**, a different feature from live in-call ASR). Doc repeats the same T-Bank/Yandex Russian-only caveat as `ASRLanguage`.

**KALFA relevance:** If KALFA ever wants an automatic Hebrew transcript of a completed/recorded RSVP call (for QA — see `[[voice-call-qa-analyst]]`), `GOOGLE` is the only viable provider of these three (T-Bank/Yandex are Russian-only per the repeated doc caveat).

---

## 18. VoxTTS-native enums

**Pages:** `VoxTTSModelList` (1 value: `VoxTTS`), `VoxTTSVoiceList` (2 values: `Anna`, `Sergey` — no descriptions given, but names read as a female/male Russian-voice pair)

**KALFA relevance:** None directly — this is Voximplant's own **native realtime TTS engine** (`Modules.VoxTTS`, distinct from the Google/Amazon/etc. third-party TTS integrations). Only 2 voices, no indication of Hebrew support (names suggest Russian-market voices), so not a candidate to replace the current Google he-IL Chirp3-HD voice.

---

## 19. Remaining typedefs (union-type aliases)

**Pages:** `IVRPrompt`, `PlaybackParameters`, `RecorderLayoutPriority` (already covered §7), `SequencePlaybackSegment`, `SequencePlayerSegment`, `VoxMediaUnit`

- `IVRPrompt` — `{lang, play, say}` where either `play` (an audio URL/id) or the pair `(say, lang)` (TTS text + language) is used, not both — a menu prompt can be pre-recorded audio OR a TTS say-string, mutually exclusive per the doc note.
- `PlaybackParameters` — union: `TTSPlaybackParameters | URLPlaybackParameters | SequencePlaybackParameters` — the type accepted by `VoiceChannelParameters.playback` (Avatar engine), i.e. "play either TTS, a URL file, or a sequence of both."
- `SequencePlaybackSegment` — union: `TTSPlaybackParameters | URLPlaybackParameters` (one segment in an Avatar-channel sequence).
- `SequencePlayerSegment` — union: `TTSPlayerSegment | URLPlayerSegment` (one segment in a `SequencePlayer`, the lower-level non-Avatar equivalent).
- `VoxMediaUnit` — the umbrella union of every "media unit" type manageable in a scenario: `Call | Player | SequencePlayer | ASR | Conference | Recorder | WebSocket | StreamingAgent | Gemini.LiveAPIClient | Inworld.RealtimeAPIClient | Cartesia.AgentsClient | Ultravox.WebSocketAPIClient | Deepgram.VoiceAgentClient | Grok.VoiceAgentAPIClient | Silero.VAD | Pipecat.TurnDetector`. This list is a good cross-check against §13's `Modules` enum — it shows every provider module's concrete client-class name (e.g. confirms `Modules.Gemini` → `Gemini.LiveAPIClient`, `Modules.Grok`/`XAI` → `Grok.VoiceAgentAPIClient`, `Modules.Silero` → `Silero.VAD` a voice-activity-detector, `Modules.Pipecat` → `Pipecat.TurnDetector` a conversational turn-taking detector).

**KALFA relevance:** `Silero.VAD` (voice-activity detection) and `Pipecat.TurnDetector` (turn-taking detection) stand out as directly applicable off-the-shelf building blocks for **improving the anti-hangup/turn-taking logic** in the RSVP conversation (`[[voice-rsvp-agent]]` territory) — potentially replacing or augmenting the current duration-based silence/hangup fallback with a purpose-built VAD/turn-detector module, without needing the full Dialogflow/Avatar stack (which is ruled out for Hebrew per §12).

---

## INVENTORY — all 71 page titles in scope (manifest lines 73-143)

**Interfaces (19):** StreamingAgentParameters, StreamingAgentTrack, TTSOptions, TTSPlaybackParameters, TTSPlayerParameters, TTSPlayerSegment, TextChannelParameters, ToneScriptPlayerParameters, TransferToParameters, URLPlaybackParameters, URLPlayerParameters, URLPlayerRequest, URLPlayerRequestBody, URLPlayerRequestHeader, URLPlayerSegment, UpdateRecorderVideoParameters, VoiceChannelParameters, WebSocketMediaInfo, WebSocketParameters

**Functions (15):** base64_decode, base64_encode, bytes2hex, bytes2str, clearInterval, clearTimeout, getLocalTime, hex2bytes, levenshtein_distance, require, setInterval, setTimeout, str2bytes, trace, uuidgen

**Enums (30):** ASRDictionary, ASRLanguage, CallAudioQuality, ConferenceDirection, ConferenceMode, DTMFType, DialogflowLanguage, DialogflowModel, DialogflowModelVariant, DialogflowSsmlVoiceGender, Modules, RecordExpireTime, RecorderDirection, RecorderLabelFont, RecorderLabelPosition, RecorderLabelTextAlign, RecorderLayout, RecorderObjectFit, RecorderProfile, SmartQueueOperatorSettingsMode, TTSEffectsProfile, TaskWaitingCode, TerminationStatus, TranscriptionProvider, URLPlayerRequestMethod, VoxTTSModelList, VoxTTSVoiceList, WebSocketAudioEncoding, WebSocketCloseCode, WebSocketReadyState

**Typedefs (7):** IVRPrompt, PlaybackParameters, RecorderLayoutPriority, SequencePlaybackSegment, SequencePlayerSegment, SmartQueue, VoxMediaUnit

Total: 19 interfaces + 15 functions + 30 enums + 7 typedefs = **71** — matches the manifest line count and the raw-file page count (`grep -c "^=== FQDN:"` = 71, 0 failures, 0 parse errors) exactly.
