# Voximplant docs research notes — group vox-ref-ai-core

Scope: `references.voxengine.ai`, `.ccai`, `.openai` (incl. `.openai.beta`), `.gemini`, `.grok` — 70 pages per manifest `references_voxengine.txt`. All 70 fetched via `https://voximplant.com/api/v2/getDoc?fqdn=...` on 2026-07-19. Public URL pattern: `https://voximplant.com/docs/` + fqdn with dots→slashes (e.g. `references/voxengine/openai/realtimeapiclient`).

NOTE: plan mode was active in this session; the notes were written to this plan file instead of the requested `scratchpad/vox-research/vox-ref-ai-core.md` (file writes outside this path were not permitted). No raw dump files were created; all page content passed through stdout.

---

## 0. Cross-cutting patterns (all AI connector modules)

Every modern LLM connector (OpenAI Realtime / ChatCompletions / Responses, Gemini LiveAPI, Grok VoiceAgent) follows one uniform shape:

- Factory: `Module.createXxxClient(parameters)` → `Promise<Client>` (async!). Legacy AI module's `createDialogflow` is synchronous and returns the instance directly.
- Client is a VoxMediaUnit peer: `client.sendMediaTo(mediaUnit, SendMediaParameters?)` / `client.stopMediaTo(mediaUnit)` wire audio to/from a Call (or via `VoxEngine.sendMediaBetween`). Text-only clients (ChatCompletions, Responses) have NO sendMediaTo/stopMediaTo — they are LLM-over-WebSocket text streams; audio I/O stays your job (ASR + TTS in the scenario).
- `addEventListener(EventClass, callback)` / `removeEventListener(EventClass, callback?)`. GOTCHA (documented everywhere): passing anything that is not a function as a handler → error + scenario termination when the handler fires.
- `close()` closes the WebSocket (or the connection attempt). `id()`, `webSocketId()` getters.
- Realtime-style clients also have `clearMediaBuffer(ClearMediaBufferParameters?)` — flushes buffered outbound audio; this is the barge-in primitive.
- Common parameter flags on every client parameters interface:
  - `privacy` (default false): disables WebSocket logging entirely. PII lever.
  - `trace` (default false): uploads ALL sent/received WS messages in plain text to S3; URL appears in the `websocket.created` log message. Diagnostic only — full conversation content leaves the session.
  - `statistics`: enables statistics functionality.
  - `onWebSocketClose(event: WebSocketEvents.CLOSE)`: disconnect callback (Realtime-style clients).
