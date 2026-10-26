# Design

## Context

See proposal.md (Why) for the failure. These facts shape the approach:

- **Today's save path** (`RSVPAgent.voxengine.js:1466-1629`):
  1. ElevenLabs sends `client_tool_call` to the Voximplant connector.
  2. The scenario's `ClientToolCall` handler POSTs `{status, adults, children, tool_call_id}` to
     `/api/voximplant/agent-tool/rsvp/{token}`. The scenario holds `tok` from `customData`.
  3. The route (`src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts`) runs:
     - `guardAgentToolRequest`: fail-closed rate limit of 30 per 5 minutes per token fingerprint and IP, the body cap,
       token resolution through `getCallAttemptByAccessToken`, and `token_expires_at`;
     - `voxSaveRsvpSchema`, a strict object;
     - a `webhook_inbox` insert with key `vox-rsvp:{attemptId}:{valueHash}`;
     - a synchronous `processCallRsvp`;
     - the answer `{ok, status: saved|rejected|queued, reason?}`.
  4. The scenario answers the agent with `clientToolResult`.
- **What ElevenLabs offers for a webhook tool** (docs read 26.10.2026: `tools/webhook-tools`,
  `personalization/dynamic-variables`; `WebhookToolApiSchemaConfig` in the OpenAPI spec):
  - `api_schema.url` is static;
  - body properties take their value from exactly one source: an LLM description, a `dynamic_variable`, or a
    `constant_value`;
  - a `request_headers` value can be a string, `{secret_id}` (workspace secret), `{variable_name}` (dynamic variable)
    or `{env_var_label}`;
  - `secret__`-prefixed dynamic variables "should only be used in dynamic variable headers and never sent to an LLM
    provider"; the conversations API returns them as `<REDACTED>`, and post-call transcription webhooks deliver the
    original values.
- **Unknown dynamic variables are accepted.** `kalfa_correlation_id` is not among the RSVP agent's
  `dynamic_variable_placeholders`, and every call has sent it without error.
- **Tools are workspace entities, shared by branches.** A branch differs only in its `tool_ids`. Editing the existing
  `save_rsvp` tool would change Main at once.
- **`APP_ORIGIN` is `https://beta.kalfa.me`.** It is the origin the bridge's `u` points at, so it is the webhook's URL.

## Goals / Non-Goals

**Goals:**
- One save handler serves both entry points while both exist, so validation, dedupe, apply and the answer cannot
  drift.
- The webhook route's authorization is exactly as strong as the current route's.
- The test call changes one variable only: the save tool's type. The branch's prompt, model and every other tool match
  Main v75.
- Live calls see no change until the merge gate.

**Non-Goals:**
- Converting `mark_dnc`, `notify_owner` and `schedule_callback`.
- Any prompt work.
- Deciding Mini vs Custom. That is the fallback test in D7.

## Decisions

### D1. Webhook tool, not a client tool (owner decision, 26.10.2026)

In the three Mini voice calls, the only tool the agent ran was `end_call`, which executes inside ElevenLabs. A webhook
tool also executes on ElevenLabs' side. If Mini's voice pipeline handles client tools differently, a webhook avoids
that. It also takes Voximplant out of the save path: one hop fewer, and the save no longer depends on the scenario's
handler.

Alternative kept as the fallback: no tool change, with the controlled Custom-mode call from the investigation (D7).

### D2. Authorization: the per-call access token in a header bound to `secret__kalfa_tool_token`

The tool's `request_headers` is `{"X-Kalfa-Call-Token": {"variable_name": "secret__kalfa_tool_token"}}`. The route reads
that header and hands it to the same guard core that the bridge route uses, with the same scope, rate limit, body cap,
expiry and generic 404.

Alternatives rejected:
- **The token in the URL path.** The skill and the docs require a static URL. A path value is also the part most often
  logged.
