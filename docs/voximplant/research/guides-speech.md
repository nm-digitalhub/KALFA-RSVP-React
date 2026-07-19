# Voximplant Docs Research — Group: guides-speech (Speech processing)

Fleet research notes. Scope: `guides.speech` folder + all 9 child tutorials (10 pages). All pages fetched DEEP via `https://voximplant.com/api/v2/getDoc?fqdn=...` on 2026-07-19.

NOTE: Plan mode restricted file writes to this plan file, so these notes live here instead of `<scratchpad>/vox-research/guides-speech.md`.

---

## 1. Speech synthesis (`guides.speech.tts`)

**Covers:** classic (non-streaming) TTS during calls/conferences.

**Key APIs:**
- `VoxEngine.createTTSPlayer(text, { voice, ttsOptions, request })` — main TTS entry; also `Call.say(text, { voice, ttsOptions, request })` (`CallSayParameters`).
- `call.startEarlyMedia()` — play TTS *before* answering (greeting/voicemail prompt).
- Voice selection via `VoiceList.*` (reference: `references/voxengine/voicelist`). **Default voice = `VoiceList.Amazon.en_US_Joanna`.**
- Custom provider voices (e.g., Yandex `yandexCustomModelName` voice-folder ID) require **contacting support to activate** per account.

**ttsOptions (platform-normalized, converted per provider):**
- `pitch`: `0.5Hz`–`2Hz` or `x-low | low | medium | high | x-high | default`
- `rate`: `x-slow | slow | medium | fast | x-fast | default`
- `volume`: `silent | x-soft | soft | medium | loud | x-loud | default`
- Whole-text options need no `<speak>` tag; per-fragment styling requires manual `<speak>` + provider-specific tags (Amazon: `prosody`, `say-as`).
- **GOTCHA:** supported tag list depends on the provider; an unsupported tag triggers `PlayerEvents.PlaybackFinished` with **error 400**.

**`request` parameter (provider-native passthrough):** instead of `ttsOptions`, pass the provider's own request schema verbatim:
- Google: `SynthesizeSpeechRequest` — `input.ssml` (breaks etc.), `audioConfig: { volumeGainDb, pitch, speakingRate }`.
- ElevenLabs: `{ text, model_id, voice_settings: { stability, similarity_boost } }` — `model_id` effectively required (defaults to `eleven_multilingual_v2`).
- SaluteSpeech: `{ text, content_type }`; T-bank: `SynthesizeSpeechRequest`; Yandex v3: `UtteranceSynthesisRequest` with `text_template` + variables + `hints` (voice/speed).
- GOTCHA: formats differ per provider; required params differ (error vs default fallback).
- Alternative for unsupported providers: Media player (URL player) → e.g., OpenAI TTS.

**KALFA relevance:** Confirms the live-verified behavior that SSML tag support is provider-dependent and unsupported tags fail (PlaybackFinished error 400) — consistent with `call.say()` Google he-IL reading tags literally / failing; plain-niqqud approach remains right. The `request` passthrough is the documented way to send Google-native `audioConfig` (speakingRate/pitch) for he-IL voices without SSML.

---

## 2. Realtime speech synthesis (`guides.speech.realtime-tts`)

**Covers:** streaming TTS where text arrives in chunks (explicitly aimed at LLM output, e.g., ChatGPT-style chunked text) — the low-latency voice-agent pattern.

