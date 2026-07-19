# Voximplant Avatar references — research notes (group: vox-ref-avatar)

Scope: `references.voxengine.voximplantavatar` (8 pages) + all of `references.avatarapi` (8 pages) + all of `references.avatarengine` (118 pages) = 134 pages.
Fetched: 40 pages (roots, folders, focus pages) + property/member children for 14 focus pages via the raw getDoc JSON (`children[]` array carries per-property docs that the plain extractor drops).

## Big picture

Voximplant Avatar is the platform's built-in NLU/dialog-bot product. Three doc surfaces:

1. **`references.voxengine.voximplantavatar`** — the VoxEngine-side module (`require(Modules.Avatar)`) that ATTACHES an avatar to a live call. Two integration styles:
   - `createAvatar(AvatarConfig)` → `Avatar` class: bare NLU engine; YOU wire your own ASR + TTS (custom bundle).
   - `createVoiceAvatar(VoiceAvatarConfig)` → `VoiceAvatar` class: "superstructure" that auto-bundles ASR + TTS + Player around a `Call` object — it handles ASR events, playback, interruptions, and callbacks for you.
2. **`references.avatarapi`** — a small HTTP API for driving an avatar conversation from OUTSIDE telephony (text channel / external backend): Login → Bearer token, then `Conversation` calls with `avatarId` header, exchanging `UserUtterance` {text} for `AvatarResponse` {utterance, isFinal, customData}.
3. **`references.avatarengine`** — the runtime environment INSIDE the avatar script itself (the dialog scenario you author in the Voximplant portal): a state machine (`addState`/`AvatarState`), response generation (`generateResponse`/`AvatarResponseParameters`), NLU results (`AvatarUtteranceEvent`, intents + entities), NLU hints, rich content for text channels, utility functions (httpRequest, timers, base64, levenshtein, uuid), plus catalog folders for ASR models/profiles and TTS voices per vendor.

## 1. VoxEngine module: VoximplantAvatar (how an avatar attaches to a call)