- **A workspace secret header plus `kalfa_correlation_id` in the body.** The nonce is "non-authorizing by design"
  (`ctx/[token]/route.ts:210-215`), and it is visible to anyone with workspace access. This would make it a capability,
  and one static key would authorize every live attempt.
- **The token as a regular dynamic variable.** It would be sent to the LLM and readable from the conversations API.

### D3. One shared handler

The body of today's route, from the JSON parse onward, moves to `src/lib/voximplant/save-rsvp-tool.ts`, as
`handleSaveRsvpToolCall(attemptId, raw)` returning a `Response`. Both routes become:

1. guard;
2. the handler.

The inbox `provider`, `event_kind` and dedupe key stay byte-identical, so an answer that arrives by both paths during
the rollout is stored and applied once. The drain (`processCallRsvpRow`) is unchanged.

The guard core gains a named export, `guardAgentToolRequestByHeader`. It takes the token from a request header instead
of a path parameter. This follows the guard file's own rule: a named export per surface.

### D4. Strip `secret__` variables before the post-call store

`buildElevenLabsAnalysisRow` (`src/lib/data/elevenlabs-webhook-intake.ts`) stores the whole payload. It will copy the
payload and delete every `secret__*` key under `data.conversation_initiation_client_data.dynamic_variables`. It does
this before both the RSVP and the sales intake. The strip must ship before the first conversation that carries the
variable.

### D5. The bridge injects the variable only on branch calls until the merge

`RSVPAgent` adds `secret__kalfa_tool_token: accessToken` to `dynamic_variables` only when `state.branchId` is set. Live
calls carry nothing new, which is data minimization: Main's client tool never reads the variable.

The merge task removes the condition, so the variable is always sent, in the same deploy that retires the client
route.

The decision is a pure function next to `testBranchFrom`, so the existing cut-out test covers it.

### D6. The test branch is Main v75 with one tool swapped

`test` is rebased onto Main, so its prompt returns to v75 and H1 is dropped. Its `tool_ids` become Main's, except that
the client `save_rsvp` is replaced by the new webhook tool. The test branch is then read back and diffed against Main;
the only allowed difference is that one entry in `tool_ids`.

The webhook tool's name stays `save_rsvp`, so the v75 prompt names it unchanged. If ElevenLabs refuses a duplicate name
in the workspace, the tool is named `save_rsvp_server`, and the prompt's references to it on the test branch are the
only text change. That case is recorded as a second difference.

The tool configuration mirrors the client tool: the description, the three body properties with the same descriptions
and enum, `response_timeout_secs: 20`, and `execution_mode: immediate`.

### D7. How the test call is read

- **The webhook tool appears in the conversation's tool calls, and the guest row and inbox row are written.** Mini
  calls server-side tools. Proceed to the merge gate.
- **No save tool call.** The webhook did not fix it. Main is untouched. The next step is the controlled Custom-mode call
  (test branch identical to Main except `realtime_model: null`), which separates Mini from the October prompt and TTS
  changes. Those changes and Mini are confounded today: no RSVP call ran between v60 (07.09) and v75.

### D8. Retirement after the merge

After Main runs the webhook tool and one recorded call on Main shows a save:
- remove `save_rsvp` from `TOOL_ROUTES`;
- remove the `/api/voximplant/agent-tool/rsvp/[token]` route;
- unregister the client tool, after confirming that no branch references it.

The shared handler stays, now with one caller, and its name and docs are updated. A conversation lasts at most 150
seconds (`GLOBAL_TIMEOUT_MS`), so the retirement deploy can follow the merge once no Main call is in flight.

## Risks / Trade-offs

- **Mini may not call the webhook tool either.**
  → The test decides that before any Main change. D7 names the next step.
- **The token now reaches a third party.**
  → It is a `secret__` variable: not sent to the LLM and redacted in ElevenLabs' API. The token is per call, expires
  2 hours after dial (`test-call:attempt`) or by the dispatcher's expiry, and is removed from our inbox copy (D4).