**Providers & modules (each has `createRealtimeTTSPlayer` + player events):**
- **VoxTTS** (`Modules.VoxTTS`) — Voximplant in-house realtime TTS, **currently Russian only**. `createRealtimeTTSPlayer({ createContextParameters: { create: { modelId: VoxTTS.ModelList.VoxTTS, voiceId: VoxTTS.VoiceList.Anna }, contextId } })`; `player.send({ send_text: { text, flush_context: {} }, contextId })`. Stress control via acute accent on a vowel in the text.
- **Google** (`Modules.Google`) — `Google.createRealtimeTTSPlayer({ language_code: 'en-US', voice: 'Aoede' })`; `player.send({ input: { text } })`. Backed by Google Cloud TTS v1 `StreamingSynthesize`.
- **ElevenLabs** (`Modules.ElevenLabs`) — `ElevenLabs.createRealtimeTTSPlayer(initialText, { pathParameters: { voice_id }, queryParameters: { model_id: 'eleven_flash_v2_5', enable_ssml_parsing, inactivity_timeout }, headers: [{ name: 'xi-api-key', value: 'API_KEY' }], keepAlive, initializeConnectionParameters: { voice_settings: { speed } } })`; stream text with `player.sendText({ text, flush })`, finish with `sendText({ text: '' })`; end on `PlayerEvents.PlaybackFinished`. **Custom API key via `xi-api-key` header enables personal ElevenLabs account/custom voices.**
- **Cartesia** (`Modules.Cartesia`) — `createRealtimeTTSPlayer(text, { apiKey, generationRequestParameters })` with `model_id: 'sonic-3'`, `voice: { mode: 'id', id }`, `language`, `context_id`, `continue: true`; subsequent `player.generationRequest({... transcript ...})`; **flush request** plays buffered chunks immediately (responsiveness for long phrases); completion event `PlayerEvents.AudioChunksPlaybackFinished`.
- **Inworld** (`Modules.Inworld`) — `createRealtimeTTSPlayer({ createContextParameters: { create: { modelId: 'inworld-tts-1', voiceId: 'Dennis' } }, apiKey })` (Basic/Base64 key); `player.send({ send_text: { text, flush_context: {} } })`; `AudioChunksPlaybackFinished`.
- **xAI** (`Modules.XAI`) — WebSocket streaming TTS; `XAI.createRealtimeTTSPlayer({ connectionParameters: { voice: 'eve', language: 'en' } })`; send native WS messages `{ type: 'text.delta', delta }` then `{ type: 'text.done' }`. **MediaServer fixes telephony audio format: `codec=pcm`, `sample_rate=16000`.**

**Common pattern:** require module → create player → `player.sendMediaTo(call)` (or `VoxEngine.sendMediaBetween`) → stream text via `send`/`sendText`/`generationRequest` → listen to `PlaybackFinished` / `AudioChunksPlaybackFinished` → `player.stop()`.

**KALFA relevance:** This is the strongest page for the ElevenLabs evaluation: ElevenLabs realtime TTS is a first-class VoxEngine module with custom API key support (`xi-api-key`) — a Groq-LLM-chunks → `sendText({flush})` pipeline is the documented low-latency replacement for `call.say()`. Model shown (`eleven_flash_v2_5`) is ElevenLabs' low-latency multilingual family (Hebrew support must be verified on the ElevenLabs side, not stated in this doc). VoxTTS is irrelevant (Russian only).

---

## 3. Speech recognition (`guides.speech.asr`)

**Covers:** live ASR in calls, call transcription, provider passthrough, emotions/gender, interim results.

