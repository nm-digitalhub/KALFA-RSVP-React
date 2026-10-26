# Tasks

Every production step in this list needs the owner's approval at the time it runs:
- ElevenLabs tool and branch writes;
- every call;
- app deploy;
- scenario upload;
- the merge to Main.

Agent configs change only through `agents pull --update` → edit → `agents push` → `pull --update` (CLAUDE.md, Voice
Agent). Evidence for each Verify line goes in `verification.md` in this change.

## 1. Spike: does Mini call a webhook tool at all? (no code, no deploy)

- [ ] 1.1 Register a webhook tool with `elevenlabs tools add --type webhook`, then push it:
  - name `save_rsvp`, or `save_rsvp_server` if the name is refused (D6);
  - URL `https://beta.kalfa.me/api/elevenlabs/agent-tool/rsvp`, method POST, JSON content type;
  - body `status` (enum), `adults` and `children`, each LLM-filled with the client tool's descriptions;
  - `response_timeout_secs: 20` and `execution_mode: immediate`;
  - no header yet. The model's choice to call a tool does not depend on headers, and the route does not exist yet, so
    the call gets a 404.

  Verify with `agents_get_tool`: the stored config matches field by field, and no property has two value sources.
- [ ] 1.2 Rebase `test` onto Main (`agents branches rebase`). Replace the client `save_rsvp` id in the test branch's
  `tool_ids` with 1.1's id, and push to `--branch test`. Read back both branches. Verify, with a field diff of the test
  branch against Main v75 (`agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4`):
  - the only difference is that `tool_ids` entry, plus the prompt's tool name if 1.1 used `save_rsvp_server`;
  - traffic is Main 100%, `test` 0%.
- [ ] 1.3 One test call to the owner on the test branch, with approval:
  `npm run test-call:attempt -- … --confirm`, then `npm run bridge:call -- … --branch agtbrch_0901m5va14yres5b3tcxnzvcma0g
  --confirm`. Script: confirm attendance, give a headcount, answer "נכון" to the read-back. The agent will hear a tool
  failure; that is expected. Verify by recording:
  - the conversation's `tool_names` and `tool_names_errored`;
  - the transcript's `tool_calls`, with their parameters;
  - the tool's execution log;
  - what the agent said after the failure.
- [ ] 1.4 Read 1.3 and record the reading in `verification.md`:
  - **The webhook tool was called:** Mini calls server-side tools. Continue with group 2.
  - **No tool call:** stop. No code was written, nothing was deployed, Main is untouched. Re-attach the client
    `save_rsvp` on `test`, read it back, and record that the next step is the controlled Custom-mode call (D7).

## 2. Shared save handler and the webhook route (only after 1.4 says called)

- [ ] 2.1 Move the save logic of `src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts`, from the JSON parse to the
  three-state response, into `handleSaveRsvpToolCall(attemptId, raw)` in `src/lib/voximplant/save-rsvp-tool.ts` (D3).
  The bridge route becomes guard plus handler. Verify:
  - a unit test for each path: 400 on bad JSON or schema, 500 on an inbox failure, and `saved` / `rejected` / `queued`;
  - each test asserts the inbox row's `provider`, `event_kind` and dedupe key are unchanged
    (`vox-rsvp:{attemptId}:{valueHash}`);
  - the existing tests for the route still pass.
- [ ] 2.2 Add `guardAgentToolRequestByHeader(req, headerName, opts)` to `src/lib/voximplant/agent-tool-guard.ts`, on the
  same core as `guardAgentToolRequest` (D2). Verify, with unit tests:
  - absent, empty or over-256-character header → 404;
  - unknown token → 404;
  - expired token → 404;
  - limiter trip → 429 (fail-closed);
  - declared length over the cap → 413;
  - a valid token → the attempt id.
