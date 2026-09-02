# Sales Close Agent hardening - 2026-09-01

This document records the changes made to the KALFA Sales Close voice-agent bridge after reviewing:

- `voxfiles/scenarios/src/SalesCloseAgent.voxengine.js`
- `agent_configs/KALFA-Sales-Close.json`
- the local Next.js 16.3.1 bundled route-handler docs
- ElevenLabs and Voximplant documentation through Context7 and official package typings

## Summary

The changes keep `wa_consent` as the canonical `send_signup_link` client-tool parameter. The work hardens client-tool execution, adds missing event declarations, enables an existing false-close guardrail, and makes the sales post-call webhook resilient when the Voximplant terminal callback does not persist `el_conversation_id`.

## Changes

### 1. Kept `wa_consent` as the tool parameter

`wa_consent` remains the required parameter for `send_signup_link`.

Updated only inconsistent descriptions in:

- `agent_configs/KALFA-Sales-Close.json`
- `tool_configs/send_signup_link.json`

The server route and VoxEngine bridge continue to send and validate `wa_consent`.

Reason: the live contract already uses `wa_consent`; changing it to `whatsapp_consent` would break the existing route validation and tests.

### 2. Added declared dynamic variable for correlation

Added `kalfa_attempt_token` to the ElevenLabs agent dynamic-variable placeholders.

Changed the sales ctx endpoint to return `sales_call_attempts.id` as `kalfa_attempt_token` instead of `el_conversation_id`.

Reason: `el_conversation_id` is normally unknown before the ElevenLabs conversation starts, so using it as the initial correlation token produced an empty or misleading dynamic variable.

### 3. Added post-call correlation fallback

Updated sales post-call processing to pass `analysis.correlationToken` into the sales-attempt lookup.

Updated `getSalesAttemptIdByConversationId()` to:

- first resolve a valid UUID-shaped correlation token against `sales_call_attempts.id`
- then fall back to `sales_call_attempts.el_conversation_id`

Also backfills `sales_call_attempts.el_conversation_id` from the post-call webhook when an attempt is found. This preserves the existing CRM join path by conversation id.

Reason: if Voximplant misses the terminal callback that carries `el_conversation_id`, the ElevenLabs post-call webhook can still resolve and conclude the sales attempt.

### 4. Hardened VoxEngine client-tool routing

Updated `SalesCloseAgent.voxengine.js` to:

- accept `parameters`, `arguments`, or `args`
- parse tool args when ElevenLabs/Voximplant provides them as a JSON string
- accept both snake_case and camelCase tool-call ids
- include `tool_name` in `clientToolResult`
- return an explicit `unsupported_tool` error for unknown tools instead of silently ignoring the call

Reason: ElevenLabs client tools require a result to be sent back to the conversation. Ignoring an unknown or differently-shaped event can surface as a tool timeout at the agent layer.

### 5. Declared client events consumed by the bridge

Added these events to `conversation_config.conversation.client_events`:

- `conversation_initiation_metadata`
- `client_tool_call`
- `vad_score`

Reason: the VoxEngine scenario already consumes these events to capture the ElevenLabs conversation id, route client tools, and track VAD. The ElevenLabs SDK type definitions list all three as valid client events.

### 6. Enabled false-close guardrail

Enabled the existing custom guardrail named `No false close before confirmed send`.

Reason: the guardrail protects the highest-risk sales behavior already described in the prompt: the agent must not imply signup/close completion before `send_signup_link` returns `accepted=true`.

## Tests added or updated

- `src/lib/data/elevenlabs-analysis-processing.test.ts`
  - verifies the sales post-call worker passes the injected correlation token into the lookup
  - verifies the worker backfills the sales attempt conversation id

- `src/lib/data/sales-call-attempts.test.ts`
  - verifies UUID-shaped correlation token lookup is preferred
  - verifies fallback to `el_conversation_id` when the token is absent or unusable

## Sources

- Context7 selected `/elevenlabs/elevenlabs-js` for ElevenLabs SDK/config types and `/websites/voximplant` for Voximplant docs.
- ElevenLabs client events and client-tool result flow: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events
- ElevenLabs post-call webhooks and HMAC guidance: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
- ElevenLabs dynamic variables: https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables
- Voximplant ElevenLabs function-calling example: https://docs.voximplant.ai/voice-ai-orchestration/elevenlabs/function-calling
- Voximplant CallEvents failed-status reference: https://voximplant.com/docs/references/voxengine/callevents
- Voximplant `VoxEngine.terminate()` reference: https://voximplant.com/docs/references/voxengine/voxengine/terminate
- Local Next.js 16.3.1 docs read from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- Local ElevenLabs SDK event enum read from `node_modules/@elevenlabs/elevenlabs-js/api/types/ClientEvent.d.ts`
- Local Voximplant ElevenLabs typings read from `node_modules/@voximplant/voxengine-ci/typings/voxengine.d.ts`

## Not changed

Privacy retention settings were reviewed but not changed. The current config keeps `record_voice=true` and `retention_days=-1`. Changing retention/redaction requires a product/legal retention policy decision because it affects available recordings, transcript history, support workflows, and analysis retention.