**Two modes:** **Phrase hint** (recognize from predefined phrase list — IVR/dialogs; **Google profiles only**; hints bias but don't restrict results) vs **Freeform** (transcribe everything; `Result` fires per recognized chunk with latency).

**Engines:** Google, Amazon, Microsoft, Yandex, T-bank (+ SaluteSpeech) — profile names in `references/voxengine/asrprofilelist`.

**Usage flow:** `require(Modules.ASR)` → `VoxEngine.createASR({ profile: ASRProfileList.Google.en_US, phraseHints: [...] })` → `call.sendMediaTo(asr)` → events:
- `ASREvents.Result` (`e.text`, `e.confidence` — 0 means not recognized)
- `ASREvents.SpeechCaptured` (typically `call.stopMediaTo(asr)` here in hint mode)
- `ASREvents.CaptureStarted`, `ASREvents.InterimResult`

**Call transcription:** `call.record({ transcribe: true, language: ASRLanguage.ENGLISH_US, provider: TranscriptionProvider.GOOGLE })`. **Results are NOT available during/right after the call** — fetch via HTTP API `GetCallHistory?with_records=true` → `records[].transcription_url` (plain text; lines prefixed `Left`/`Right` per direction, renameable via `RecorderParameters.labels`; `dict` array biases transcription toward domain words).

**Google beta (v1p1beta1) features:** set `beta: true` on `createASR`, plus `model` (`ASRModelList.Google.default_enhanced`), `singleUtterance`, `enableSeparateRecognitionPerChannel`, `alternativeLanguageCodes`, `enableWordTimeOffsets`, `enableWordConfidence`, `enableAutomaticPunctuation`, `diarizationConfig.enableSpeakerDiarization`, `metadata.microphoneDistance`. Result gains `resultEndTime`, `channelTag`, `languageCode`, per-word timings/speaker tags.

**Provider-native passthrough:** `request` param on `createASR` (like TTS): Google `config.speech_contexts.phrases` + `profanity_filter` + `single_utterance` + `interim_results`; SaluteSpeech `hypotheses_count`, `no_speech_timeout`/`max_speech_timeout` `{seconds}`, `hints.words`, `enable_multi_utterance`; T-bank scored `speech_contexts.phrases[{text,score}]`; Yandex `specification.*`.

**Extras:** SaluteSpeech emotion recognition (`emotions_result` → `emotionsResult {positive,neutral,negative}` in Result); T-bank gender identification (`enable_gender_identification` → male/female probabilities). **Interim results:** `interimResults: true` + `ASREvents.InterimResult` for lower perceived latency (provider support varies — see `asrparameters#interimresults`).

**KALFA relevance:** For the RSVP agent, ASR profile choice governs Hebrew: he-IL availability lives in `ASRProfileList` (references group), but the *behaviors* here matter — phrase-hint biasing is Google-only (Hebrew yes/no/number capture should use Google profile + `phraseHints` in Hebrew or `request.config.speech_contexts`), and `interimResults` + `singleUtterance` are the latency levers for turn-taking. Post-call `transcription_url` via GetCallHistory could feed KALFA's call audit/QA trail.

---

## 4. VAD / TURN detection (`guides.speech.vad-turn-detection`)

**Covers:** minimal-latency turn-taking for voice agents.
- **`Modules.Silero`** — Silero VAD, independent of ASR built-in detectors; segments audio into speech vs silence/noise. `const vad = await Silero.createVAD({ threshold: 0.5, minSilenceDurationMs: 300, speechPadMs: 10 })` (async!). Events: `Silero.VADEvents.Result` (has `speechEndAt`), `.Error`, `.ConnectorInformation`.
- **`Modules.Pipecat`** — Pipecat Turn Detection: distinguishes a mid-sentence pause from the actual end of an utterance. `const turnDetector = await Pipecat.createTurnDetector({ threshold: 0.5 })`; call `turnDetector.predict()` when VAD reports `speechEndAt`; events `Pipecat.TurnEvents.Result/Error/ConnectorInformation`.
- Wire-up: `call.sendMediaTo(vad)` AND `call.sendMediaTo(turnDetector)`; close both on Disconnected/Failed.

**KALFA relevance:** Directly applicable to the Hebrew voice agent's barge-in/turn-taking; both models are language-agnostic acoustic/semantic detectors, so Hebrew should work. Combining Silero VAD (speech end) → Pipecat `predict()` (is the turn over?) is the documented low-latency alternative to relying on ASR end-of-speech, and pairs naturally with the Groq bridge to decide when to trigger LLM responses.

---

## 5. Media players (`guides.speech.media-player`)

**Covers:** playing TTS or media files during calls/conferences.
- **TTS player** `VoxEngine.createTTSPlayer` and **URL player** `VoxEngine.createURLPlayer(urlPlayerRequest, urlPlayerParameters)`.
- URL player supports plain GET (`{ url }`) or **POST with `method: URLPlayerRequestMethod.POST`, `headers: [{name,value}]`, `body: { text: JSON.stringify(...) }`** — i.e., any HTTP TTS API can be a player source (shown with `xi-api-key` header, i.e., ElevenLabs-style).
- Sequence: player → `player.sendMediaTo(call)`; chain via `PlayerEvents.PlaybackFinished`. `startEarlyMedia` works pre-answer.
- **LIMIT:** max **10 media players per JS session (one scenario)**.
- **SequencePlayer** `VoxEngine.createSequencePlayer({ segments: [...] })` — segments are `{ text, parameters? }` (TTS, per-segment voice override e.g. `VoiceList.Microsoft.Neural.en_GB_MaisieNeural`) or `{ url }` (media file); manages all per-player events itself; API in `sequenceplayerevents` reference.

**KALFA relevance:** URL-player POST is the non-streaming ElevenLabs/OpenAI integration path (simpler than realtime module, higher latency). The 10-players-per-session cap is a real constraint for a multi-turn RSVP conversation that creates a new TTS player per agent reply — reuse players, use SequencePlayer, or prefer a single realtime TTS player.

---

## 6. OpenAI TTS voices (`guides.speech.openai`)

**Covers:** using OpenAI TTS via URL player. Requirements: OpenAI account + API key.
- POST `https://api.openai.com/v1/audio/speech`, headers `Authorization: Bearer <key>`, `Content-Type: application/json`; body `{ model: 'tts-1', input: <text>, voice: 'alloy' }`.
- `urlPlayerParameters = { progressivePlayback: true }` → playback starts while downloading.
- Voice/params per OpenAI TTS docs.

**KALFA relevance:** Template for any bring-your-own HTTP TTS (the same shape works for ElevenLabs' HTTP endpoint). `progressivePlayback: true` is the latency-mitigation knob for URL-player TTS.

---

## 7. External ASR providers (`guides.speech.asr-providers`)

**Covers:** connecting *any* STT provider via WebSockets when built-in engines don't suffice.
- Scenario: `const ws = VoxEngine.createWebSocket('wss://...')` (outgoing WS from Voximplant cloud); events `WebSocketEvents.OPEN/MESSAGE/CLOSE/ERROR`; on server hello → `call.sendMediaTo(webSocket, { encoding: WebSocketAudioEncoding.ULAW, tag: 'MyAudioStream', customParameters: {...} })`.
- Audio arrives at the backend as JSON messages `{ event: 'media', media: { payload: <base64> } }`; example backend = Node.js `express` + `ws` + `@google-cloud/speech` streamingRecognize with `{ encoding: 'MULAW', sampleRateHertz: 8000, languageCode: 'en-US', interimResults: true }`; transcripts pushed back over the same WS (scenario receives them in `WebSocketEvents.MESSAGE` `e.text`).
- Dev exposure via ngrok; test via webphone `phone.voximplant.com` with an app user + routing rule (default pattern `.*`).

**KALFA relevance:** This is the bring-your-own-ASR escape hatch: if built-in he-IL profiles underperform on Israeli names/Hebrew RSVP replies, KALFA can stream ULAW-8kHz audio to its own backend (e.g., Whisper-family / Groq-hosted ASR) and return text — the same architectural slot as the existing Groq LLM bridge, and the same WebSocket machinery documented in guides.media-streams.

---

## 8. IVR module basics (`guides.speech.ivr-basics`)

**Covers:** `Modules.IVR` helper (higher-level than `Call.say`/`Call.startPlayback`/`Call.handleTones`).
- `new IVRState(name, settings, onInputFinished?, onInputTimeout?)`; enter with `state.enter(call)`.
- 4 state types:
  1. `noinput` — prompt only; `nextState` or `onInputComplete` callback.
  2. `select` — DTMF menu; `nextStates: { '1': stateA, ... }`; states can self-loop (`state1.settings.nextStates['0'] = state1`).
  3. `inputfixed` — fixed-length digits (`inputLength`).
  4. `inputunknown` — variable length, `terminateOn: '#'` or custom `inputValidator(input) => boolean`.
- Prompts: `prompt: { play: <mp3 url> }` or (per ivr guide) `{ say: <text>, lang: VoiceList... }`. Timeout callbacks receive partial input.

**KALFA relevance:** Ready-made DTMF fallback for guests who won't converse with the AI: "press 1 to confirm, 2 to decline, 3 for headcount" — a robust reached-contact signal for per-reached billing, immune to Hebrew ASR quality issues.

---

## 9. Building an IVR (`guides.speech.ivr`)

**Covers:** full step-by-step IVR build (application → scenario → routing rule → phone number).
- **GOTCHA:** a phone number is needed both to *call* the IVR and as *caller ID* for forwarding; **test numbers cannot be used as caller ID** (rented or verified numbers only).
- Complete scenario: intro (`noinput`, TTS prompt via `say` + `lang: VoiceList.Amazon.en_US_Joanna`) → menu (`select`, 3 options) → time state / 3-digit extension (`inputfixed`) / US-number forward (`inputunknown` + `#`), external validation via `Net.httpRequest`, forwarding via `VoxEngine.callPSTN(number, callerId)` + `VoxEngine.sendMediaBetween(in, out)`; init states on `AppEvents.Started`; `PlaybackFinished`-driven chaining with `removeEventListener` hygiene.
- Voice-driven menus → see the ASR guide.

**KALFA relevance:** The caller-ID rule matters for KALFA outbound: the +972 presentation number must be rented/verified with Voximplant. `Net.httpRequest` from inside a state mirrors KALFA's ctx/cb callback pattern.

---

## Cross-cutting gotchas (whole group)

1. Unsupported SSML/provider tags → `PlaybackFinished` error 400 (provider-dependent tag lists) — matches KALFA's live finding that `call.say()` Google he-IL mishandles SSML.
2. Max 10 media players per scenario session.
3. Phrase-hint ASR mode = Google profiles only; hints bias, not restrict.
4. Call transcription is post-hoc only (GetCallHistory `with_records=true` → `transcription_url`), never realtime.
5. Custom TTS voices require support activation per account.
6. ElevenLabs `model_id` is effectively required (silent default `eleven_multilingual_v2`).
7. xAI realtime TTS fixes telephony audio to pcm/16000.
8. VoxTTS (in-house realtime TTS) is Russian-only.
9. `Silero.createVAD` / `Pipecat.createTurnDetector` are async (await them).
10. Realtime-TTS session teardown: `player.stop()` + `PlaybackFinished`/`AudioChunksPlaybackFinished` handling; Cartesia/others need explicit flush to drain buffers.

---

## INVENTORY (all pages in scope)

| fqdn | kind | title | fetched |
|---|---|---|---|
| guides.speech | folder | Speech processing | yes |
| guides.speech.tts | tutorial | Speech synthesis | yes |
| guides.speech.realtime-tts | tutorial | Realtime speech synthesis | yes |
| guides.speech.asr | tutorial | Speech recognition | yes |
| guides.speech.vad-turn-detection | tutorial | VAD / TURN detection | yes |
| guides.speech.media-player | tutorial | Media players | yes |
| guides.speech.openai | tutorial | OpenAI TTS voices | yes |
| guides.speech.asr-providers | tutorial | External ASR providers | yes |
| guides.speech.ivr-basics | tutorial | IVR module basics | yes |
| guides.speech.ivr | tutorial | Building an IVR | yes |

(Concrete he-IL voice/profile availability lives in the references group: `references/voxengine/voicelist` and `references/voxengine/asrprofilelist` — outside this group's scope.)