- [ ] 2.3 Add `src/app/api/elevenlabs/agent-tool/rsvp/route.ts` (POST, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`,
  `Cache-Control: no-store` on every response). It reads `X-Kalfa-Call-Token` through 2.2 with scope `el-rsvp-tool`,
  then calls 2.1. Verify:
  - route tests: no header → 404 with an empty body;
  - a valid header and body → 200 `{ok, status}`;
  - a body with an extra field (an identifier) → 400 and no inbox row;
  - the same values sent twice → one inbox row.

## 3. Keep the token out of stored post-call payloads

- [ ] 3.1 In `buildElevenLabsAnalysisRow` (`src/lib/data/elevenlabs-webhook-intake.ts`), store a copy of the payload
  with every `secret__*` key removed from `data.conversation_initiation_client_data.dynamic_variables` (D4). The input
  object is not mutated. Verify, with a unit test:
  - a payload carrying `secret__kalfa_tool_token` and `guest_name` is stored without the first and with the second;
  - the dedupe key and `message_id` are unchanged;
  - both the RSVP and the sales kinds use the stripped copy.

## 4. Bridge: supply the token variable on branch calls only

- [ ] 4.1 In `RSVPAgent.voxengine.js`, add a pure function next to `testBranchFrom`. It returns
  `{ secret__kalfa_tool_token: accessToken }` when the branch id is set and the token is non-empty, and `{}` otherwise.
  Spread the result into `dynamic_variables` (D5), and update the file header to describe the variable. Verify:
  - `rsvp-agent-tool-args.test.ts` cuts the function out and passes three cases: branch and token, no branch, empty
    token;
  - `node --check` passes on the file.
- [ ] 4.2 Update `docs/voice-agent/elevenlabs-json-reference.md`:
  - §6.2: a webhook tool is registered with `tools add --type webhook`, and its header is bound to a `secret__`
    variable;
  - §6.6: test calls carry the token variable; live calls do not until the merge.

  Verify: the commands in the doc are the ones used in groups 1 and 7.

## 5. Verify the code before any deploy

- [ ] 5.1 Run the focused tests from groups 2-4, then `npm run lint`, `npm run typecheck`, `npm run build` and the full
  test suite. Verify: all green, with the output recorded. A failing test is fixed, whatever its cause.

## 6. Deploy (each step with the owner's approval)

- [ ] 6.1 Deploy the app. Verify against `https://beta.kalfa.me/api/elevenlabs/agent-tool/rsvp`:
  - a POST without the header → 404;
  - a GET → 405;
  - the next stored `el_analysis_*` inbox row matches the intake test's behaviour.
- [ ] 6.2 Upload `RSVPAgent` (`npx voxengine-ci upload --application-name kalfa-rsvp.kalfarsvp.voximplant.com
  --rule-name OutCallAgent`). Never touch rule 1494311. Verify: the hash in `RSVPAgent.metadata.config.json` changed,
  and the deployed scenario text matches the local file.

## 7. ElevenLabs: arm the webhook tool

- [ ] 7.1 Add `request_headers` `{"X-Kalfa-Call-Token": {"variable_name": "secret__kalfa_tool_token"}}` to 1.1's tool,
  and push it. Verify with `agents_get_tool`: the header is stored with the variable binding, and the rest of the
  config is unchanged from 1.1.
- [ ] 7.2 Rebase `test` onto Main again if Main moved since 1.2, and repeat 1.2's diff. Verify: the same single
  difference.
- [ ] 7.3 Add the tool-call regression test for the webhook tool (`architect-create-tool-test`): the guest confirms the
  read-back, and the agent must call the save tool with `status: attending` and the confirmed counts. Run it on `test`.
  Verify: the run id and result are recorded, labelled as a text-model check, not voice evidence (`producing_llm`).

## 8. One test call that saves (owner's approval)

- [ ] 8.1 Same commands and script as 1.3. Verify, and record each item:
  - the conversation's `tool_names` contains the webhook tool;
  - its transcript shows the tool result `saved`;
  - the tool's execution log has the call;
  - one `webhook_inbox` row `vox-rsvp:{attemptId}:…`;
  - the guest row has the status and counts;
  - `call_analysis.rsvp_persisted` is true;
  - the session log shows `agent branch: agtbrch_…` and no `CLIENT_TOOL_CALL` for `save_rsvp`;
  - the stored post-call payload has no `secret__` key;
  - the audio is transcribed per §6.4.
- [ ] 8.2 Apply D7 and record the reading in `verification.md`:
  - **Saved:** go on to group 9.
  - **Not saved:** stop with Main untouched, and record which item in 8.1 failed.

## 9. Merge to Main and retire the client path (only after 8.2 says saved; owner's approval)

- [ ] 9.1 Merge `test` into Main (preview first, then `agents_merge_branch`). Read back. Verify:
  - Main's `tool_ids` hold the webhook tool and not the client `save_rsvp`;
  - traffic is Main 100%;
  - `agents pull --update` leaves `agent_configs/KALFA-RSVP.json` showing the same tool ids.
- [ ] 9.2 In one change:
  - remove the D5 condition, so the token variable rides on every call;
  - remove `save_rsvp` from `TOOL_ROUTES`;
  - delete `src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts`;
  - rename and redocument the shared handler for its single caller;
  - update the scenario header and the §6.2 tools list.

  Run group 5's checks, then deploy the app and upload the scenario with approval. Verify:
  - the old route answers 404;
  - the scenario hash changed;
  - the tests pass.
- [ ] 9.3 Place one call on Main, without `--branch`, with approval. Verify the same items as 8.1, on Main.
- [ ] 9.4 Unregister the client `save_rsvp` tool after `agents_get_tool_dependents` shows no agent or branch using it.
  Verify: `agents_list_tools` no longer lists it.

## Workflow follow-up

- If 1.4 reads "no tool call", this change stops after group 1. The controlled Custom-mode call belongs to
  `voice-test-environment`.
- Follow-up change: convert `mark_dnc` (legally critical), `notify_owner` and `schedule_callback` the same way once
  9.3 passes.
- Archive after group 9 is done and verified.
