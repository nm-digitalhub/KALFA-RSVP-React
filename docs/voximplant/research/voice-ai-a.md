# Voximplant Docs Research — Group voice-ai-a

Scope: `voice-ai` (root), `voice-ai.getting-started`, `voice-ai.bring-your-own-llm`, everything under `voice-ai.openai`, `voice-ai.google`, `voice-ai.ultravox`.
Depth: DEEP — every page fetched in full via `https://voximplant.com/api/v2/getDoc?fqdn=<fqdn>` (verified byte lengths vs. captured output; nothing truncated).
Note: written to this plan file because the session is in plan mode (only writable path); the orchestrator's intended path template was unresolved (`undefined/vox-research/voice-ai-a.md`).

---

## 1. Voice AI (root) — `voice-ai`

- **Docs migration in progress**: a new dedicated Voice AI documentation site exists at **docs.voximplant.ai**; current voximplant.com/docs Voice AI section "updates regularly and will be available here for some time" but the new site is the direction of travel (may still be missing content).
- Positions Voximplant as an **AI orchestration platform**:
  - **AI partners**: OpenAI (ChatGPT), Google Gemini & Vertex AI, xAI, Ultravox, Deepgram, "and more" (manifest also lists ElevenLabs, Yandex, Cartesia, Inworld — outside this group's scope).
  - **TTS**: ElevenLabs, Cartesia, Inworld and others ("Realistic voices").
  - **ASR**: Deepgram, Google, Microsoft "and many more".
  - **Orchestration features**: Bring your own LLM; VAD + turn detection ("natural conversation flow"); AI-in-IVR/contact-center integration.
- KALFA relevance: confirms the strategic split — provider connectors (managed) vs. bring-your-own-LLM (KALFA's current Groq path). Check docs.voximplant.ai for newer material not yet in this tree.

## 2. Getting started — `voice-ai.getting-started`

- Standard platform onboarding recap: create **application** → create **scenarios** (JS documents, online IDE) → create **routing rules**.
- Routing rule mechanics: **Pattern** field is a regex matched against `e.destination`; rules evaluated top-to-bottom, **first match wins**, one rule executes per call. Example patterns: `.*`, `+?[1-9]\d{1,14}`, `123.+`.
- **Multiple scenarios can be attached to one rule — they execute sequentially within a single context**, enabling code reuse (shared function libraries as separate scenarios).
- Gotcha: **Video conference** switch must be enabled for conference scenarios or all video conferences fail; (SIP page adds: with it enabled, SDK/softphone calls are billed as video conferences).
- KALFA relevance: KALFA already has this wired (StartScenarios + rule); the multi-scenario-per-rule trick is a clean way to share a Hebrew-prompt/util library across scenarios without duplication.

## 3. Bring your own LLM — `voice-ai.bring-your-own-llm` (FOCUS)

**Architecture**: your text LLM keeps context/reasoning/business logic; Voximplant supplies the voice layer:
1. **ASR** — multiple providers/languages (`/docs/guides/speech/asr`), pick per language/latency/quality/pricing.
2. **VAD + turn detection** — **Silero VAD** (speech vs silence/noise) + **Pipecat Turn Detection** (mid-sentence pause vs true end-of-turn) (`/docs/guides/speech/vad-turn-detection`). Together they reduce interruptions and dead-air delays.
3. **TTS** — multiple providers/voices (`/docs/speech/tts`).

**Key fact for KALFA**: the example connects to a **custom OpenAI-compatible backend** via the **`baseUrl`** parameter of the OpenAI connector (docs link: `references/voxengine/openai/chatcompletionsapiclientparameters#baseurl` — the param exists on the Chat Completions client parameters too). Example uses an Azure OpenAI resource URL; **Groq's OpenAI-compatible endpoint fits the same slot**, i.e. KALFA could replace its hand-rolled Groq HTTP bridge with the native `Modules.OpenAI` connector.

**Full example essence** (OpenAI Responses API client + Inworld realtime TTS + Google ASR + Silero + Pipecat):
- `require(Modules.OpenAI / Inworld / ASR / Silero / Pipecat)`.
- Config: `tts:{modelId:'inworld-tts-1.5-max', voiceId:'Alex'}`, `vad:{threshold:0.5, minSilenceDurationMs:300, speechPadMs:10}`, `turn:{threshold:0.5}`, `ai:{model:'gpt-4o'}`.
- On `AppEvents.CallAlerting`: `call.answer()`; `Silero.createVAD(...)`, `Pipecat.createTurnDetector(...)`, `VoxEngine.createASR({profile: ASRProfileList.Google.en_US})`; pipe call audio to all three via `call.sendMediaTo(asr|vad|turn)`.
- AI client: `OpenAI.createResponsesAPIClient({ apiKey: VoxEngine.getSecretValue('azure_api_key'), baseUrl:'https://my-eastus2-openai-resource.openai.azure.com', storeContext:false })` — **secrets come from Voximplant secure storage (`VoxEngine.getSecretValue`)**, not hardcoded and not in HTTP callbacks.
- Turn-taking logic: `Silero.VADEvents.Result` → `e.speechStartAt` = barge-in → stop TTS; `e.speechEndAt` → `turn.predict()`. `Pipecat.TurnEvents.Result` → if `e.endOfTurn && e.probability > threshold` mark turn confirmed; when both turn-confirmed AND `ASREvents.Result` text present → `sendAI(text)` (order-independent, both directions handled).
- LLM call: `ai.createResponses({model, input:text})`; greeting bootstrapped by `sendAI('Hello!')`.
- Streaming TTS: `ResponsesAPIEvents.ResponseTextDelta` → append delta to sentence buffer; flush to TTS when delta matches `[.!?\n]` or buffer > 40 chars. `ResponseTextDone` → flush remainder. TTS = `Inworld.createRealtimeTTSPlayer({createContextParameters:{create:{modelId,voiceId}}})`, `tts.sendMediaTo(call)`, text sent via `tts.send({send_text:{text, flush_context:{}}})`.
- Interrupt: `tts.stop()` + discard player instance; cleanup closes ai/vad/turn and `VoxEngine.terminate()` on Disconnected/Failed.

KALFA relevance: this is a straight blueprint for replacing the current Groq-over-HTTP + `call.say()` batch-TTS flow with streaming (delta→sentence→realtime-TTS) + proper barge-in. Open question to verify for Hebrew: ASR profile availability (`ASRProfileList.*` he-IL) and Pipecat turn-detection language coverage.

## 4. OpenAI folder — `voice-ai.openai`

Marketing/intro only: OpenAI features (ChatGPT, voice, LLMs) integrate into Voximplant apps for voice assistants, support automation, conversational interfaces. No API content.

## 5. OpenAI Realtime API Client — `voice-ai.openai.realtime-client` (FOCUS)

Speech-to-speech: any Voximplant call can be connected to an OpenAI agent via the **`RealtimeAPIClient`** class.

- **Create**: `OpenAI.createRealtimeAPIClient({ apiKey, model:'gpt-realtime', type: OpenAI.RealtimeAPIClientType.REALTIME | TRANSCRIPTION, onWebSocketClose })` (await; throws → catch and `VoxEngine.terminate()`).
- Model choice per OpenAI docs; "mini" much cheaper; **"The cost of the Voximplant's client does not depend on the chosen model."**
- **Session config** after `RealtimeAPIEvents.SessionCreated` via `sessionUpdate({session:{...}})`:
  - `type:'realtime'`, `instructions` (system prompt), `audio.output.voice` (e.g. 'cedar'), `audio.input.transcription:{model:'whisper-1', language:'en'}`,
  - `turn_detection:{type:'server_vad', create_response:true, interrupt_response:true, prefix_padding_ms:300, silence_duration_ms:200, threshold:0.5}`.
- **Agent speaks first**: `responseCreate({})` right after session update (essential for outbound confirmation calls).
- **Media wiring gotcha**: `realtimeAPIClient.sendMediaTo(call)` immediately, but call→client audio only after greeting finishes: on `OpenAI.Events.WebSocketMediaEnded` → `VoxEngine.sendMediaBetween(call, client)` (prevents the model hearing itself / user talking over greeting).
- **Interruptions**: `RealtimeAPIEvents.InputAudioBufferSpeechStarted` → `clearMediaBuffer()`.
- **Outbound**: identical, call created via `VoxEngine.callPSTN`, `callSIP`, or `callUser`.
- **3rd-party TTS mode** (keep realtime reasoning, replace OpenAI voices): `session.output_modalities:['text']`; stream `ResponseOutputTextDelta` → `Cartesia.createRealtimeTTSPlayer(delta, {generationRequestParameters:{model_id:'sonic-2', voice:{mode:'id',id}, language, context_id, continue:true}})`, subsequent deltas via `player.generationRequest({transcript: delta, context_id, continue:true})`; on `ResponseOutputTextDone` send a **flush request** (`{flush:true, continue:true}`); on `InputAudioBufferSpeechStarted` → `player.clearBuffer()`.
- **Function calling in-scenario** ("serverless" benefit — tools resolved right in VoxEngine): declare `tools:[{type:'function', name, description, parameters}]` + `tool_choice:'auto'` in sessionUpdate; detect on `RealtimeAPIEvents.ResponseDone`: `event.data.payload.response.output[0].type=='function_call'` + `.name`; then e.g. `call.stopMediaTo(client)` and forward to live agent; `responseCreate({})` to have the agent verbalize the action.
- **Transcription mode**: `type: TRANSCRIPTION`; `call.sendMediaTo(client)` one-way; sessionUpdate `{session:{type:'transcription', audio.input.transcription:{model:'gpt-4o-transcribe', language}}}`; events `ConversationItemInputAudioTranscriptionDelta` / `...Completed`.
- **Manual audio commit** (model `gpt-realtime-whisper` has **no server auto-commit/turn detection**): pair with Silero+Pipecat — VAD `speechEndAt` → `turnDetector.predict()`; on `TurnEvents.Result.endOfTurn===true` → `client.inputAudioBufferCommit()` + `client.responseCreate({response:{modalities:['text']}})`. Full example included with `Pipecat.TurnEvents.ConnectorInformation`, error listeners, defensive close in cleanup.

KALFA relevance: fastest path to a natural-latency Hebrew agent, but voice comes from OpenAI's fixed voice set unless the 3rd-party-TTS pattern is used (which would let KALFA keep Google he-IL / ElevenLabs voices while gaining realtime turn handling). Tools (`save_rsvp`, `mark_dnc`, `notify_owner`) map directly to the function-calling pattern with in-scenario execution — no ctx round-trip needed for tool resolution, only for persistence.

## 6. OpenAI Responses API Client — `voice-ai.openai.responses-client`

Text-only (no audio to OpenAI); the LLM leg of a bring-your-own-voice pipeline.

- **Create**: `OpenAI.createResponsesAPIClient({ apiKey, storeContext:false, onWebSocketClose })`. Doc quirk: the inline comment on `storeContext: false` reads "this enables memory in your conversation" — the multi-turn demo ("my name is John" → "What is my name?") relies on server-side context; treat `storeContext` semantics as needing empirical verification.
- **Call**: `client.createResponses({model:'gpt-4o', input:'...'})`; chain further `createResponses` calls on `ResponseCompleted` for multi-turn.
- **Error event**: `ResponsesAPIEvents.ResponsesAPIError`.
- **Event surface is huge (~50 events)** — streaming text (`ResponseTextDelta/Done`), audio transcript, reasoning (`ResponseReasoningTextDelta/Done`, summary variants), refusals, function calls (`ResponseFunctionCallArgumentsDelta/Done`), custom tool calls, plus built-in OpenAI tools: **web search**, **file search**, **code interpreter**, **image generation**, and **MCP** (`ResponseMCPCallArgumentsDelta/Done`, `ResponseMCPCallCompleted/Failed/InProgress`, `ResponseMCPListTools*`) and lifecycle (`ResponseCreated/InProgress/Queued/Completed/Failed/Incomplete`).
- KALFA relevance: this client + `baseUrl` is the documented bring-your-own-LLM vehicle. MCP-capable if pointed at OpenAI proper. For Groq, the Chat Completions client (below) is the more standard OpenAI-compatible surface.

## 7. OpenAI Chat Completions API Client — `voice-ai.openai.chat-completions-client`

- **Create**: `OpenAI.createChatCompletionsAPIClient({ apiKey, storeContext:false, onWebSocketClose })` (same `storeContext` comment quirk).
- **Call**: `client.createChatCompletions({model:'gpt-4o', messages:[{role:'developer'|'user'|'assistant', content}]})`.
- **Events** (`OpenAI.ChatCompletionsAPIEvents`): `ChatCompletionsAPIError`, `Chunk` (raw), `Content`, `ContentDelta`, `ContentDone`, `RefusalDelta/Done`, `FunctionToolCallArgumentsDelta/Done`, `LogProbsContentDelta/Done`, `LogProbsRefusalDelta/Done`.
- Multi-turn shown by issuing the next `createChatCompletions` from `ContentDone`.
- KALFA relevance: **closest match to Groq's API** (Groq speaks OpenAI Chat Completions). With `baseUrl` → Groq, KALFA gets: managed streaming deltas (feed the sentence-buffer→TTS pattern), function-call argument streaming for tools, and the API key held in Voximplant secrets instead of being served through the ctx endpoint (closes the key-in-transit concern from the Branch B work).

## 8. Google folder — `voice-ai.google`

Intro only: Gemini as LLM for chatbots, support automation, real-time transcription in Voximplant apps.

## 9. Gemini Developer API — `voice-ai.google.gemini`

- **ALERT**: article based on the **Google Preview API, which can be changed** (instability warning).
- `require(Modules.Gemini)`; **`Gemini.createLiveAPIClient({ apiKey, model, connectConfig, backend: Gemini.Backend.GEMINI_API, onWebSocketClose })`**; key from Google AI Studio; example model `gemini-3.1-flash-live-preview`.
- WebSocket realtime client producing **audio and text transcriptions**; wire with `VoxEngine.sendMediaBetween(call, client)`.
- `connectConfig`: `responseModalities:['AUDIO']`, `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (e.g. 'Aoede'), `systemInstruction.parts[{text}]`, `tools:[{functionDeclarations:[...]}]`.
- Kick off: `client.sendRealtimeInput({text:'Hi!'})`.
- **Events** (`Gemini.LiveAPIEvents`): `ServerContent` — check `event.data.payload.interrupted` → `clearMediaBuffer()` (barge-in); `ToolCall` — `event.data.payload.functionCalls[0].{name,id}` → `client.sendToolResponse({functionResponses:[{id, name, response:{output}}]})`; `SetupComplete`; `Unknown`; plus `Gemini.Events.WebSocketMediaStarted/Ended`.
- **Sessions TTL ALERT**: sessions auto-terminate at limits; connection lifetime limited; mitigate with **session resumption** and **context window compression** (link to Google live-session docs).
- KALFA relevance: Gemini Live has strong multilingual audio (Hebrew) and simple function calling; but preview-API churn + session TTL are operational risks for production RSVP campaigns.

## 10. Vertex AI — `voice-ai.google.vertex`

- Same `Modules.Gemini` / `createLiveAPIClient`, but **`backend: Gemini.Backend.VERTEX_AI`** plus **`project`**, **`location`**, **`credentials`** (stringified GCP service-account JSON) — enterprise-grade access (security/governance/MLOps) vs. consumer Gemini API. Example model `gemini-live-2.5-flash-native-audio`.
- Adds `toolConfig.functionCallingConfig:{mode:'ANY', allowedFunctionNames:[...]}` (forced tool use) to the same functionDeclarations pattern.
- Alternative send: `sendClientContent({turns:[{role:'user', parts:[{text}]}], turnComplete:true})` (vs `sendRealtimeInput`).
- Extra event: `LiveAPIEvents.ConnectorInformation`. Same Sessions-TTL alert.
- KALFA relevance: if Gemini is chosen, Vertex is the production-grade auth path (service account, region pinning — data-residency consideration for Israeli PII).

## 11. Ultravox folder — `voice-ai.ultravox`

- Ultravox = **multimodal LLM that ingests human speech directly (no separate ASR)** via a multimodal projector into the LLM's embedding space; trained on Llama 3, Mistral, Gemma; lower latency than ASR+LLM chains; currently **audio in → streaming text out** (future: speech tokens + vocoder); trainable against any open-weight model.

## 12. Ultravox WebSocket API Client — `voice-ai.ultravox.websocket-api-client`

- `require(Modules.Ultravox)`; **`Ultravox.createWebSocketAPIClient({ endpoint, authorizations, pathParameters, queryParameters, body, joinUrl, onWebSocketClose })`**; media via `VoxEngine.sendMediaBetween`.
- **3 connection modes** (`Ultravox.HTTPEndpoint`): `CREATE_CALL` (body: `{systemPrompt, model:'fixie-ai/ultravox', voice:'Mark'}`), `CREATE_AGENT_CALL` (pathParameters `{agent_id}`), `JOIN_CALL` (existing call's `joinUrl` wss URL). Auth header `{'X-API-Key': <key>}` (from `VoxEngine.getSecretValue`).
- **Hard requirement**: the Ultravox call must be created with `medium: serverWebSocket` and **`inputSampleRate`/`outputSampleRate` = 16000** or audio breaks.
- **Events** (`Ultravox.WebSocketAPIEvents`): `Unknown`, `HTTPResponse`, `State`, `Transcript`, `ClientToolInvocation`, `Debug`, `PlaybackClearBuffer` → must call `clearMediaBuffer()` (interruption handling is event-driven from Ultravox side).
- Text injection: `inputTextMessage({type:'input_text_message', text})` (agent-call example uses `userTextMessage`).
- **FAQ**: choppy/high-pitched audio → set `inputSampleRate` to 16000.
- KALFA relevance: single-vendor speech-native LLM alternative (no ASR/TTS assembly); Hebrew support on Ultravox models would need verification before it's a candidate.

## 13. Ultravox SIP trunking — `voice-ai.ultravox.sip`

Voximplant as a **gateway between an existing SIP PBX and Ultravox** (WS side managed by Voximplant, SIP side to your PBX).
- **Incoming**: PBX forwards to `sip:{number}@{app_name}.{account_name}.voximplant.com`; either whitelist the PBX's public IP (Control Panel → Security) or, for cloud PBX, create a **SIP registration** with PBX user credentials and attach it to the app + routing rule. Ready-made `incoming` scenario = the CREATE_CALL client from page 12.
- **Outgoing**: your backend calls **StartScenarios (Management API)**; scenario runs on `AppEvents.Started`, reads **`VoxEngine.customData()`** — JSON `{"callerid":"1650...","number":"1650..."}` — and dials `VoxEngine.callSIP('sip:<number>@YOUR_PBX_ADDRESS', callerid)`; on `CallEvents.Connected` it builds the Ultravox client. Routing-rule pattern is arbitrary for outbound (pattern only matters for incoming).
- PBX-side auth for Voximplant→PBX: whitelist Voximplant SIP IPs (list at `https://api.voximplant.com/getMediaResources?with_sbcs`) or pass credentials to `callSIP`.
- KALFA relevance: exact same StartScenarios + `customData` + `AppEvents.Started` + outbound-dial pattern KALFA's bridge uses (with PSTN instead of SIP); the ~200-byte `script_custom_data` cap applies to this `customData` JSON. The `getMediaResources?with_sbcs` endpoint is useful if IONOS firewall allowlisting ever needs Voximplant media/SIP IPs.

---

## Cross-cutting takeaways for KALFA

1. **Groq via native connector**: `Modules.OpenAI` clients accept `baseUrl` (documented on the Chat Completions client parameters; demonstrated with Azure in bring-your-own-llm). Groq's OpenAI-compatible endpoint should slot in → retire the hand-rolled fetch bridge, gain streaming events + function-call streaming.
2. **Secrets**: every example uses `VoxEngine.getSecretValue('<name>')` — the native answer to "keep the Groq key out of call history/ctx endpoint".
3. **Streaming TTS pattern**: delta → sentence buffer (flush on `[.!?\n]` or >40 chars) → realtime TTS player (Inworld/Cartesia shown; ElevenLabs exists as a sibling module) with flush-on-done and clear-on-barge-in. This is the upgrade path from batch `call.say()`.
4. **Barge-in stack**: Silero VAD (`speechStartAt`/`speechEndAt`) + Pipecat turn detector (`predict()` → `endOfTurn`+`probability`) is the documented pattern for both BYO-LLM and manual-commit OpenAI transcription.
5. **Greeting race**: with speech-to-speech clients, only start call→AI media after `WebSocketMediaEnded` of the greeting (or gate with a flag) — otherwise user speech collides with the opening line.
6. **Interrupt = clearMediaBuffer()**: uniform across OpenAI (`InputAudioBufferSpeechStarted`), Gemini (`ServerContent.interrupted`), Ultravox (`PlaybackClearBuffer`).
7. **Language**: every code sample is `en`/`en_US`; Hebrew feasibility rests on the ASR/TTS provider matrices in guides/speech (other research group) and per-model language support — nothing in this scope contradicts Hebrew, nothing confirms it.
8. **Voice AI docs are moving to docs.voximplant.ai** — recheck there before implementation decisions.

---

## INVENTORY (all pages in scope)

| fqdn | kind | title | fetched |
|---|---|---|---|
| voice-ai | tutorial | Voice AI | yes (full, incl. list items via raw JSON) |
| voice-ai.getting-started | tutorial | Getting started | yes |
| voice-ai.bring-your-own-llm | tutorial | Bring your own LLM | yes (full code example) |
| voice-ai.openai | folder | OpenAI | yes |
| voice-ai.openai.realtime-client | tutorial | Realtime API Client | yes (23.7 KB, 5 code examples) |
| voice-ai.openai.responses-client | tutorial | Responses API Client | yes |
| voice-ai.openai.chat-completions-client | tutorial | Chat Completions API Client | yes |
| voice-ai.google | folder | Google | yes |
| voice-ai.google.gemini | tutorial | Gemini Developer API | yes |
| voice-ai.google.vertex | tutorial | Vertex AI | yes |
| voice-ai.ultravox | folder | Ultravox | yes |
| voice-ai.ultravox.websocket-api-client | tutorial | WebSocket API Client | yes |
| voice-ai.ultravox.sip | tutorial | SIP trunking | yes (16.2 KB) |

Out-of-scope siblings enumerated in the same manifest (other groups): ElevenLabs (agents-client), Yandex (realtime-client), Deepgram (voice-agent-api-client), Cartesia (agents-api-client), xAI (grok), Inworld (realtime-api-client).
