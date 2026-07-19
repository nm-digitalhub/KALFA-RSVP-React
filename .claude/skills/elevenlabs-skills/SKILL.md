---
name: elevenlabs-docs
description: Authoritative, always-current access to the ElevenLabs documentation (Text to Speech, Speech to Text, ElevenAgents conversational AI, Music, Dubbing, Voices/Cloning, WebSockets, SDKs, API reference, webhooks, workspace admin). Use this skill whenever the user asks how to do ANYTHING with ElevenLabs — writing integration code, choosing a model (eleven_v3, flash, multilingual, scribe), configuring an agent, debugging an API call, streaming audio, voice cloning, Twilio/WhatsApp telephony, or pricing/limits questions — even if they don't say "docs". Never answer ElevenLabs API specifics from memory; this skill defines the mandatory live-fetch protocol.
# Claude Code extension fields (model, context, effort) are NOT in the portable
# Agent Skills standard — add them only in a Claude Code-local copy if needed.
# model: inherit is already the default and is correct here: this skill feeds
# docs INTO the main coding conversation. See "Model routing" section below.
# allowed-tools is standard: grants pre-approval, does not block other tools.
allowed-tools: Read, Grep, Bash(curl:*), Bash(python3:*), Bash(bash:*), WebFetch, WebSearch
---

# ElevenLabs Documentation Navigator

Goal: answer ElevenLabs questions and write ElevenLabs integration code that is
**correct against the docs as they exist today**, not as they existed in training data.
ElevenLabs ships breaking product changes fast (product lines were recently renamed to
ElevenCreative / ElevenAgents / ElevenAPI; legacy endpoints get moved under `Legacy`).
Memory-based answers about this API are unreliable by default.

## Non-negotiable currency protocol

Before stating any endpoint path, SDK method, model ID, parameter name, or limit:

1. **Fetch the relevant doc page live.** Every doc page is available as raw Markdown by
   appending `.md` to its URL (the documented convention; legacy `.mdx` also resolves), e.g.
   `https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming.md`.
   These pages include complete, runnable Python/TypeScript samples — prefer adapting
   them over reconstructing code from memory.
2. **If you don't know which page**, fetch the master index first:
   `https://elevenlabs.io/docs/llms.txt` (every page, one line each, with its `.mdx` URL).
   For exact request/response schemas use `scripts/endpoint_schema.py` (see Scripts) —
   the raw spec lives at `https://api.elevenlabs.io/openapi.json` (the `elevenlabs.io`
   URL listed in llms.txt serves an HTML shell to non-browser clients). WebSocket
   channels: `https://elevenlabs.io/asyncapi.json`.
3. **Cite what you fetched.** Tell the user which page the answer came from, so they can
   verify. If a fetch fails or the docs contradict your prior knowledge, the fetched docs
   win — say so explicitly rather than blending the two.

Skipping the fetch is acceptable only for questions that are purely conceptual
("what is dubbing?") with no code, parameters, or product-structure claims.

## Routing the question

First read `references/api-basics.md` — a verified snapshot of stable core facts
(base URL, `xi-api-key` auth, SDK packages, model IDs + char limits, deprecations,
known gotchas like the v3/WebSocket incompatibility). It answers many questions outright
and tells you what still needs a live check.

Then map the request to a doc area and open `references/doc-map.md` for the curated URL
index of that area. Top-level structure of the docs:

| Area | Doc prefix | Typical questions |
|---|---|---|
| ElevenAPI | `/docs/eleven-api/...` | TTS, STT (Scribe), Music, SFX, voice changer/isolator, WebSockets, latency, SDKs |
| ElevenAgents | `/docs/eleven-agents/...` | Conversational agents, tools/MCP, knowledge base/RAG, telephony (Twilio/SIP), WhatsApp, testing, analytics |
| ElevenCreative | `/docs/eleven-creative/...` | Studio, Flows, dubbing studio, voiceover, Audio Native embeds |
| API reference | `/docs/api-reference/...` | Exact endpoints, auth, streaming protocol |
| Overview/Admin | `/docs/overview/...` | Models catalog, capabilities, billing, workspaces, SSO/SCIM |

Ambiguity boundary: "agent" almost always means ElevenAgents (the conversational AI
platform), not a generic API client. Both `/docs/eleven-agents/api-reference/...` and
`/docs/api-reference/agents/...` exist and mirror each other — either works.

## Verification hooks for produced code

When you write integration code from these docs, before presenting it check that:

- Every model ID (e.g. `eleven_v3`, `eleven_flash_v2_5`, `eleven_multilingual_v2`,
  `scribe_v1`) appears verbatim in a page you fetched this conversation — model names
  are the most common hallucination in this API.
- SDK import paths match the fetched sample (`@elevenlabs/elevenlabs-js` for JS,
  `elevenlabs` for Python) — older package names are deprecated.
- Anything involving pricing, concurrency, or plan limits is stated as
  "per the docs page X as of today", since these change frequently.
- Endpoints found only under `/docs/api-reference/legacy/...` are flagged as legacy and
  a current alternative is offered.

## User-context defaults (override on request)

If the user's context indicates Hebrew or RTL work: `eleven_v3` and
`eleven_multilingual_v2` support Hebrew; flash-tier models trade quality for latency —
verify current language support on the model's doc page before recommending. For
real-time voice-agent work, check both the multi-context WebSocket page (ElevenAPI) and
ElevenAgents before choosing an architecture: ElevenAgents bundles STT+LLM+TTS turn-taking
that is expensive to rebuild by hand over raw WebSockets.

## Scripts (Claude Code / bash environments)

Two indexes are too large for context; use the bundled scripts instead of fetching them:

- `scripts/find_doc.sh '<pattern>'` — greps the full ~350-page docs index (llms.txt,
  ~15K tokens) via a 24h-cached local copy and returns only matching titles+URLs.
  Use it whenever the doc-map above doesn't obviously cover the question.
- `scripts/endpoint_schema.py '<substring>' [--full]` — looks up exact endpoint
  request/response schemas in the ~1.4MB OpenAPI spec (impossible to load into context).
  Matches path/operationId/summary; ≤3 hits print schemas, more hits print a list to
  narrow. Stdlib-only, curl-first fetching, validates JSON before caching.

Environment note: scripts need network + bash (fine in Claude Code / claude.ai code
execution; the raw Anthropic API sandbox has NO network access — there, and in plain
chat, fall back to web-fetching individual doc pages; never fetch openapi.json whole).

## Model routing (Claude Code)

This SKILL.md ships with `model: inherit` on purpose. If you want a cheap
lookup-only variant (pure "what does the docs say" questions with no code
written in the main thread), copy this skill to a second folder, rename it
`elevenlabs-lookup`, and set `model: haiku` + `context: fork` in its
frontmatter — the fork isolates the fetches and returns only the answer.

## Escalation

- Question spans many pages or "how does X compare to Y across the platform" →
  fetch `https://elevenlabs.io/docs/llms-full.txt` sections (large; prefer targeted pages).
- Docs are silent or contradictory → say so and link the closest pages; do not fill the
  gap from memory.
