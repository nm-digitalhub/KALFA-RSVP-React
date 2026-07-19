# Voximplant Docs Research — Group: vox-ref-ai-providers

Scope: `references.voxengine.{cartesia,deepgram,elevenlabs,google,inworld,pipecat,silero,ultravox}` — the VoxEngine built-in AI-provider connector namespaces. 55 pages total, all 55 fetched (DEEP). Source: `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>`; public URLs = `https://voximplant.com/docs/` + fqdn with dots→slashes.

NOTE: this file was written to the plan-file path because the session runs in plan mode (only this file is writable). Intended path per task spec was `<scratchpad>/vox-research/vox-ref-ai-providers.md`.

---

## Cross-provider architecture (applies to every namespace here)

Two integration shapes exist:

1. **Voice-agent clients** (full duplex agent-over-WebSocket, provider runs ASR+LLM+TTS): `Cartesia.AgentsClient`, `Deepgram.VoiceAgentClient`, `ElevenLabs.AgentsClient`, `Inworld.RealtimeAPIClient`, `Ultravox.WebSocketAPIClient`. Created via async factory `create*Client(parameters)` → `Promise<Client>`. The client is a Vox media unit peer: wire audio with `client.sendMediaTo(mediaUnit)` / `stopMediaTo`, and send the call's audio to it with `VoxEngine.sendMediaBetween(call, client)` (referenced throughout). Common methods on every client: `addEventListener`/`removeEventListener` (non-function handler ⇒ error + scenario termination), `clearMediaBuffer(ClearMediaBufferParameters)`, `close()`, `id()`, `webSocketId()`.
2. **Realtime TTS players** (streaming TTS as a Player-like media unit): `Cartesia.RealtimeTTSPlayer`, `ElevenLabs.RealtimeTTSPlayer`, `Google.RealtimeTTSPlayer`, `Inworld.RealtimeTTSPlayer`. They emit standard **PlayerEvents** (e.g. `PlaybackFinished`), support `pause`/`resume`/`stop` (stop destroys the instance), `clearBuffer`, `sendMediaTo`/`stopMediaTo`, `id`. Cartesia/ElevenLabs factories take `(text, parameters?)`; Google/Inworld factories take `(parameters?)` only.

Common client/player parameters (identical wording everywhere):
- `privacy` (default **false**) — disables WebSocket logging entirely (PII-safe mode).
- `statistics` — enables statistics functionality.
- `trace` (default off) — dumps ALL sent/received WS messages plain-text to an S3 trace file; URL appears in the `websocket.created` log message. Diagnostics only.
- `onWebSocketClose(event: WebSocketEvents.CLOSE)` — close callback (clients only).

Common per-namespace `Events` group (Cartesia/Deepgram/ElevenLabs/Inworld/Ultravox all identical):
- `WebSocketMediaStarted` — provider audio started playing; handler fields: `client`, `customParameters`, `encoding`, `tag`.
- `WebSocketMediaEnded` — fires after **1 second of silence** in the provider's audio stream; fields: `client`, `mediaInfo: WebSocketMediaInfo`, `tag`. The `tag` names one of several audio streams multiplexed over one WS (2 audios → 2 media units simultaneously).

