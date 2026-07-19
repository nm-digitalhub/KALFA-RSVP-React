# ElevenLabs Docs — Curated URL Map

All URLs are fetchable as raw Markdown (they already end in `.mdx`).
Base: `https://elevenlabs.io` — prepend it to every path below.
This map is curated, not exhaustive. For anything missing, fetch `/docs/llms.txt`.

## Table of contents
1. Getting started & models
2. Text to Speech (batch, streaming, WebSockets)
3. Speech to Text (Scribe — batch & realtime)
4. Voices (cloning, design, remixing, library)
5. Music, Sound Effects, Dialogue
6. Dubbing, Voice Changer, Isolator, Forced Alignment
7. ElevenAgents (conversational AI)
8. Telephony & channels (Twilio, SIP, WhatsApp)
9. SDKs & machine-readable specs
10. Webhooks, workspace, billing, security

---

## 1. Getting started & models
- Quickstart (first API request): `/docs/eleven-api/quickstart.mdx`
- Choosing the right model: `/docs/eleven-api/choosing-the-right-model.mdx`
- Models catalog (all model IDs + languages): `/docs/overview/models.mdx`
- Authentication: `/docs/api-reference/authentication.mdx`
- Errors: `/docs/eleven-api/resources/errors.mdx`

## 2. Text to Speech
- Capability overview: `/docs/overview/capabilities/text-to-speech.mdx`
- Delivery/pronunciation/emotion best practices: `/docs/overview/capabilities/text-to-speech/best-practices.mdx`
- Streaming guide (file / stream / S3, Py+TS samples): `/docs/eleven-api/guides/how-to/text-to-speech/streaming.mdx`
- Request stitching (prosody across chunks): `/docs/eleven-api/guides/how-to/text-to-speech/request-stitching.mdx`
- Pronunciation dictionaries how-to: `/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries.mdx`
- Supabase edge-function streaming + CDN caching: `/docs/eleven-api/guides/how-to/text-to-speech/streaming-and-caching-with-supabase.mdx`
- Realtime WebSocket TTS: `/docs/eleven-api/guides/how-to/websockets/realtime-tts.mdx`
- Multi-context WebSocket (voice agents by hand): `/docs/eleven-api/guides/how-to/websockets/multi-context-web-socket.mdx`
- Latency concepts: `/docs/eleven-api/concepts/latency.mdx` · optimization: `/docs/eleven-api/guides/how-to/best-practices/latency-optimization.mdx`
- Audio streaming concepts: `/docs/eleven-api/concepts/audio-streaming.mdx`
- Endpoints: convert `/docs/api-reference/text-to-speech/convert.mdx`, stream `/docs/api-reference/text-to-speech/stream.mdx`, with-timestamps variants, WebSocket `/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.mdx`

## 3. Speech to Text (Scribe)
- Capability overview: `/docs/overview/capabilities/speech-to-text.mdx`
- Quickstart: `/docs/eleven-api/guides/cookbooks/speech-to-text.mdx`
- Batch: multichannel `/docs/eleven-api/guides/how-to/speech-to-text/batch/multichannel-transcription.mdx`, async webhooks `.../batch/webhooks.mdx`, keyterm prompting `.../batch/keyterm-prompting.mdx`, entity detection `.../batch/entity-detection.mdx`
- Realtime: client-side `.../realtime/client-side-streaming.mdx`, server-side `.../realtime/server-side-streaming.mdx`, commit strategies `.../realtime/transcripts-and-commit-strategies.mdx`, event reference `.../realtime/event-reference.mdx`
  (full prefix: `/docs/eleven-api/guides/how-to/speech-to-text/`)
- Endpoint: `/docs/api-reference/speech-to-text/convert.mdx` · realtime `/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime.mdx`

## 4. Voices
- Capability overview: `/docs/overview/capabilities/voices.mdx` · remixing: `/docs/overview/capabilities/voice-remixing.mdx`
- Cloning concepts (IVC vs PVC): `/docs/eleven-api/concepts/voice-cloning.mdx`
- IVC quickstart: `/docs/eleven-api/guides/how-to/voices/instant-voice-cloning.mdx`
- PVC quickstart: `/docs/eleven-api/guides/how-to/voices/professional-voice-cloning.mdx`
- Voice Design (voice from text prompt): `/docs/eleven-api/guides/how-to/voices/voice-design.mdx`
- Remix a voice: `/docs/eleven-api/guides/how-to/voices/remix-a-voice.mdx`
- Endpoints: list `/docs/api-reference/voices/search.mdx`, settings `/docs/api-reference/voices/settings/update.mdx`, library `/docs/api-reference/voices/voice-library/get-shared.mdx`

## 5. Music, Sound Effects, Dialogue
- Music overview: `/docs/overview/capabilities/music.mdx` · prompting best practices: `/docs/overview/capabilities/music/best-practices.mdx`
- Music quickstart: `/docs/eleven-api/guides/cookbooks/music.mdx` · streaming: `/docs/eleven-api/guides/how-to/music/streaming.mdx`
- Composition plans (structured JSON control): `/docs/eleven-api/guides/how-to/music/composition-plans.mdx` · inpainting: `.../music/inpainting.mdx`
- Sound effects: `/docs/eleven-api/guides/cookbooks/sound-effects.mdx` · endpoint `/docs/api-reference/text-to-sound-effects/convert.mdx`
- Text to Dialogue: `/docs/overview/capabilities/text-to-dialogue.mdx` · quickstart `/docs/eleven-api/guides/cookbooks/text-to-dialogue.mdx`