- **The webhook-tools page describes no request signing**, only headers and auth connections. Whether ElevenLabs signs
  tool requests is not established.
  → The token is the authorization either way. Today the scenario sends the token in the URL; the webhook sends it in
  a header, which is safer from URL logging.
- **How the agent hears a non-200 answer is not documented.** The expectation is that the tool runtime reports it as a
  tool error (`tool_error_handling_mode: auto`).
  → Not yet measured. The test call's conversation record shows the tool result as the agent saw it. A 404 path is
  checked once on the test branch with an expired token before the merge.
- **The app deploy and the scenario deploy both touch production.**
  → Each needs the owner's approval. The scenario change is inert on live calls (D5), and the route is new.
- **The client and webhook tools both live in the workspace during the rollout.**
  → Only one is attached per branch (D6). The retirement removes the client tool (D8).

## Migration Plan

0. **Spike, with no code and no deploy.** Register the webhook tool without its header, pointing at the not-yet-existing
   route. Swap it onto `test` (D6), and place one approved call. The model's decision to call a tool does not depend on
   headers, so a 404 answer still shows whether Mini calls a webhook tool at all:
   - **Called:** continue with step 1.
   - **Not called:** stop. Nothing was built or deployed, and the next step is D7's Custom-mode call.
1. Code with focused tests, then `npm run lint`, `npm run typecheck` and `npm run build`.
2. Deploy the app, with approval. Verify that the new route answers 404 to a request without a token.
3. Upload the scenario, with approval. Verify with the scenario hash in `RSVPAgent.metadata.config.json`.
4. Add the header to the spike's tool, re-check `test` against Main, and diff the two.
5. One test call, with approval, read through tool executions, the conversation, the guest row, the inbox row, the
   session log and the audio (§6.4).
6. Merge to Main, with approval, then read back: Main 100%.
7. One call on Main. Then the D5 condition removal and the D8 retirement in one scenario and app deploy.

**Rollback:**
- Re-attach the client `save_rsvp` to the affected branch's `tool_ids`; the scenario and route still serve it until D8.
- After D8, roll back by reverting that commit and re-uploading the scenario.

## Assumptions (not measured on this account)

Each item names what would confirm it.

1. **Mini voice handles a webhook tool differently from a client tool.** This is the hypothesis under test, with no
   evidence for it yet. It is based only on Mini calling `end_call` and not `save_rsvp`. The spike (Migration Plan
   step 0) tests it.
2. **A 404 answer still leaves the tool call on record**, in the transcript's `tool_calls`, the conversation's
   `tool_names_errored`, and the tool's execution log. The `tool_names_errored` filter in the conversations API
   suggests this, but it has not been seen here. The spike shows it.
3. **The model's decision to call the tool does not depend on whether a header is configured.** It is not documented.
   If the spike shows no call, step 4 (the header added) is not run on that basis alone.
4. **`secret__` values are kept from the LLM and redacted in the conversations API.** This is documented only. After
   the first armed call (8.1), read the conversation from the API and confirm the value shows as `<REDACTED>`.
5. **A header can be bound to a dynamic variable with `{variable_name}`.** This is from the OpenAPI schema and has not
   been stored here yet. Task 7.1's read-back confirms it.
6. **ElevenLabs accepts a second workspace tool named `save_rsvp`.** Unknown. Task 1.1 shows it, and D6 covers both
   answers.

Measured, not assumed:
- An extra dynamic variable that is not in the placeholders is accepted: `kalfa_correlation_id` rides on every call.
- `APP_ORIGIN` is `https://beta.kalfa.me`.
- The three Mini calls hold no `save_rsvp` request in ElevenLabs' records.
- Tools are shared by branches, and a branch differs by `tool_ids`.

## Open Questions

- Does ElevenLabs allow two workspace tools with the same name? D6 covers both answers.