Voice-agent event handlers uniformly receive `{ client, data?: { customEvent?: string, payload: Object } }` — the provider's raw protocol message is in `payload`. All provider-protocol methods take a plain `Object` passed **directly through** to the provider's own wire protocol (Voximplant links each method to the provider's docs — the connector adds no schema of its own).

---

## ElevenLabs (FOCUS) — 10 pages

**AgentsClient** (ElevenLabs Agents platform — provider-hosted conversational agent):
- `createAgentsClient(AgentsClientParameters)` → `Promise<AgentsClient>`.
- `AgentsClientParameters`: `agentId` (required), `xiApiKey` (required — API key), `baseUrl?`, `includeConversationId?` (default false; if true, response includes `conversation_id` and the conversation_signature becomes single-use), `onWebSocketClose?`, `privacy?`, `statistics?`, `trace?`.
- Methods beyond the common set: `clientToolResult(Object)` (answer a ClientToolCall), `contextualUpdate(Object)` (non-interrupting background info), `conversationInitiationClientData(Object)` (per-conversation overrides at start), `userMessage(Object)` (inject user text).
- `AgentsEvents` (15): `ConversationInitiationMetadata` (auto on start), `UserTranscript` (final STT of user), `AgentResponse` (full agent message, sent with first audio chunk), `AgentResponseCorrection` (truncated text after interruption), `InternalTentativeAgentResponse` (preliminary text), `Interruption` (id of interrupted event), `ClientToolCall` (agent asks client to run a function: tool name + call id + params → must reply via `clientToolResult`), `AgentToolResponse` (agent executed its own tool), `ContextualUpdate`, `VadScore` (0..1 speech probability), `Ping` (health check requiring immediate response), `HTTPResponse`, `WebSocketError`, `Unknown`, `ConnectorInformation`.

**RealtimeTTSPlayer** (streaming input TTS over ElevenLabs `stream-input` WS API):
- `createRealtimeTTSPlayer(text, parameters?)` → player. Internally calls 11labs `initializeConnection`.
- Methods: `append(text, endOfTurn?)` — appends text; `endOfTurn:true` forces generation of a trailing chunk shorter than `chunk_length_schedule` while keeping the WS open. **GOTCHA: `PlayerEvents.PlaybackFinished` is triggered ONLY if `append` is called.** `sendText(Object)` — raw passthrough to provider `sendText`. `clearBuffer`, plus standard player controls.
- `RealtimeTTSPlayerParameters`: `queryParameters` (required — raw ElevenLabs query params: `model_id`, `output_format`, etc.), `pathParameters?` (e.g. `voice_id`), `initializeConnectionParameters?` (raw; **must NOT contain `text`, `xi-api-key`, `authorization`**), `headers?: RealtimeTTSPlayerHeader[]`, `keepAlive?` (default **true** — keeps WS alive past timeout), `privacy?`, `statistics?`, `trace?`.
- `RealtimeTTSPlayerHeader`: `{ name: 'xi-api-key', value: string }` — the documented way to use **your own ElevenLabs API key** (BYO account) for the TTS player.

## Google (FOCUS) — 4 pages

Only a **RealtimeTTSPlayer** exists under this namespace (no agent client; Google ASR/STT lives elsewhere in the VoxEngine reference, outside this group).
- `createRealtimeTTSPlayer(parameters?)` → player (no initial text argument).
- `RealtimeTTSPlayerParameters`: `language_code` (required, BCP-47, examples "en-US", "de-DE", "fr-FR", "ru-RU"), `voice` (required — voice name; example voices **"Aoede", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Zephyr"** — i.e. Gemini/Chirp3-HD-style voices), `keepAlive?` (default **true**), `trace?`. (No `privacy`/`statistics` props documented on this one.)
- Methods: standard player set + `send(Object)` — passthrough to the Google streaming context, documented against `google.cloud.texttospeech.v1.SynthesisInput` (i.e. you stream text pieces via `send`).
- No SSML mention anywhere; input maps to SynthesisInput of the streaming TTS RPC.

## Silero (FOCUS) — 5 pages

Server-side **VAD** (voice activity detection) as a WS-backed unit:
- `createVAD(VADParameters)` → `Promise<VAD>`.
- `VADParameters`: `threshold?` (speech probability threshold, default **0.5**), `minSilenceDurationMs?` (silence to wait before separating a speech segment, default **300**), `speechPadMs?` (padding added to segments to avoid aggressive cutting, default **0**), `privacy?`, `statistics?`, `trace?`.
- `VAD` methods: `addEventListener`/`removeEventListener` (VADEvents), `reset()` (reset context), `close()`, `id()`, `webSocketId()`. (Audio is routed to it as a media unit; the class itself exposes no sendMediaTo — you send call → VAD.)
- `VADEvents`: `Result` — `{ vad, speechStartAt?: number (sec), speechEndAt?: number (sec) }`; `Reset`; `Error { reason }`; `ConnectorInformation`.

## Pipecat — 5 pages

**TurnDetector** — end-of-turn prediction model (Pipecat smart-turn):
- `createTurnDetector(TurnDetectorParameters)` → `Promise<TurnDetector>`.
- `TurnDetectorParameters`: `threshold?` (end-of-turn probability threshold, default **0.5**), `maxDurationSecs?` (max segment, default **8**), `preSpeechMs?` (audio included before speech start, default **0**), `privacy?`, `statistics?`, `trace?`.
- Methods: `predict()` — triggers analysis of current audio; result arrives in `TurnEvents.Result`; `reset()`, `close()`, `id()`, `webSocketId()`, add/removeEventListener.
- `TurnEvents`: `Result { endOfTurn: boolean, probability: number [0..1], turnDetector }`, `Reset`, `Error { reason }`, `ConnectorInformation`.

## Deepgram — 6 pages

**VoiceAgentClient** — Deepgram Voice Agent API (full agent: listen+think+speak):
- `createVoiceAgentClient(VoiceAgentClientParameters)` → Promise.
- `VoiceAgentClientParameters`: `apiKey?` OR `accessToken?` (**short-lived token, documented as the more secure option**), `settingsOptions?` (raw AgentV1Settings object — models, prompt, voice, language all live here), `onWebSocketClose?`, `privacy?`, `statistics?`, `trace?`.
- Methods: `sendFunctionCallResponse(Object)`, `sendInjectAgentMessage(Object)` (force agent utterance), `sendInjectUserMessage(Object)` (text as user), `sendUpdatePrompt(Object)` (live system-prompt update), `sendUpdateSpeak(Object)` (swap TTS voice mid-call), + common set.
- `VoiceAgentEvents` (17): `Welcome`, `SettingsApplied`, `ConversationText` (both sides' utterances), `AgentThinking`, `AgentAudioDone`, `UserStartedSpeaking`, `FunctionCallRequest`, `FunctionCallResponse`, `PromptUpdated`, `SpeakUpdated`, `History` (seed conversation/function history at session start), `Warning`, `Error`, `HTTPResponse`, `WebSocketError`, `Unknown`, `ConnectorInformation`. (Doc bug: `HTTPResponse`/`WebSocketError` descriptions mention the ElevenLabs/Cartesia client — copy-paste artifact.)

## Cartesia — 9 pages

**AgentsClient** — Cartesia Line agents (web-calls protocol):
- `AgentsClientParameters`: `agentId`, `apiKey` (used to generate an access token), `cartesiaVersion` (API version string; all three required), `onWebSocketClose?`, `privacy?`, `statistics?`, `trace?`.
- Methods: `start(Object)` (initialize audio stream config), `custom(Object)` (custom metadata to agent), `dtmf(Object)` (send DTMF), + common set.
- `AgentsEvents`: `ACK` (server confirms stream config), `Clear` (agent wants current audio interrupted/cleared), `Custom`, `DTMF` (agent sends tones), `ConnectorInformation`, `HTTPResponse`, `WebSocketError`, `Unknown`.

**RealtimeTTSPlayer** — Cartesia TTS WS API (version 2024-11-13):
- `createRealtimeTTSPlayer(text, parameters?)`. Params: `apiKey?` (BYO Cartesia account), `generationRequestParameters?` (raw Generation Request message), `privacy?`, `statistics?`, `trace?`.
- Methods: `generationRequest(Object)` (append transcript for synthesis), `cancelContextRequest(Object)` (stop generating for a context), `clearBuffer`, standard player set.

## Inworld — 9 pages

**RealtimeAPIClient** — OpenAI-Realtime-style session protocol:
- `RealtimeAPIClientParameters`: `apiKey` (required), `sessionKey` (required), `authScheme?` (`basic`|`bearer`, default **bearer**), `onWebSocketClose?`, `privacy?`, `statistics?`, `trace?`.
- Methods mirror OpenAI Realtime client messages: `sessionUpdate`, `conversationItemCreate/Delete/Retrieve/Truncate`, `inputAudioBufferAppend/Commit/Clear`, `outputAudioBufferClear` (stop playback), `responseCreate` / `responseCancel`, + common set.
- `RealtimeAPIEvents` (30): `SessionCreated` (immediately on WS open, carries default session config), `SessionUpdated`, `ConversationItemAdded/Done/Deleted/Retrieved/Truncated`, `ConversationItemInputAudioTranscriptionDelta/Completed` (user STT streaming/final), `InputAudioBufferSpeechStarted/Stopped` (**server-side VAD**), `InputAudioBufferCommitted/Cleared/TimeoutTriggered`, `OutputAudioBufferStarted/Stopped/Cleared`, `ResponseCreated/Done`, `ResponseOutputItemAdded/Done`, `ResponseContentPartAdded/Done`, `ResponseOutputTextDelta/Done`, `ResponseOutputAudioTranscriptDelta/Done`, `ResponseOutputAudioDone`, `ResponseFunctionCallArgumentsDelta/Done`, `RateLimitsUpdated`, `Error`, `HTTPResponse`, `WebSocketError`, `Unknown`, `ConnectorInformation`.

**RealtimeTTSPlayer** — Inworld TTS WS: `createRealtimeTTSPlayer(parameters?)`; params `apiKey?` (BYO), `createContextParameters?` (raw Create Context message), `privacy/statistics/trace`. Methods: `send(Object)` (passthrough to provider context) + standard player set.

## Ultravox — 7 pages

**WebSocketAPIClient** — Ultravox speech-to-speech agent; the connector ITSELF makes the HTTP call that creates the Ultravox Call, then joins over WS:
- `WebSocketAPIClientParameters`: `endpoint: HTTPEndpoint` (required — enum `CREATE_CALL`, `CREATE_AGENT_CALL`, `JOIN_CALL`), `body?`, `queryParameters?`, `pathParameters?`, `authorizations?` (all raw passthrough per chosen endpoint), `joinUrl?` (alternative: URL from your own `calls`/`agents-calls` POST — **that call must be created with `medium: serverWebSocket`**), `onWebSocketClose?`, `privacy?`, `statistics?`, `trace?`. HTTP response of the endpoint invocation surfaces in `WebSocketAPIEvents.HTTPResponse`.
- Methods: `hangUp(Object)` (**agent ends the call, optional farewell message**), `forcedAgentMessage(Object)`, `userTextMessage(Object)` (text treated as user speech), `inputTextMessage(Object)`, `setOutputMedium(Object)` (text|voice), `clientToolResult(Object)` / `dataConnectionToolResult(Object)`, + common set.
- `WebSocketAPIEvents`: `Transcript` (utterance text for the call), `State` (server state), `ClientToolInvocation` / `DataConnectionToolInvocation` (server asks client to run a tool), `PlaybackClearBuffer` (clear buffered output audio; WS only), `Debug`, `HTTPResponse`, `WebSocketError`, `Unknown`, `ConnectorInformation`.

---

## KALFA relevance (synthesis)

- **ElevenLabs streaming TTS is a drop-in upgrade path for `call.say()`**: `ElevenLabs.createRealtimeTTSPlayer(text, {pathParameters:{voice_id}, queryParameters:{model_id, output_format}, headers:[{name:'xi-api-key', value:KEY}]})` + `append()` — token-by-token feeding from the Groq bridge; serve the xi-api-key via the ctx endpoint (Groq-key precedent), never in the 200-byte `script_custom_data`. Hebrew via `eleven_v3`/multilingual models. GOTCHA: `PlaybackFinished` fires only if `append()` was called — the existing terminal-hangup-on-PlaybackFinished + duration fallback logic must account for it.
- **Google.RealtimeTTSPlayer** = streaming variant of the current Google TTS; `language_code:'he-IL'` is a valid BCP-47 tag but the documented example voices are Gemini-style (Aoede/Puck/…) — verify he-IL availability against Google's live voice list before committing. No SSML surface (consistent with the live-verified "say() reads SSML literally" finding — niqqud strategy stays).
- **Silero VAD + Pipecat TurnDetector** directly address barge-in and end-of-turn for the bring-your-own-LLM (Groq) pipeline: VAD `Result {speechStartAt/speechEndAt}` (threshold 0.5 / minSilence 300ms defaults) for fast interruption; TurnDetector `predict()` → `{endOfTurn, probability}` beats fixed silence timeouts for natural Hebrew turn-taking. Both are cheap WS units created in-scenario.
- **Ultravox/Deepgram/ElevenLabs Agents are whole-stack alternatives** to KALFA's ASR+Groq+TTS chain: agent tool-calls (`ClientToolCall`→`clientToolResult`, `FunctionCallRequest`→`sendFunctionCallResponse`, `ClientToolInvocation`→`clientToolResult`) can invoke KALFA's ctx/cb HTTP endpoints for save_rsvp/mark_dnc/notify_owner. Ultravox `hangUp` (farewell) and `Transcript` events map cleanly onto KALFA's terminal-hangup and transcript-logging needs; Hebrew quality per provider must be validated separately.
- **`privacy:true` on every client/player disables WS logging** — matches KALFA's no-PII-in-logs rule for guest names/phones spoken in-call; `trace:true` conversely uploads full plaintext WS traffic to S3 (never enable in production).
- **Deepgram `accessToken`** (short-lived, preferred over apiKey) is the one connector with documented ephemeral auth — a pattern to prefer wherever supported, given the script_custom_data cap and no-secrets-in-scenario constraint.
- `WebSocketMediaEnded` fires only after **1s of trailing silence** — latency floor to account for in any "agent finished speaking → act" logic; `clearMediaBuffer` + provider clear/interrupt events are the barge-in primitives.
- These namespaces contain **no pricing/limits pages**; per-reached-contact billing interacts only via call duration effects (silence detection latency, keepAlive default true on TTS players).

---

## INVENTORY (all 55 pages in scope; every one fetched)

### Cartesia (9)
1. Cartesia (ref_folder) — references.voxengine.cartesia
2. AgentsEvents (events) — .cartesia.agentsevents
3. Events (events) — .cartesia.events
4. AgentsClient (class) — .cartesia.agentsclient
5. RealtimeTTSPlayer (class) — .cartesia.realtimettsplayer
6. AgentsClientParameters (interface) — .cartesia.agentsclientparameters
7. RealtimeTTSPlayerParameters (interface) — .cartesia.realtimettsplayerparameters
8. createAgentsClient (function) — .cartesia.createagentsclient
9. createRealtimeTTSPlayer (function) — .cartesia.createrealtimettsplayer

### Deepgram (6)
10. Deepgram (ref_folder) — references.voxengine.deepgram
11. Events (events) — .deepgram.events
12. VoiceAgentEvents (events) — .deepgram.voiceagentevents
13. VoiceAgentClient (class) — .deepgram.voiceagentclient
14. VoiceAgentClientParameters (interface) — .deepgram.voiceagentclientparameters
15. createVoiceAgentClient (function) — .deepgram.createvoiceagentclient

### ElevenLabs (10)
16. ElevenLabs (ref_folder) — references.voxengine.elevenlabs
17. AgentsEvents (events) — .elevenlabs.agentsevents
18. Events (events) — .elevenlabs.events
19. AgentsClient (class) — .elevenlabs.agentsclient
20. RealtimeTTSPlayer (class) — .elevenlabs.realtimettsplayer
21. AgentsClientParameters (interface) — .elevenlabs.agentsclientparameters
22. RealtimeTTSPlayerHeader (interface) — .elevenlabs.realtimettsplayerheader
23. RealtimeTTSPlayerParameters (interface) — .elevenlabs.realtimettsplayerparameters
24. createAgentsClient (function) — .elevenlabs.createagentsclient
25. createRealtimeTTSPlayer (function) — .elevenlabs.createrealtimettsplayer

### Google (4)
26. Google (ref_folder) — references.voxengine.google
27. RealtimeTTSPlayer (class) — .google.realtimettsplayer
28. RealtimeTTSPlayerParameters (interface) — .google.realtimettsplayerparameters
29. createRealtimeTTSPlayer (function) — .google.createrealtimettsplayer

### Inworld (9)
30. Inworld (ref_folder) — references.voxengine.inworld
31. Events (events) — .inworld.events
32. RealtimeAPIEvents (events) — .inworld.realtimeapievents
33. RealtimeAPIClient (class) — .inworld.realtimeapiclient
34. RealtimeTTSPlayer (class) — .inworld.realtimettsplayer
35. RealtimeAPIClientParameters (interface) — .inworld.realtimeapiclientparameters
36. RealtimeTTSPlayerParameters (interface) — .inworld.realtimettsplayerparameters
37. createRealtimeAPIClient (function) — .inworld.createrealtimeapiclient
38. createRealtimeTTSPlayer (function) — .inworld.createrealtimettsplayer

### Pipecat (5)
39. Pipecat (ref_folder) — references.voxengine.pipecat
40. TurnEvents (events) — .pipecat.turnevents
41. TurnDetector (class) — .pipecat.turndetector
42. TurnDetectorParameters (interface) — .pipecat.turndetectorparameters
43. createTurnDetector (function) — .pipecat.createturndetector

### Silero (5)
44. Silero (ref_folder) — references.voxengine.silero
45. VADEvents (events) — .silero.vadevents
46. VAD (class) — .silero.vad
47. VADParameters (interface) — .silero.vadparameters
48. createVAD (function) — .silero.createvad

### Ultravox (7)
49. Ultravox (ref_folder) — references.voxengine.ultravox
50. Events (events) — .ultravox.events
51. WebSocketAPIEvents (events) — .ultravox.websocketapievents
52. WebSocketAPIClient (class) — .ultravox.websocketapiclient
53. WebSocketAPIClientParameters (interface) — .ultravox.websocketapiclientparameters
54. createWebSocketAPIClient (function) — .ultravox.createwebsocketapiclient
55. HTTPEndpoint (enum) — .ultravox.httpendpoint