## 6. Dubbing, Voice Changer, Isolator, Forced Alignment
- Dubbing quickstart: `/docs/eleven-api/guides/cookbooks/dubbing.mdx` · endpoints under `/docs/api-reference/dubbing/`
- Voice changer: `/docs/eleven-api/guides/cookbooks/voice-changer.mdx`
- Voice isolator: `/docs/eleven-api/guides/cookbooks/voice-isolator.mdx`
- Forced alignment (audio↔text timestamps): `/docs/eleven-api/guides/cookbooks/forced-alignment.mdx`

## 7. ElevenAgents
- Platform overview: `/docs/eleven-agents/overview.mdx` · quickstart: `/docs/eleven-agents/quickstart.mdx`
- Prompting guide (production system design): `/docs/eleven-agents/best-practices/prompting-guide.mdx`
- LLM selection: `/docs/eleven-agents/customization/llm.mdx` · custom LLM: `.../llm/custom-llm.mdx` · cascading fallback: `.../llm/llm-cascading.mdx` · cost optimization: `.../llm/optimizing-costs.mdx`
- Workflows (graph-based flows): `/docs/eleven-agents/customization/agent-workflows.mdx`
- Conversation flow (turn-taking/interruptions): `/docs/eleven-agents/customization/conversation-flow.mdx`
- Guardrails: `/docs/eleven-agents/best-practices/guardrails.mdx`
- Knowledge base: `/docs/eleven-agents/customization/knowledge-base.mdx` · RAG: `.../knowledge-base/rag.mdx`
- Tools: overview `/docs/eleven-agents/customization/tools.mdx`, client `.../tools/client-tools.mdx`, server `.../tools/server-tools.mdx`, system `.../tools/system-tools.mdx`, **MCP** `.../tools/mcp.mdx` (+ security `.../tools/mcp/security.mdx`)
- Personalization: dynamic variables `.../personalization/dynamic-variables.mdx`, overrides `.../personalization/overrides.mdx`
- Auth: `/docs/eleven-agents/customization/authentication.mdx` · Events: `.../events.mdx`
- Testing: `/docs/eleven-agents/customization/agent-testing.mdx` · simulate: `/docs/eleven-agents/guides/simulate-conversation.mdx`
- Versioning/branches: `/docs/eleven-agents/operate/versioning.mdx` · experiments: `.../operate/experiments.mdx` · CLI (agents-as-code): `.../operate/cli.mdx`
- Analysis: `/docs/eleven-agents/customization/agent-analysis.mdx` · post-call webhooks: `/docs/eleven-agents/workflows/post-call-webhooks.mdx`
- Privacy/retention: `/docs/eleven-agents/customization/privacy.mdx`
- Agent API endpoints: prefix `/docs/eleven-agents/api-reference/` (agents, conversations, tools, knowledge-base, tests, phone-numbers, batch-calling, mcp)

## 8. Telephony & channels
- SIP trunking: `/docs/eleven-agents/phone-numbers/sip-trunking.mdx`
- Twilio native: `/docs/eleven-agents/phone-numbers/twilio-integration/native-integration.mdx` · register-your-own-calls: `.../register-call.mdx`
- Telnyx `.../telephony/telnyx.mdx` · Vonage `.../telephony/vonage.mdx` · Plivo `.../telephony/plivo.mdx` · Genesys `/docs/eleven-agents/phone-numbers/c-caa-s-integrations/genesys.mdx`
- WhatsApp: `/docs/eleven-agents/whatsapp.mdx` · WhatsApp tools: `/docs/eleven-agents/whatsapp/tools.mdx`
- Batch outbound calling: `/docs/eleven-agents/phone-numbers/batch-calls.mdx`
- TTS into Twilio calls (non-agent): `/docs/eleven-api/guides/how-to/text-to-speech/twilio.mdx`

## 9. SDKs & machine-readable specs
- Libraries index: `/docs/eleven-api/resources/libraries.mdx`
- Agents SDKs: Python `/docs/eleven-agents/libraries/python.mdx`, React `.../react.mdx`, React Native `.../react-native.mdx`, JS `.../java-script.mdx`, Kotlin `.../kotlin.mdx`, Swift `.../swift.mdx`, raw WebSocket `.../web-sockets.mdx`
- OpenAPI (raw JSON — use `scripts/endpoint_schema.py`, never fetch whole): `https://api.elevenlabs.io/openapi.json` — AsyncAPI: `/asyncapi.json`
- Full docs in one file (very large): `/docs/llms-full.txt`

## 10. Webhooks, workspace, billing, security
- Webhooks: `/docs/eleven-api/resources/webhooks.mdx` · workspace webhook endpoints under `/docs/api-reference/webhooks/`
- Security best practices: `/docs/eleven-api/guides/how-to/best-practices/security.mdx`
- Zero Retention Mode: `/docs/eleven-api/resources/zero-retention-mode.mdx`
- Breaking changes policy: `/docs/eleven-api/resources/breaking-changes-policy.mdx`
- Billing: `/docs/overview/administration/billing.mdx` · usage analytics: `.../usage-analytics.mdx`
- Workspaces: `/docs/overview/administration/workspaces/overview.mdx` · service accounts & API keys: `.../workspaces/service-accounts.mdx` · SSO: `.../workspaces/sso.mdx`
- Legal (agents): HIPAA `/docs/eleven-agents/legal/hipaa.mdx`, TCPA `.../legal/tcpa.mdx`, disclosure `.../legal/disclosure-requirement.mdx`