- `require(Modules.Avatar);` then `VoximplantAvatar.createVoiceAvatar(config)` / `createAvatar(config)`.
- **AvatarConfig** (interface): `avatarId` (unique avatar id — the dialog script lives in the portal, referenced by id), `customData` (optional key-value pairs passed in for personalization, e.g. customer name — read inside the avatar script via `getCustomData()`), `extended` (optional; return detailed intent info to `Events.UtteranceParsed`; note: modern implementation always returns detailed info).
- **VoiceAvatarConfig** (interface): `avatarConfig`, `call` (the live Call object — THIS is the attach point), `asrParameters`, `asrEndOfPhraseDetectorTimeout` (ms; take last interim if no new interim within timeout; ~1000 ms recommended default, per-vendor tuning), `defaultListenTimeout` (default 10000 ms; on expiry the avatar state's REQUIRED `onTimeout` fires), `onErrorCallback` (default behavior: `VoxEngine.terminate()` — override to e.g. play an apology or transfer to human), `onFinishCallback` (avatar done; returns dictionary of data collected during the conversation), `ttsPlayerParameters` (language, progressivePlayback, volume, rate...).
- **Avatar class methods**: `addEventListener`/`removeEventListener` (only functions as handlers or scenario terminates), `start()` (transfer control to avatar; ONLY after `Events.Loaded`), `handleUtterance()` (push user phrase → triggers `Events.Reply`), `handleTimeout()`, `goToState()` (typical pattern: on `Events.Reply`, advance state).
- **VoiceAvatar class**: `addEventListener`/`removeEventListener` also accept `ASREvents` and `PlayerEvents` — everything else is automated.
- **Events**: `Loaded` (script ready — must precede `start()`), `Reply` (avatar ready to reply; carries `customData`), `UtteranceParsed` (recognized phrase — for debugging/logging recognition), `Finish` (conversation ended; carries `customData`), `Error`.

## 2. Avatar API (HTTP, non-telephony channel)

- `Login` interface: credentials per Management API authorization article → response contains token used for all other methods.
- `Avatar` interface: `Conversation` method; required headers `Authorization: Bearer <token>` and `avatarId: <id>`.
- Structures: `UserUtterance` {text} (send on every user message), `AvatarResponse` {utterance, isFinal — if true avatar processes no more inputs this conversation, customData}, `LoginRequest`, `LoginResponse`.
- Essence: lets an external backend run the same portal-authored avatar as a TEXT bot over HTTP.

## 3. AvatarEngine (inside the avatar dialog script)

State machine model:
- `addState(AvatarState)` / `addFormState` / `removeState` / `setStartState` / `getStartState` / `getStates` / `getFormState`.
- **AvatarState**: `name`, `onEnter`, `onUtterance` (customer said a phrase while in this state), `onTimeout` (REQUIRED — error thrown if missing when a listen timeout fires), `beforeExit`, `utteranceCounter` (resets on every state change, even to same state), `visitsCounter`.
- **generateResponse(AvatarResponseParameters)** → `AvatarResponse`, returned from state handlers. Parameters: `utterance` (what to say), `nextState`, `listen` (whether to listen after/while speaking; ignored if nextState set), `listenTimeout` (overrides defaultListenTimeout; text avatar default = unlimited), `interruptableAfter` (ms before barge-in allowed while avatar speaks), `isFinal` (true = end conversation; all other params except customData ignored), `customData` (surfaces to VoxEngine via Reply/Finish events — the bridge back to the call scenario), `channelParameters`, `currentState`, `nluHint`.
- **NLU**: `AvatarUtteranceEvent` {text, intent (or 'unknown'), intents (extended), confidence, entities (system+custom), response (default UI-configured response for the intent), currentState, utteranceCounter, visitsCounter}. `AvatarNluHint` {dataType, expectedEntity, locationParameters (DaData format — RU-centric)}; enums `AvatarNluHintExpectedDataType`, `AvatarNluHintExpectedEntity`, `AvatarEntityTimeGrain`. System entities: Duration/Location/Number/Person/Time/TimeRange/Unit + `AvatarUserEntity` (custom).
- **Channel parameters**: `ChannelParameters` {text: TextChannelParameters, voice: VoiceChannelParameters}. `VoiceChannelParameters` {asr (defaults inherited from VoiceAvatarConfig.asrParameters), playback (defaults from ttsPlayerOptions)} — per-response ASR/TTS override. Playback types: TTS / URL / Sequence (`TTSPlaybackParameters`, `URLPlaybackParameters`, `SequencePlaybackParameters`, typedefs `PlaybackParameters`, `SequencePlaybackSegment`).
- **Rich content** (text channels): RichContent + Buttons/ButtonItem/ButtonAction/Contact/ExternalLink/File/Location/Media.
- **Utilities**: `httpRequest` (Net.HttpRequestOptions/Result — outbound HTTP from inside the avatar script, i.e. a webhook path to KALFA's backend), timers (setTimeout/setInterval/clear*), `getCustomData()`, `getLocalTime`, `getLastUtteranceResponse`, `processUtteranceResponse`, base64/hex/str converters, `levenshtein_distance`, `uuidgen`, `Logger.write`.
- **SleepManager**: `onHibernate`/`onWakeup` — hibernation for TEXT avatar sessions (long-lived chat sessions).
- **Vendor catalogs**: ASRModelList + ASRProfileList folders per vendor (Amazon, Deepgram, Google, Microsoft, SaluteSpeech, TBank, Yandex, YandexV3); VoiceList per vendor (Amazon(+Neural), Default(freemium), **ElevenLabs**, Google, IBM(+Neural), Microsoft(+Neural), SaluteSpeech, TBank, Yandex(+Neural), YandexV3). Google enhanced ASR models cost more than the standard rate. VoiceList entries feed `Call.say`/`createTTSPlayer`.
- **TTSOptions**: SSML-spec-based options for CallSayParameters.ttsOptions / TTSPlayerParameters.ttsOptions; alternatively pass provider parameters directly as JSON via the `request` parameter (see Speech synthesis guide). `TTSEffectsProfile` enum.

## Limits & gotchas

- `start()` only after `Events.Loaded`; non-function event handlers terminate the scenario.
- `AvatarState.onTimeout` is REQUIRED — missing it errors at runtime when a listen timeout fires.
- Default `onErrorCallback` terminates the whole VoxEngine session (`VoxEngine.terminate`) — production flows should override it.
- `utteranceCounter` resets even when transitioning to the SAME state.
- `listen` is disregarded when `nextState` is set; `isFinal:true` ignores everything except customData.
- NLU hint location entities use DaData (Russian service) formats — RU-market bias in system entities.
- `asrEndOfPhraseDetectorTimeout` must be tuned per ASR vendor (~1000 ms baseline).
- Text avatars: no listen-timeout limit by default; hibernation handled via SleepManager.

## KALFA relevance

KALFA already runs its own bring-your-own-LLM bridge (Groq via ctx endpoint) with `call.say()` he-IL — the Avatar product is Voximplant's ALTERNATIVE to that architecture: portal-authored intent/state NLU bot attached via `createVoiceAvatar({avatarConfig:{avatarId, customData}, call, asrParameters,...})`. Key takeaways: (a) `customData` in/out (AvatarConfig.customData → getCustomData; AvatarResponseParameters.customData → Reply/Finish events) is the per-guest personalization channel and would face the same ~200-byte script_custom_data cap only at StartScenarios, not here; (b) VoiceAvatar gives free barge-in (`interruptableAfter`), listen timeouts, and end-of-phrase tuning that KALFA currently hand-rolls; (c) NLU intent training is portal-managed and its system entities are RU/DaData-biased — Hebrew NLU quality is unverified, which is the main risk vs. the current Groq prompt approach; (d) ElevenLabs appears as a first-class TTS vendor in VoiceList (relevant to KALFA's ElevenLabs evaluation — usable from plain `Call.say` too, not only avatars); (e) avatarengine `httpRequest` would let dialog logic call KALFA's ctx/cb endpoints directly from inside the avatar script.

## INVENTORY (every page in scope; * = fetched)

### references.voxengine.voximplantavatar (8)
- *VoximplantAvatar (ref_folder)
  - *Events (events)
  - *Avatar (class)
  - *VoiceAvatar (class)
  - *AvatarConfig (interface)
  - *VoiceAvatarConfig (interface)
  - *createAvatar (function)
  - *createVoiceAvatar (function)

### references.avatarapi (8)
- *Avatar API (root)
  - *Structures (ref_folder)
    - *UserUtterance (class)
    - *AvatarResponse (class)
    - *LoginRequest (class)
    - *LoginResponse (class)
  - *Avatar (interface)
  - *Login (interface)

### references.avatarengine (118)
- *AvatarEngine (root)
- *ASRModelList (ref_folder): Amazon, Deepgram, *Google, Microsoft, SaluteSpeech, TBank, Yandex, YandexV3
- *ASRProfileList (ref_folder): Amazon, Deepgram, Google, Microsoft, SaluteSpeech, TBank, Yandex, YandexV3
- Logger (ref_folder): write (function)
- *Net (ref_folder): HttpRequestOptions (interface), HttpRequestResult (interface)
- *SleepManager (ref_folder): onHibernate (function), onWakeup (function)
- *VoiceList (ref_folder): Amazon (+Neural), *Default, *ElevenLabs, *Google, IBM (+Neural), Microsoft (+Neural), SaluteSpeech, TBank, Yandex (+Neural), YandexV3
- Classes: *ASRModel, *ASRProfile, *Voice
- Interfaces: ASRParameters, AvatarEntities, AvatarFormState, AvatarFormStateParameter, *AvatarNluHint, *AvatarResponse, *AvatarResponseParameters, *AvatarState, AvatarStateChangeEvent, AvatarSystemDurationEntity, AvatarSystemLocationEntity, AvatarSystemNumberEntity, AvatarSystemPersonEntity, AvatarSystemTimeEntity, AvatarSystemTimeRangeEntity, AvatarSystemUnitEntity, AvatarTimeoutEvent, AvatarUserEntity, *AvatarUtteranceEvent, AvatarUtteranceIntent, *ChannelParameters, RichContent, RichContentButtonAction, RichContentButtonItem, RichContentButtons, RichContentContact, RichContentExternalLink, RichContentFile, RichContentLocation, RichContentMedia, SequencePlaybackParameters, *TTSOptions, TTSPlaybackParameters, TTSPlayerParameters, TextChannelParameters, URLPlaybackParameters, URLPlayerParameters, URLPlayerRequest, URLPlayerRequestBody, URLPlayerRequestHeader, *VoiceChannelParameters
- Functions: addFormState, *addState, base64_decode, base64_encode, bytes2hex, bytes2str, clearInterval, clearTimeout, *generateResponse, *getCustomData, getFormState, getLastUtteranceResponse, getLocalTime, getStartState, getStates, hex2bytes, httpRequest, levenshtein_distance, processUtteranceResponse, removeState, setInterval, setStartState, setTimeout, str2bytes, uuidgen
- Enums: AvatarEntityTimeGrain, AvatarNluHintExpectedDataType, AvatarNluHintExpectedEntity, TTSEffectsProfile, URLPlayerRequestMethod
- Typedefs: PlaybackParameters, SequencePlaybackSegment
