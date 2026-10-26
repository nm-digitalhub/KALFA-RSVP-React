# Proposal

## Why

Since 25.10.2026 the KALFA RSVP agent's Main (v75) runs on Eleven Realtime v1 Mini. In all three voice calls since then
(`conv_7401m5t14826eed9ep15xgnjb1kg` on Main, `conv_3901m5vbp2tgfmms8xk4k3kpm26p` and `conv_9101m5vmq858fymasy24qpmd8hhn`
on the test branch), the agent told the guest "נרשם" / "נשמר" and never asked to run `save_rsvp`:

- the transcripts hold no tool call;
- the tool's ElevenLabs execution log is empty since 24.10;
- no `CLIENT_TOOL_CALL` reached the Voximplant bridge;
- the guest rows stayed `pending`, and `call_analysis.rsvp_persisted` is `false` on all three.

The only tool the agent called in those calls was `end_call`, a system tool that runs inside ElevenLabs. `save_rsvp` is
a client tool: ElevenLabs hands it to the Voximplant scenario, which forwards it to KALFA. There is no Mini voice call yet
in which the agent called a tool of either kind besides `end_call`.

The owner decided on 26.10.2026 to move the save to a **webhook tool**: ElevenLabs calls KALFA directly, the same way it
runs `end_call` on its own side, and the telephony bridge leaves the save path. Whether Mini calls a webhook tool is not
proven. One test call on the test branch decides it before anything reaches Main.

## What Changes

- **A server-side save endpoint for the agent.** `POST /api/elevenlabs/agent-tool/rsvp` takes the same body and gives
  the same three-state answer (`saved` / `rejected` / `queued`) as today's `/api/voximplant/agent-tool/rsvp/{token}`. It
  also keeps the same durable inbox row and the same `processCallRsvp` apply. The two routes share one handler.
- **The same per-call authorization, carried differently.** The call's opaque access token travels in a request header.
  The header is bound to a `secret__` dynamic variable, which ElevenLabs never sends to the LLM and returns redacted from
  its conversations API. Identity is the attempt that token resolves to. It is never the body, and never the
  non-authorizing correlation nonce.
- **The bridge supplies that variable.** `RSVPAgent` adds the access token to the conversation's dynamic variables. At
  first it does so only on calls placed to a test branch, so live calls stay exactly as they are until the merge.
- **The post-call store drops secret variables.** Post-call webhooks deliver `secret__` values in the clear, so they are
  removed from the payload before it is written to `webhook_inbox`.
- **A webhook `save_rsvp` tool on the test branch only.** A new workspace tool is attached to the RSVP `test` branch in
  place of the client `save_rsvp`. Otherwise the branch is Main v75 (Mini and Main's prompt), so the tool is the one
  difference under test. Main keeps the client tool until the merge gate.
- **After a proven merge, the client save path is retired.** That covers `save_rsvp` in the scenario's `TOOL_ROUTES`,
  the `/api/voximplant/agent-tool/rsvp/{token}` route and the client tool registration. **BREAKING** for anything still
  calling that route (only the RSVP bridge does).

Out of scope:
- `mark_dnc`, `notify_owner` and `schedule_callback`. They are client tools too. None of the three Mini calls needed
  them, so how Mini handles them is unknown, not shown to fail. `mark_dnc` is legally critical, so it is the first one
  to check.
- Meeting Confirm, Sales Close and the service agent.
- Whether the agents stay on Mini.

## Capabilities

### New Capabilities
- `voice-agent-rsvp-save`: how a guest's answer, given to the RSVP voice agent, reaches the guest's record. It covers
  the server-side save tool, its per-call authorization, the truthful three-state answer the agent hears, durable
  capture, and keeping the per-call token out of the LLM and out of stored post-call payloads.

### Modified Capabilities
<!-- openspec/specs holds no capability yet; voice-test-environment's capabilities are unarchived and unchanged here. -->

## Impact

- **Code:**
  - a new route `src/app/api/elevenlabs/agent-tool/rsvp/route.ts`;
  - the shared handler, extracted from `src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts`;
  - `src/lib/data/elevenlabs-webhook-intake.ts` (secret strip);
  - `RSVPAgent.voxengine.js` (one dynamic variable, branch calls only);
  - focused tests for each.
- **Deploys, each needing the owner's approval:** the app (route plus strip) before the test call, and the
  `RSVPAgent` scenario through `voxengine-ci upload`.
- **ElevenLabs:**
  - one new workspace webhook tool;
  - the RSVP `test` branch: its prompt reset to Main v75, and the client `save_rsvp` swapped for the webhook tool;
  - Main is unchanged until the merge gate.
- **Data:** no schema change. Inbox rows and dedupe keys are the same as the client path, so a save sent by both paths is
  written once.
- **Security:** a new public POST endpoint, with the same token model as the existing agent-tool routes. The token
  reaches ElevenLabs as a secret variable: redacted in their API, removed from our stored post-call payloads.
