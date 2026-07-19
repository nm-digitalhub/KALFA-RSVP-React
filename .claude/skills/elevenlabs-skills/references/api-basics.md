# ElevenLabs API — Core Facts (snapshot 2026-07, verify anything version-sensitive against live docs)

## Base URL & auth

- REST base: `https://api.elevenlabs.io/v1`
- Auth header: `xi-api-key: <API_KEY>` on every request (NOT `Authorization: Bearer`)
- API keys support scope restriction, credit quotas, and IP allowlisting (non-allowlisted IPs → `403`)
- Never expose API keys client-side; for browser/app-side connections use **single-use tokens** (`api-reference/tokens/create`)
- Sanity-check auth: `curl 'https://api.elevenlabs.io/v1/models' -H 'xi-api-key: $KEY'`

## Official SDKs

- Python: `pip install elevenlabs` → `from elevenlabs.client import ElevenLabs`
- Node: `npm install @elevenlabs/elevenlabs-js` → `import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js"`
- SDK method example: `elevenlabs.text_to_speech.convert(text=..., voice_id=..., model_id=..., output_format="mp3_44100_128")`
- ElevenLabs also publishes agent skills: `npx skills add elevenlabs/skills --skill text-to-speech`

## Current TTS/model landscape (from `overview/models`, verify before pinning)

| Model ID | Purpose | Char limit |
|---|---|---|
| `eleven_v3` | Flagship, most expressive, 70+ languages (incl. Hebrew) | 5,000 (~5 min) |
| `eleven_multilingual_v2` | Most lifelike stable model, 29 languages | 10,000 |
| `eleven_flash_v2_5` | Ultra-low latency (~75ms), multilingual v2 langs + hu/no/vi | 40,000 |
| `eleven_flash_v2` | Ultra-low latency, English only | 30,000 |
| `eleven_multilingual_sts_v2` | Voice changer (speech-to-speech) | 10,000 |
| `eleven_ttv_v3` / `eleven_multilingual_ttv_v2` | Voice design (text-to-voice) | — |
| `eleven_text_to_sound_v2` | Sound effects | — |

## Old patterns

<details>
<summary>Deprecated model IDs</summary>

`eleven_turbo_v2_5` / `eleven_turbo_v2` — replaced by the Flash models (same quality, lower latency). Don't use turbo IDs in new code; if found in existing code, migrate to `eleven_flash_v2_5` / `eleven_flash_v2`.
</details>

Selection heuristic from the docs: quality → `eleven_multilingual_v2` or `eleven_v3`; realtime/agents → `eleven_flash_v2_5`. Note `eleven_v3`'s 5,000-char limit — long-form content needs chunking + request stitching (`eleven-api/guides/how-to/text-to-speech/request-stitching`).

Hebrew note: Hebrew (`he`) is in the eleven_v3 70+ language set but NOT in the multilingual_v2 / flash_v2_5 language lists. For Hebrew output, verify current language support on `overview/models.md` before choosing a model.

## Streaming

- HTTP streaming: chunked transfer encoding on `.../stream` endpoints — audio plays before generation completes (`api-reference/streaming`)
- WebSocket TTS: `wss` input-streaming endpoint for realtime generation from an LLM token stream (`eleven-api/guides/how-to/websockets/realtime-tts`)
- Multi-context WebSocket: for interruptible voice agents managing several generation contexts on one connection (`.../multi-context-web-socket`)
- Realtime STT (Scribe): dedicated realtime endpoint + JS/React SDKs (`javascript-scribe`, `react-scribe`)
- WebSocket message schemas: authoritative source is `https://elevenlabs.io/asyncapi.json`

## Product naming (current)

| Current name | Formerly / covers |
|---|---|
| **ElevenAgents** | "Conversational AI" / "Agents Platform" — voice+chat agents, telephony, WhatsApp |
| **ElevenCreative** | Studio, playground, dubbing studio, voiceover studio, flows |
| **ElevenAPI** | The developer API section of docs |
| **Scribe** | Speech to Text |

Legacy endpoints exist under `api-reference/legacy/...` — don't use them for new work; check `agent-tools-deprecation` (`prompt.tools` → `prompt.tool_ids`) when touching older agent configs.

## Gotchas worth checking every time

- **`eleven_v3` is alpha and per the models page "not made for real-time applications like Conversational AI"** — long-form quality yes, live agents no. The docs reference an "Eleven v3 Conversational" variant optimized for real-time dialogue; verify its model_id on the models page before use.
- **The TTS WebSocket endpoint (`/v1/text-to-speech/{voice_id}/stream-input`) does NOT support `eleven_v3`** (verified 2026-07). For realtime WebSocket streaming use `eleven_flash_v2_5` or `eleven_multilingual_v2`; for `eleven_v3` use the HTTP `.../stream` endpoint instead.
- Output formats (e.g. `mp3_44100_192`, PCM variants) are plan-tier-gated — verify against the endpoint's inline OpenAPI.
- Webhooks require signature verification — see `eleven-api/resources/webhooks`.
- Agents: post-call webhooks fire after analysis completes, not at hangup (`eleven-agents/workflows/post-call-webhooks`).
- Breaking-changes policy defines what ElevenLabs considers non-breaking (they may add fields/enum values freely): `eleven-api/resources/breaking-changes-policy`.