- Common events: `WebSocketMediaStarted` (audio from provider starts playing; carries `encoding`, `customParameters`, `tag`) and `WebSocketMediaEnded` (fires after **1 second of silence** in the provider's audio stream; carries `WebSocketMediaInfo`, `tag`). `tag` lets one WS connection feed 2 different media units. `ConnectorInformation` (connector metadata) and `Unknown` (unmapped provider event) exist in every event namespace. Provider events are delivered as `{ client, data: { customEvent?, payload } }` — `payload` is the raw provider JSON, so the actual schema is the provider's (docs link out to OpenAI/xAI/Google references).

---

## 1. AI module (`Modules.AI`) — require(Modules.AI)

Folder: "The AI module provides additional methods that use Artificial Intelligence." Two functional areas: answering-machine detection and the (legacy, ES-era) Dialogflow connector.

### 1.1 detectVoicemail (FOCUS)
- `AI.detectVoicemail(call, parameters)` → `Promise<AI.Events>`; "Start a voicemail recognition session. You can check how many times voicemail was detected in the call history."
- `DetectVoicemailParameters`:
  - `model?: string` — possible values **'ru'**, **'colombia'**; default **'ru'**. (No Hebrew/Israel model.)
  - `threshold?: number` — "0.0 – 1.0 milliseconds range" (doc bug: it is a 0–1 fraction). Durations shorter → human speech; longer → voicemail. Default **0.8**. "Available only with the **latam** model" — note docs inconsistency 'colombia' vs 'latam'.
- Resolution events (in AI.Events):
  - `VoicemailDetected` — params: `call`, `confidence` (**0–100**; "not guaranteed to be accurate, consider it while handling the event").
  - `VoicemailNotDetected` — params: `call`.
- No explicit error event for detection exists in this event namespace (only Dialogflow* events + the two Voicemail* events).

### 1.2 Dialogflow ES connector (legacy)
- `AI.createDialogflow(DialogflowSettings)` → `DialogflowInstance` (synchronous return).
- `DialogflowSettings`: `agentId` (number — certificate previously uploaded in the Voximplant control panel, "Dialogflow Connector" section; optional if only one cert), `lang` (DialogflowLanguage), `beta` (v2beta1 by default; set false for plain v2), `region`, `environmentId` (default 'draft'), `sessionId`/`userId` (session naming), `model`/`modelVariant` (speech model), `phraseHints`, `singleUtterance`, `outputAudioConfig`, `queryParameters`.
- `DialogflowInstance` methods: `sendQuery(DialogflowQueryInput)` — text **≤256 characters** or event input; `setQueryParameters`, `setPhraseHints`, `setOutputAudioConfig`, `addMarker(offsetMs)` (± offset from start/end → `DialogflowPlaybackMarkerReached`), `sendMediaTo`/`stopMediaTo`, `stop()`, `id()`, add/removeEventListener.
- Events: `DialogflowResponse` (intent response incl. `queryResult`, `recognitionResult`, `webhookStatus`), `DialogflowQueryResult`, `DialogflowRecognitionResult` (streaming ASR, `isFinal`), `DialogflowPlaybackStarted/Finished/MarkerReached`, `DialogflowStopped`, `DialogflowError`.
- Interfaces: `DialogflowResult` (action, fulfillmentText, fulfillmentMessages, intent, intentDetectionConfidence 0.0–1.0, parameters, queryText, languageCode, allRequiredParamsPresent, diagnosticInfo), `DialogflowStreamingRecognitionResult` (transcript, isFinal, confidence — only reliable when is_final), `DialogflowQueryParameters` (contexts, payload→webhook, resetContexts, sessionEntityTypes, timeZone, geoLocation), `DialogflowOutputAudioConfig`→`DialogflowSynthesizeSpeechConfig` (speakingRate 0.25–4.0, pitch ±20 semitones, volumeGainDb −96..+16 (≤ +10 recommended), effectsProfileId, voice→`DialogflowVoiceSelectionParameters` {name, ssmlGender}), `DialogflowTextInput` (text ≤256 **bytes**, languageCode), `DialogflowEventInput` (name, parameters, languageCode).

**KALFA relevance:** `detectVoicemail` is the platform's only AMD primitive — directly relevant to per-reached-contact billing (don't bill/complete on answering machines) — but only 'ru'/'colombia' models exist; behavior on Hebrew +972 voicemail greetings is unverified and confidence is explicitly unreliable → must live A/B before relying on it. Dialogflow connector itself is not relevant (Google ES agents, not KALFA's Groq/say() pipeline).

---

## 2. CCAI module (`CCAI` namespace) — Google Contact Center AI / Dialogflow conversations

Structure: `CCAI.Agent` (per Dialogflow agent; constructor `(agentId, region?)`), `CCAI.Conversation` (constructor `ConversationSettings {agent, profile: ConversationProfile, project}`), `CCAI.Participant` (created via `conversation.addParticipant(ParticipantSettings {call, dialogflowSettings, options})`).

- `Agent` methods: `getConversationProfile(request)` → `Promise<GetConversationProfileResult>`, `getProfilesList()` → `Promise<GetProfilesListResult>`, `updateConversationProfile(request)` → `Promise<UpdateConversationProfileResult>` (requests/responses are raw Dialogflow v2beta1 RPC payloads; results wrap `{id, name, response}` with names like 'AI.Events.CcaiGetConversationProfileResponse'), `destroy()`, `id()`.
- `Participant` methods: `analyzeContent(EventInput | TextInput)` (adds a message into Dialogflow CCAI; TextInput.text **≤256 characters**), `addPlaybackMarker(offset, playbackId?)`, `call()` → associated Call, `sendMediaTo`/`stopMediaTo`.
- `Conversation` methods: `addParticipant`, `removeParticipant`, add/removeEventListener.
- Events: `CCAI.Events.Agent` (Started/Stopped), `CCAI.Events.Conversation` (Created/Completed/Error/ProfileCreated), `CCAI.Events.Participant` (Created, Response — intent response, PlaybackReady — Google `audio_segments` ready, PlaybackStarted/Finished/Stopped, MarkerReached).
- Vendor interfaces mirror Google types: `ConversationProfile` (name `projects/<P>/conversationProfiles/<ID>`, display_name ≤1024 bytes), `Participant` (role, obfuscated_external_user_id — never raw user ids, UTF-8/hash, ≤256 chars; sip_recording_media_label; documents_metadata_filters), `TextInput` (text ≤256 chars, language_codes, enable_splitting_text), `EventInput` (name, parameters, language_code), enum `Role` {END_USER, AUTOMATED_AGENT, ROLE_UNSPECIFIED}.

**KALFA relevance:** none in practice — this is Google CCAI agent-assist tooling for contact centers; KALFA's stack (Groq LLM + say()) doesn't touch it. Only reusable idea: the obfuscated-user-id privacy rule matches KALFA's no-raw-PII principle.

---

## 3. OpenAI module (`OpenAI` namespace) — FOCUS

Four client families + Beta legacy namespace. All created via async `OpenAI.createXxx(parameters)`.

### 3.1 RealtimeAPIClient (GA) — speech-to-speech
- `createRealtimeAPIClient(RealtimeAPIClientParameters)` → `Promise<RealtimeAPIClient>`.
- Parameters: `apiKey` (required), `model?` default **`gpt-realtime`**, `baseUrl?` default **`https://api.openai.com/`** (→ OpenAI-compatible realtime endpoints possible), `type?: RealtimeAPIClientType` — enum **REALTIME** (default) | **TRANSCRIPTION** (transcription-only session!), plus common `privacy/trace/statistics/onWebSocketClose`.
- Methods (thin wrappers around Realtime client events, all take a raw `parameters` Object mirroring OpenAI's schema): `sessionUpdate`, `conversationItemCreate/Delete/Retrieve/Truncate`, `inputAudioBufferClear`, `inputAudioBufferCommit`, `responseCreate`, `responseCancel`; media: `sendMediaTo`/`stopMediaTo`/`clearMediaBuffer`; lifecycle: `close`, `id`, `webSocketId`.
- `RealtimeAPIEvents` (44): Session{Created,Updated}; ConversationItem{Added,Done,Deleted,Retrieved,Truncated}; input transcription {Completed,Delta,Failed,Segment}; InputAudioBuffer{Committed,Cleared,SpeechStarted,SpeechStopped,TimeoutTriggered}; Response{Created,Done}, output item/content-part add/done, OutputText{Delta,Done}, OutputAudioDone, OutputAudioTranscript{Delta,Done}, FunctionCallArguments{Delta,Done}; **MCP support**: MCPListTools{InProgress,Completed,Failed}, ResponseMCPCallArguments{Delta,Done}, ResponseMCPCall{InProgress,Completed,Failed}; RateLimitsUpdated; Error; HTTPResponse; WebSocketError; ConnectorInformation; Unknown. (Event names follow the NEW OpenAI GA naming, e.g. ResponseOutputAudioTranscriptDelta.)

### 3.2 OpenAI.Beta.RealtimeAPIClient (legacy)
- Same client shape but typed method signatures instead of raw objects: e.g. `conversationItemCreate(previousItemId, item, eventId?)`, `conversationItemTruncate(itemId, contentIndex, audioEndMs, eventId?)`, `responseCreate(response, eventId?)`, `sessionUpdate(session, eventId?)`. No `inputAudioBufferClear/Commit` methods.
- Parameters: `apiKey`, `model?` default **`gpt-4o-realtime-preview-2024-10-01`**, no `baseUrl`, no `type`.
- GOTCHA (documented twice): the **`input_audio_format` parameter is ignored** in sessionUpdate/responseCreate — Voximplant controls the audio format on the wire.
- Beta events use OLD naming (ResponseAudioTranscriptDelta, ConversationItemCreated, ConversationCreated…), 30 events, no MCP, no timeout-triggered, no transcription-segment.

### 3.3 ChatCompletionsAPIClient — text LLM streaming (bring-your-own-LLM)
- `createChatCompletionsAPIClient(ChatCompletionsAPIClientParameters)` → Promise<client>.
- Key method: `createChatCompletions(parameters)` — "Creates a model response for the given chat conversation… **You can use this API not only with OpenAI, but also with other OpenAI-compatible providers (configure the connector via baseUrl)**. Third-party providers often pass custom model settings through the `chat_template_kwargs` request parameter." No sendMediaTo — text only.
- Parameters: `apiKey`, `baseUrl?` ("for example, Azure"), `project?`, **`storeContext?` (default false)** — client keeps conversation context server-side in the connector, with automatic rolling summaries: `summaryModel?` default **gpt-4o**, `summaryPrompt?` (default prompt shipped in docs: maintains a running summary; previous summary auto-inserted), plus privacy/trace/statistics.
- `ChatCompletionsAPIEvents` (15): Chunk (raw streamed chat.completion chunk), Content, ContentDelta, ContentDone, FunctionToolCallArguments{Delta,Done}, Refusal{Delta,Done}, LogProbs{ContentDelta,ContentDone,RefusalDelta,RefusalDone}, ChatCompletionsAPIError, ConnectorInformation, Unknown.

### 3.4 ResponsesAPIClient — OpenAI Responses API streaming
- `createResponsesAPIClient(ResponsesAPIClientParameters)`; method `createResponses(parameters)`; parameters: `apiKey`, `baseUrl?`, `project?`, `storeContext?` (no summary props here), privacy/trace/statistics. Text-only (no sendMediaTo).
- `ResponsesAPIEvents` (~50): full Responses stream event surface — ResponseCreated/InProgress/Queued/Completed/Failed/Incomplete/Error; output item/content-part/text/refusal deltas; FunctionCallArguments{Delta,Done}; CustomToolCallInput{Delta,Done}; reasoning text + reasoning summary deltas; built-in tools: WebSearchCall{InProgress,Searching,Completed}, FileSearchCall{InProgress,Searching,Completed}, CodeInterpreterCall{InProgress,Interpreting,Completed,+CodeDelta/CodeDone}, ImageGenCall{InProgress,Generating,PartialImage,Completed}, MCP (ListTools + Call args/status); OutputTextAnnotationAdded; ResponsesAPIError; Unknown.

### 3.5 OpenAI.Events (module-level media events)
`WebSocketMediaStarted` / `WebSocketMediaEnded` — the `client` union in the docs nominally includes Realtime/Responses/ChatCompletions clients, but only RealtimeAPIClient has media methods; treat media events as Realtime-only in practice.

**KALFA relevance:** ChatCompletionsAPIClient + `baseUrl` is the documented, first-class replacement for KALFA's hand-rolled Groq bridge (Groq is OpenAI-compatible): streaming deltas + function-call args + optional connector-side context w/ auto-summary (summaryModel would default to gpt-4o — override or disable for Groq-only). The GA RealtimeAPIClient (gpt-realtime) is the candidate for a full Hebrew speech-to-speech agent (would replace say()+ASR entirely; barge-in = InputAudioBufferSpeechStarted + clearMediaBuffer); `type: TRANSCRIPTION` offers realtime STT inside the scenario. Prod hygiene: `privacy: true` (guest PII in transcripts), never `trace: true` in production (full WS content to S3).

---

## 4. Gemini module (`Gemini` namespace)

- `createLiveAPIClient(LiveAPIClientParameters)` → `Promise<LiveAPIClient>`; wraps **Google Gen AI Go SDK v1.61.0** (docs pin this exact version; payload semantics follow it).
- Parameters: `backend?: Backend` enum **GEMINI_API** (default; needs `apiKey`) | **VERTEX_AI** (needs `project` + `location` + `credentials` = Google credential-file CONTENT string); `model?` default **`gemini-2.0-flash-exp`**; `connectConfig?` = raw `LiveConnectConfig` passthrough (system instruction, tools, VAD etc. live here); `httpOptions?` (its `baseUrl` is ignored); privacy/trace/statistics/onWebSocketClose.
- Methods: `sendClientContent(input)`, `sendRealtimeInput(input)`, `sendToolResponse(input)` (each maps to the genai SDK Session methods), `sendMediaTo`/`stopMediaTo`/`clearMediaBuffer`, close/id/webSocketId, add/removeEventListener.
- `LiveAPIEvents`: `ServerContent` (LiveServerContent), `ToolCall` (execute function_calls, reply with matching ids via sendToolResponse), `ToolCallCancellation`, `ConnectorInformation`, `Unknown`. `Gemini.Events`: WebSocketMediaStarted/Ended (1-s silence rule).

**KALFA relevance:** a realtime speech-to-speech alternative with function calling; Vertex AI backend allows region pinning (data-residency angle). Default model is experimental (`-exp`) — pin an explicit model. Hebrew voice quality unverified.

## 5. Grok module (`Grok` namespace)

- `createVoiceAgentAPIClient(VoiceAgentAPIClientParameters)` → `Promise<VoiceAgentAPIClient>`; xAI Grok Voice Agent API (speech-to-speech).
- Parameters: **`xAIApiKey` (required)**; `model?` default **`grok-voice-fast-1.0`**; privacy/trace/statistics/onWebSocketClose. No baseUrl.
- Methods (OpenAI-Realtime-like): `sessionUpdate`, `conversationItemCreate`, `inputAudioBufferClear`, `responseCreate` (needed only for client-side VAD; server VAD auto-responds), `sendMediaTo`/`stopMediaTo`/`clearMediaBuffer`, close/id/webSocketId.
- `VoiceAgentAPIEvents` (19): ConversationCreated (first message), ConversationItemAdded, ConversationItemInputAudioTranscriptionCompleted, InputAudioBuffer{Cleared,Committed,SpeechStarted,SpeechStopped} (server VAD), Response{Created,Done}, ResponseContentPart{Added,Done}, ResponseOutputItem{Added,Done}, ResponseOutputAudio{Done,TranscriptDelta,TranscriptDone}, **ResponseFunctionCallArgumentsDone** (function calls with complete args), SessionUpdated, WebSocketError, ConnectorInformation, Unknown. Grok.Events: WebSocketMediaStarted/Ended.

**KALFA relevance:** third realtime speech-to-speech option; smallest config surface. Hebrew support of grok-voice-fast-1.0 unknown — verify before considering.

---

## Notable limits & gotchas (consolidated)

1. `detectVoicemail` models: only 'ru' / 'colombia'; `threshold` documented as "0.0–1.0 milliseconds" (unit is wrong — it's a fraction) and "only with the **latam** model" (name mismatch vs 'colombia'); confidence 0–100 explicitly not guaranteed accurate.
2. Non-function event handler → error + scenario termination (every module repeats this).
3. `WebSocketMediaEnded` = 1 second of provider-audio silence; don't treat as turn-end signal for VAD purposes.
4. `trace: true` uploads the full plaintext WS exchange to S3 (link in `websocket.created`); `privacy: true` disables WS logging. Mutually relevant for PII.
5. OpenAI Beta client ignores `input_audio_format`; GA client methods take raw OpenAI JSON objects (no client-side validation).
6. GA vs Beta OpenAI event names differ (OutputAudioTranscriptDelta vs AudioTranscriptDelta etc.) — don't mix namespaces.
7. Dialogflow text inputs capped at 256 chars/bytes; CCAI TextInput 256 chars.
8. Gemini pinned to genai Go SDK v1.61.0; `httpOptions.baseUrl` ignored; default model is experimental.
9. ChatCompletions `storeContext` summarization defaults to OpenAI `gpt-4o` even when your `baseUrl` points elsewhere — set `summaryModel` explicitly (cost/provider surprise).
10. Text clients (ChatCompletions/Responses) have no media methods — pair with scenario ASR + `call.say()`.
11. All createXxx factories (except createDialogflow) return Promises — must await before wiring media.
12. This scope contains no ElevenLabs pages (ElevenLabs lives elsewhere in the docs tree).

---

## INVENTORY (all 70 in-scope pages; ✔ = fetched individually)

AI (17):
1. ✔ AI (ref_folder)
2. ✔ Events (events) — Dialogflow* + VoicemailDetected/VoicemailNotDetected
3. ✔ DialogflowInstance (class)
4. ✔ DetectVoicemailParameters (interface)
5. ✔ DialogflowEventInput (interface)
6. ✔ DialogflowOutputAudioConfig (interface)
7. ✔ DialogflowQueryInput (interface)
8. ✔ DialogflowQueryParameters (interface)
9. ✔ DialogflowResponse (interface)
10. ✔ DialogflowResult (interface)
11. ✔ DialogflowSettings (interface)
12. ✔ DialogflowStreamingRecognitionResult (interface)
13. ✔ DialogflowSynthesizeSpeechConfig (interface)
14. ✔ DialogflowTextInput (interface)
15. ✔ DialogflowVoiceSelectionParameters (interface)
16. ✔ createDialogflow (function)
17. ✔ detectVoicemail (function)

CCAI (19):
18. ✔ CCAI (ref_folder)
19. ✔ Events (ref_folder)
20. ✔ Events.Agent (events)
21. ✔ Events.Conversation (events)
22. ✔ Events.Participant (events)
23. ✔ Vendor (ref_folder)
24. ✔ Vendor.ConversationProfile (interface)
25. ✔ Vendor.EventInput (interface)
26. ✔ Vendor.Participant (interface)
27. ✔ Vendor.TextInput (interface)
28. ✔ Vendor.Role (enum)
29. ✔ Agent (class)
30. ✔ Conversation (class)
31. ✔ Participant (class)
32. ✔ ConversationSettings (interface)
33. ✔ GetConversationProfileResult (interface)
34. ✔ GetProfilesListResult (interface)
35. ✔ ParticipantSettings (interface)
36. ✔ UpdateConversationProfileResult (interface)

Gemini (7):
37. ✔ Gemini (ref_folder)
38. ✔ Events (events)
39. ✔ LiveAPIEvents (events)
40. ✔ LiveAPIClient (class)
41. ✔ LiveAPIClientParameters (interface)
42. ✔ createLiveAPIClient (function)
43. ✔ Backend (enum)

Grok (6):
44. ✔ Grok (ref_folder)
45. ✔ Events (events)
46. ✔ VoiceAgentAPIEvents (events)
47. ✔ VoiceAgentAPIClient (class)
48. ✔ VoiceAgentAPIClientParameters (interface)
49. ✔ createVoiceAgentAPIClient (function)

OpenAI (21):
50. ✔ OpenAI (ref_folder)
51. ✔ ChatCompletionsAPIEvents (events)
52. ✔ Events (events)
53. ✔ RealtimeAPIEvents (events)
54. ✔ ResponsesAPIEvents (events)
55. ✔ Beta (ref_folder)
56. ✔ Beta.Events (events)
57. ✔ Beta.RealtimeAPIEvents (events)
58. ✔ Beta.RealtimeAPIClient (class)
59. ✔ Beta.RealtimeAPIClientParameters (interface)
60. ✔ Beta.createRealtimeAPIClient (function)
61. ✔ ChatCompletionsAPIClient (class)
62. ✔ RealtimeAPIClient (class)
63. ✔ ResponsesAPIClient (class)
64. ✔ ChatCompletionsAPIClientParameters (interface)
65. ✔ RealtimeAPIClientParameters (interface)
66. ✔ ResponsesAPIClientParameters (interface)
67. ✔ createChatCompletionsAPIClient (function)
68. ✔ createRealtimeAPIClient (function)
69. ✔ createResponsesAPIClient (function)
70. ✔ RealtimeAPIClientType (enum)
