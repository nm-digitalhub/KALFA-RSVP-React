# Voximplant docs research — group voice-ai-b

Scope: `voice-ai.elevenlabs`, `voice-ai.yandex`, `voice-ai.deepgram`, `voice-ai.cartesia`, `voice-ai.xai`, `voice-ai.inworld` (manifest `scratchpad/vox-manifests/voice-ai.txt`). Depth: DEEP — all 12 in-scope pages fetched via `https://voximplant.com/api/v2/getDoc?fqdn=...`.

NOTE ON LOCATION: the task asked for notes at `<base>/vox-research/voice-ai-b.md`, but plan mode was active for this session and permitted writing ONLY this plan file, so the notes live here. (The task's literal `undefined/` path prefix was an unsubstituted variable in the orchestrator; the real base is the session scratchpad.)

Extraction gotcha for the fleet: the provided `extract.js` prints empty code fences — tutorial source code lives in `content_source.examples[].source`, and alert text lives in `content_alert.title` + `content_alert.description` (not `.text`).

---

## Shared integration pattern (all six providers)

Every provider in this group is a VoxEngine "voice-AI connector" module with the identical lifecycle:

1. `require(Modules.<Provider>)` in the scenario.
2. `const client = await <Provider>.create<X>Client(params)` — an awaitable factory returning a WebSocket-backed media unit.
3. Full-duplex audio: `VoxEngine.sendMediaBetween(call, client)` (or `*.sendMedia` / `*.sendMediaTo`).
4. Business logic via `client.addEventListener(<Provider>.<X>Events.<Event>, handler)`.
5. Barge-in: on the provider's speech-started/interruption event call `client.clearMediaBuffer()` to cut off queued agent audio.
6. Cleanup: `CallEvents.Disconnected`/`CallEvents.Failed` → `client.close()` + `VoxEngine.terminate()`; every factory accepts an `onWebSocketClose` callback (terminate there too).
7. Secrets: examples use `VoxEngine.getSecretValue('<name>')` (platform secret storage) instead of hardcoding API keys (ElevenLabs/Yandex/Deepgram/Cartesia examples; Grok/Inworld examples hardcode placeholders).
8. Transport events common to all: `<Provider>.Events.WebSocketMediaStarted` / `WebSocketMediaEnded`.

Two API styles in this group:
- **Hosted-agent style** (agent configured on the provider's dashboard, scenario passes an agent ID): ElevenLabs, Cartesia.
- **OpenAI-Realtime style** (scenario drives `sessionUpdate` / `responseCreate` / `conversationItemCreate` with instructions, VAD config, tools): Yandex, xAI Grok, Inworld. Deepgram is its own Settings-message style with the fullest in-scenario config (pluggable listen/think/speak providers).

All tutorials are inbound (`AppEvents.CallAlerting`) examples; the same clients work on outbound legs (see the Grok example repo which demonstrates both directions).

---

## ElevenLabs (FOCUS)

### voice-ai.elevenlabs (folder)
Marketing blurb: ElevenLabs = realistic voice synthesis, speech recognition, NLP; integration is "seamless". No technical content.

### voice-ai.elevenlabs.agents-client (tutorial) — Agents Client
ElevenLabs conversational voice agents over WebSocket: custom TTS + ASR modules, choice of LLMs (Google Gemini, Claude, OpenAI, more), built-in turn-taking model, "scales to thousands of calls per day".

**API**: `ElevenLabs.createAgentsClient(params)` with:
- `xiApiKey` — ElevenLabs API key (example pulls it via `VoxEngine.getSecretValue('elevenlabs_api_key')`)
- `agentId` — the ElevenLabs agent (config: prompt, voice, LLM live on the ElevenLabs dashboard)
- `onWebSocketClose` — callback
- `baseUrl` — optional custom "ElevenLabs-compatible" backend URL (docs link the param reference under `references/voxengine/openai/chatcompletionsapiclientparameters#baseurl` — the connectors share a parameter reference in the OpenAI section)

**Events** (`ElevenLabs.AgentsEvents`): `Unknown`, `HTTPResponse`, `ConversationInitiationMetadata`, `Ping`, `UserTranscript` (caller-side ASR text), `AgentResponse` (agent text), `AgentResponseCorrection`, `Interruption` (handler calls `clearMediaBuffer()` — barge-in), `ClientToolCall` (client-side tool invocation from the agent), `ContextualUpdate`, `VadScore`, `InternalTentativeAgentResponse`.

**Methods seen**: `userMessage({ text })` — inject a user text message into the conversation; `conversationInitiationClientData({...})`; `clearMediaBuffer()`; `close()`.

**Per-call override** — `conversationInitiationClientData` payload:
```js
{
  conversation_config_override: {
    agent: {
      prompt: { prompt: '...' },
      first_message: '...',
      language: 'en'
    }
  }
}
```
Requires enabling the override functionality on the ElevenLabs agent (security settings) — the docs explicitly call this out.

**ALERT (hidden in the raw JSON, type=info, "Bot audio settings")**: *"You need to specify the 16000 Hz PCM audio format on the ElevenLabs side of the bot."* — the single setup gotcha; wrong audio format on the agent breaks the media path.

**KALFA relevance**: highest of the group. A first-class VoxEngine module that would replace the hand-rolled Groq bridge + `call.say()` niqqud TTS with an ElevenLabs-hosted Hebrew-capable agent: only `agentId` + API key needed in the scenario (largely sidesteps the 200-byte `script_custom_data` cap — per-guest data can arrive via the ctx endpoint and be injected through `conversation_config_override` prompt/first_message/`language:'he'`). `ClientToolCall` maps directly onto KALFA's `save_rsvp`/`mark_dnc`/`notify_owner` tool design; `UserTranscript`/`AgentResponse` give per-turn transcripts for the cb endpoint (auditability + per-reached-contact billing evidence). KALFA already holds ElevenLabs skills/keys elsewhere.

---

## Yandex

### voice-ai.yandex (folder)
Yandex cloud conversational AI: STT+TTS+LLM, multilingual claim, IVR/voice-bot positioning. No technical content.

### voice-ai.yandex.realtime-client (tutorial) — Realtime client
(Doc description bug: page description says "ElevenLabs realtime API client" — these tutorial pages are templated clones of each other.)

**API**: `Yandex.createRealtimeAPIClient({ apiKey, folderId, onWebSocketClose })` → `Yandex.RealtimeAPIClient`. `folderId` = Yandex Cloud folder. OpenAI-Realtime-shaped protocol:
- `sessionUpdate({ session: { type:'realtime', output_modalities:['audio'], instructions, audio:{output:{voice:'marina'}}, turn_detection:{ type:'server_vad', threshold:0.5, silence_duration_ms:400 }, tools:[{type:'function', name, description, parameters}] } })`
- `responseCreate({ instructions })` — force an utterance (used for the greeting)
- `conversationItemCreate({ item:{ type:'function_call_output', call_id, output } })` — answer a tool call

**Events** (`Yandex.RealtimeAPIEvents`): `SessionCreated` (→ send sessionUpdate + greeting), `SessionUpdated`, `Unknown`, `Error`, `WebSocketError`, `InputAudioBufferSpeechStarted` (→ `clearMediaBuffer()`), `ResponseCreated`, `RateLimitsUpdated`, `ResponseOutputAudioTranscriptDone`, `ResponseOutputItemDone` (inspect `event.data.payload.item` for `function_call` items); plus `Yandex.Events.WebSocketMediaStarted`/`WebSocketMediaEnded`.

**Notable pattern — LLM-initiated hangup** (transferable to any realtime-style connector):
1. Define a `hangup_call` function tool. 2. On `ResponseOutputItemDone` with `item.type=='function_call' && item.name=='hangup_call'` → send `function_call_output` "Ok", set `hangup=true`, `responseCreate({instructions:'say goodbye'})`. 3. On `WebSocketMediaEnded` if `hangup` → `setTimeout(() => call.hangup(), 1000)`.
Also shows `call.record({ hd_audio: true, stereo: true })` for stereo call recording alongside the AI client.

**KALFA relevance**: low as a provider (Russian-centric example, `marina` voice, no Hebrew evidence; Yandex = geopolitically/compliance questionable for IL traffic). High as a *pattern source*: the hangup-tool + farewell + delayed `call.hangup()` flow and the `server_vad` tuning knobs (`threshold`, `silence_duration_ms`) mirror what KALFA's conversation design needs.

---

## Deepgram

### voice-ai.deepgram (folder)
Deepgram = unified low-latency STT + TTS + conversational handling in one stack. No technical content.

### voice-ai.deepgram.voice-agent-api-client (tutorial) — Voice Agent API Client
**API**: `Deepgram.createVoiceAgentClient({ apiKey /* or access token */, settingsOptions })` → `Deepgram.VoiceAgentClient`. `settingsOptions` mirrors Deepgram's Settings message and is the most configurable connector in this group — pluggable listen/think/speak:
- `agent.language` ("If Flux is used, this will be ignored for STT")
- `agent.listen.provider`: `{ type:'deepgram', model:'nova-3', smart_format:false }` — smart_format Deepgram-only, cannot be used with Flux; `keyterms` extra option is nova-3 English-only
- `agent.think.provider`: `{ type:'open_ai', model:'gpt-4o-mini', temperature }` — `endpoint` optional for open_ai/anthropic, **required for 3rd-party LLM providers such as google and groq**; plus `functions:[...]` (tool definitions), `prompt`, `context_length`
- `agent.speak.provider`: `{ type:'deepgram', model:'aura-2-thalia-en' }`; documented alternatives inline: `open_ai` (tts-1/alloy), `eleven_labs` (model_id + language_code), `cartesia` (sonic-2 + voice id), `aws_polly` (voice/engine/credentials); `endpoint` required for non-deepgram speak providers
- `agent.context.messages` (conversation history preload, e.g. `{type:'History', role:'user', content:'My name is John'}`), `greeting`

**Methods**: `sendInjectUserMessage({ content })` (used after `SettingsApplied` to kick off the conversation), `sendFunctionCallResponse({ id, name, content })`, `clearMediaBuffer()`, `close()`.

**Events** (`Deepgram.VoiceAgentEvents`): `ConnectorInformation`, `Unknown`, `HTTPResponse`, `Welcome`, `SettingsApplied`, `ConversationText` (per-turn transcript), `UserStartedSpeaking` (→ `clearMediaBuffer()`), `AgentThinking`, `FunctionCallRequest` (→ respond with `sendFunctionCallResponse` using `event.data.payload.functions[0].id/name`), `FunctionCallResponse`, `PromptUpdated`, `SpeakUpdated`, `AgentAudioDone`, `Error`, `Warning`, `History`; plus `Deepgram.Events.WebSocketMediaStarted`/`WebSocketMediaEnded`.

**KALFA relevance**: medium-high. The only connector that lets KALFA mix-and-match: keep **Groq as the think provider** (explicitly supported, needs `endpoint`) and use **eleven_labs as the speak provider** — i.e., KALFA's exact current stack but with Deepgram doing orchestration/VAD instead of hand-rolled bridging. Open question (not in these docs): nova-3 Hebrew STT quality — must be verified with Deepgram before betting on it. Functions + `ConversationText` cover tool calls and transcript logging.

---

## Cartesia

### voice-ai.cartesia (folder)
Cartesia = ultra-low-latency TTS/STT for real-time voice, multilingual/expressive claims. No technical content.

### voice-ai.cartesia.agents-api-client (tutorial) — Agents API Client
Cartesia Line = hosted voice-agent platform (agent logic lives at Cartesia; developer keeps control of integrations).

**API**: `Cartesia.createAgentsClient({ apiKey, agentId, cartesiaVersion, onWebSocketClose })` → `Cartesia.AgentsClient`. `cartesiaVersion` is a dated API version string (example: `'2025-04-16'`). Unique step: after creation you must call `agentsClient.start({ metadata: { to, from } })` (metadata optional — example passes callee email + caller number).

**Events** (`Cartesia.AgentsEvents`): `Unknown`, `HTTPResponse`, `ACK`, `Clear` (server-driven buffer clear → handler calls `clearMediaBuffer()` — interruption is initiated by the Cartesia side, unlike others where a speech-start event drives it), `DTMF`, `Custom` (app-defined messages from the agent), `WebSocketError`, `ConnectorInformation`.

**KALFA relevance**: low-medium. Thinnest protocol (no transcript events documented on this page, no in-scenario prompt control — everything lives in Cartesia Line). `DTMF` and `Custom` events are interesting for keypad-RSVP fallback, but Hebrew support and any per-call personalization path are undocumented here.

---

## xAI

### voice-ai.xai (folder)
xAI/Grok blurb (founded 2023, Grok chatbot, APIs for voice-driven assistants). No technical content.

### voice-ai.xai.grok (tutorial) — Grok Voice Agent API Client
**API**: `Grok.createVoiceAgentAPIClient({ xAIApiKey, model, onWebSocketClose })`. Example model: `'grok-voice-think-fast-1.0'` (a dedicated Grok voice model). OpenAI-Realtime-shaped:
- On `ConversationCreated` → `sessionUpdate({ session: { turn_detection:{type:'server_vad'}, instructions } })`
- On `SessionUpdated` → `VoxEngine.sendMediaBetween(call, client)` then `responseCreate({ output_modalities:['audio'], audio:{output:{voice:'marin'}}, instructions:'Hello, can you help me?' })` (note: media bridging deferred until session is configured — a slightly different ordering than the other tutorials)

**Events** (`Grok.VoiceAgentAPIEvents`): `ConversationCreated`, `SessionUpdated`, `Unknown`, `WebSocketError`, `InputAudioBufferSpeechStarted` (→ `clearMediaBuffer()`), `ResponseCreated`, `ResponseOutputAudioTranscriptDone`; plus `Grok.Events.WebSocketMediaStarted`/`WebSocketMediaEnded`.

**See also**: [github.com/voximplant/grok-voice-agent-example](https://github.com/voximplant/grok-voice-agent-example) — "ready-to-run example demonstrating incoming and **outgoing** calls with the Grok Voice Agent integrated via Voximplant CI" — the only in-scope pointer to an outbound-call voice-agent reference implementation (directly matches KALFA's outbound RSVP-call shape and its voxengine-ci deploy flow).

**KALFA relevance**: low as provider (Hebrew voice quality unknown; 'marin' voice, English examples), but the example repo is a valuable outbound + voxengine-ci reference.

---

## Inworld

### voice-ai.inworld (folder)
Inworld Realtime API = single persistent connection for STT + turn-taking orchestration + TTS, with **multi-model routing** to GPT/Gemini/Claude without separate microservices. No technical content.

### voice-ai.inworld.realtime-api-client (tutorial) — Realtime API client
Connects to the Inworld Realtime WebSocket API (payload formats documented at docs.inworld.ai — Voximplant defers to them).

**API**: `Inworld.createRealtimeAPIClient({ apiKey, sessionKey, onWebSocketClose })`. OpenAI-Realtime-shaped with the richest session config in this group:
```js
sessionUpdate({ session: {
  type: 'realtime',
  model: 'openai/gpt-4o-mini',          // multi-model routing: provider/model
  instructions: '...',
  output_modalities: ['audio','text'],
  audio: { input: { turn_detection: {
    type: 'semantic_vad', eagerness: 'medium',
    create_response: true, interrupt_response: true } } },
  output: { voice: 'Clive', model: 'inworld-tts-1.5-mini', speed: 1.0 }
}})
```
then `responseCreate({ output_modalities:['audio'], audio:{output:{voice}}, instructions })`. Media bridging on `SessionUpdated` (same deferred ordering as Grok).

**Events** (`Inworld.RealtimeAPIEvents`): `SessionCreated`, `SessionUpdated`, `Unknown`, `Error`, `WebSocketError`, `InputAudioBufferSpeechStarted` (→ `clearMediaBuffer()`), `ResponseCreated`, `ResponseDone`, `ResponseOutputAudioTranscriptDone`, `RateLimitsUpdated`; plus `Inworld.Events.WebSocketMediaStarted`/`WebSocketMediaEnded`.

**Bonus**: `Inworld.createRealtimeTTSPlayer` — TTS-only player over the Inworld TTS WebSocket API; usage documented at `/docs/guides/speech/realtime-tts#inworld` (outside this scope group).

**KALFA relevance**: medium-low as provider, but two interesting features: `semantic_vad` (semantic turn detection with `eagerness` control — better than silence-based VAD for natural Hebrew turn-taking, if Hebrew is supported) and multi-model routing (could route to Claude/GPT with one connector). The separate RealtimeTTSPlayer is a `call.say()` alternative pattern (TTS player as a media unit).

---

## Cross-cutting observations & gotchas

- **Barge-in is manual everywhere**: the module buffers agent audio; the scenario must call `clearMediaBuffer()` on the provider's interruption/speech-start/Clear event or the agent talks over the caller.
- **`onWebSocketClose` + Disconnected/Failed handlers are load-bearing**: without them a dropped provider socket leaves the VoxEngine session (and billing) running — matches KALFA's stuck-call reconciler concerns.
- **ElevenLabs 16 kHz PCM agent-side setting** is the only hard audio-format requirement stated in this group.
- **Deepgram Flux caveats**: `agent.language` ignored for STT under Flux; `smart_format` incompatible with Flux; `keyterms` nova-3 English-only.
- **No Hebrew/language matrices anywhere** in these pages — language support must be verified per provider outside Voximplant docs.
- **Docs are templated clones** (Yandex page literally says "ElevenLabs" in its description); parameter reference for connectors is centralized under `references/voxengine/openai/*` (e.g. `baseUrl`), i.e., the OpenAI connector reference is the de-facto shared spec for these clients.
- **No pricing/limits** on any in-scope page beyond marketing scale claims ("thousands of calls per day").

---

## INVENTORY (all 12 in-scope pages; all fetched)

| fqdn | kind | title |
|---|---|---|
| voice-ai.elevenlabs | folder | ElevenLabs |
| voice-ai.elevenlabs.agents-client | tutorial | Agents Client |
| voice-ai.yandex | folder | Yandex |
| voice-ai.yandex.realtime-client | tutorial | Realtime client |
| voice-ai.deepgram | folder | Deepgram |
| voice-ai.deepgram.voice-agent-api-client | tutorial | Voice Agent API Client |
| voice-ai.cartesia | folder | Cartesia |
| voice-ai.cartesia.agents-api-client | tutorial | Agents API Client |
| voice-ai.xai | folder | xAI |
| voice-ai.xai.grok | tutorial | Grok Voice Agent API Client |
| voice-ai.inworld | folder | Inworld |
| voice-ai.inworld.realtime-api-client | tutorial | Realtime API client |
