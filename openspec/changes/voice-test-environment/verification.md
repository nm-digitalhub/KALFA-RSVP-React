# Verification

Evidence per task, recorded as each one is done. Nothing here was run against production unless it says so.

## Group 1 — ElevenLabs test branches (production, owner-approved 2026-10-26)

Each agent: the branch list read first (only Main, 100%, no draft), Main's head read with `branches get`
(`most_recent_versions[0].id`), `branches create` with `{name: "test", parent_version_id: <Main head>}`, then the list
and Main's head read again.

| Agent | Main head before = after | `test` branch | `test` first version | After: Main / `test` |
|---|---|---|---|---|
| RSVP `agent_9701…cexd48` | `agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4` | `agtbrch_0901m5va14yres5b3tcxnzvcma0g` | `agtvrsn_6501m5va14yqfq5bn1b849x6vcyr` | 100 / 0 |
| Meeting Confirm `agent_3601…g54b6` | `agtvrsn_3001m5t0aw2he9rsx7zpmhvvt41y` | `agtbrch_6101m5va22weedybftdaz8ye7557` | `agtvrsn_9401m5va22wdfb1vwckwaqrhc5v0` | 100 / 0 |
| Sales Close `agent_4101…60wrgtn` | `agtvrsn_5101m5t0b0dje8ws5hpqfggk8zhv` | `agtbrch_6401m5va2h4repp9s9z80n7y1avj` | `agtvrsn_9701m5va2h4qfs1vpqcpqgtac4jm` | 100 / 0 |
| Service `agent_8801…25h1q50` | `agtvrsn_0201m5t0aqz6f3497v27wr7cdmyp` | `agtbrch_0101m5va2tdne5mt363sqccwhz4f` | `agtvrsn_3801m5va2tdmfc282vtwqg6g221h` | 100 / 0 |

- **1.1 / 1.2** Every Main head before the create equals the `version_id` in `agents.json` and is unchanged after it;
  every agent then lists exactly Main at 100% and `test` at 0%.
- **1.3** `elevenlabs agents pull --agent <id> --update --yes` for all four ("1 updated" each): `git diff
  agent_configs/ agents.json` is empty. `agents.json` records each agent's Main `branch_id`; the `test` branches are not
  recorded there (RSVP's `branches` is `{}`, the others have none). The CLI addresses a branch with `agents push
  --branch <name|agtbrch_ id>`.
- **1.4** `docs/voice-agent/elevenlabs-json-reference.md` §6.6, "ענפי `test`": the four ids above, push-to-branch first,
  rebase before each cycle, no traffic percentage, per-agent settings only on Main, and that pull records Main only.

## Group 2 — test gates (ElevenLabs, owner-approved 2026-10-26)

**2.1 — the regression tests** (all on the RSVP agent; created with `agents tests create`, attached through
`agent_configs/KALFA-RSVP.json` `platform_settings.testing` → `agents push --branch agtbrch_0901…` → read-back →
`pull --update`, so Main and the repo still hold only `test_0401…`):

| Test | Type | Attached to `test` | Result on the `test` branch (Eleven Realtime v1 Mini) |
|---|---|---|---|
| A `test_7601m5vacdm7efparb43n307wzrd` "save_rsvp is called on confirmation…" | tool (`save_rsvp` status `attending`, adults `2`, children `1`) | yes | 2/3 pass, 1/3 fail: "שנייה, אני מעדכן... מעולה, זה נרשם אצלנו. יום נהדר!" then `end_call`, no `save_rsvp` (suite `suite_9601m5vaf5gxf3z9tdt3y15jvj42`); 1/1 pass in the baseline |
| B `test_0901m5vace2vewbsyw2y20hr904x` same, empty dynamic variables (the 25.10 conditions) | tool | no (D3 removes the condition) | 1/3 pass, 2/3 fail: once `end_call` without saving, once "נרשם" said and two tool calls (same suite) |
| C `test_0201m5vajf9ee2fs1kk9ttyddyv9` "no נרשם before save_rsvp returns" | llm (the reply must not say or imply the answer is recorded) | yes | 3/3 fail: "שנייה, אני מעדכן... מעולה, זה נרשם אצלנו. יום נהדר!" (`suite_5401m5vajvh6ea5axekqxwtzvth8`); 1/1 fail in the baseline |

So the 25.10 failure reproduces on the current configuration with real context: the agent says "זה נרשם אצלנו" in
the turn that calls (or skips) `save_rsvp`, before the tool returns. A alone misses the case where the claim and a
single save call share a turn; C covers it. The live Main runs the same configuration (only the attached tests
differ), so this is the behaviour guests get today.

An attempt to compare against Custom mode with `agent_config_override: {conversation_config: {realtime_model:
null}}` is **invalid and discarded**: the override replaced the whole `conversation_config` (the runs used
`gemini-2.5-flash` and called no tool), so it measured a default agent, not the pre-Mini one
(`suite_8001m5vahbejfcaavcgp4bj4mhsf`).

**Max on the `test` branch (owner-approved 2026-10-26).** `realtime_model` set to `eleven_realtime_v1_max` on
`test` only (version `agtvrsn_6901m5vaz05ye17s4b70nfbt67e0`; Main read back on Mini, 100%, version unchanged); A, B, C
×3 each (`suite_4401m5vazhene979ttp5ht8kq6ts`, every run billed to `eleven_realtime_v1_max`): **9/9 fail**. Every run
says "שנייה, אני מעדכן... מעולה, זה נרשם אצלנו. יום נהדר!" and calls `save_rsvp` and `end_call` in the same turn
(once `end_call` alone). The `test` branch was then returned to Mini (`agtvrsn_5601m5vb0veefb7vy63qf5apqrc1`, three
tests attached; Main unchanged).

So the model is not the cause. The sentence both models say is the prompt's own step 5 + step 6 merged into one turn:
step 5 "אמור משפט גישור קצר: 'שנייה, אני מעדכן...', וקרא ל-save_rsvp", step 6 "תור מדובר אחד ויחיד שמכיל גם את
תוצאת save_rsvp וגם את משפט הפרידה החם (למשל: 'מעולה, זה נרשם אצלנו. יום נהדר!'), ומיד אחריו קרא ל-end_call". The
fix belongs in the prompt, tested on the `test` branch.

**Prompt fix on the `test` branch (owner-approved 2026-10-26), Mini.** Pull → edit
`conversation_config.agent.prompt.prompt` → `push --branch` → read-back (branch prompt equals the intended text; Main
prompt and version `agtvrsn_1601…` unchanged) → `pull --update`.

- Fix 1 (`agtvrsn_6701m5vb45mqfdcs5z1844q08xq6`): step 5 "בתור הזה אמור רק 'שנייה, אני מעדכן...' וקרא ל-save_rsvp";
  step 6 only after the tool returned, literal example farewell removed; the `save_rsvp` result rule and `end_call`
  (never in the same turn as `save_rsvp`). Suite `suite_5001m5vb4nd2e6390dzy2mmtmj80`: C 3/3 pass; A 0/3, B 0/3 —
  the agent says "שנייה, אני מעדכן..." and calls no tool.
- Fix 2 (`agtvrsn_5401m5vb62yrf8hvfv2bynr7b3qc`): step 5 "בתור הזה חובה לקרוא ל-save_rsvp… תור שאומר 'שנייה, אני
  מעדכן...' בלי לקרוא ל-save_rsvp הוא טעות". Suite `suite_1901m5vb6rsdfy3txj36q8k81bwt`: identical — C 3/3, A 0/3,
  B 0/3, no tool call.

Not yet known whether "no tool call after the bridge sentence" is the agent's behaviour or how a single-turn unit test
records a turn whose speech and tool call arrive separately (with the original prompt the passing runs recorded the
sentence and the `save_rsvp` call as two responses). A real call on the branch (5.4) answers it. The `test` branch is
left on fix 2; Main is untouched.

**2.2 — baseline of every attached test on each `test` branch** (`run-tests` with `branch_id`, `repeat_count` 1):

| Agent | Suite | Result |
|---|---|---|
| RSVP | `suite_4001m5vatkyvfp293a3ke0x0xp58` | `test_0401…` (simulation) fails: "Unsupported client tool" — it has no mock for the client tools; A passes; C fails (above) |
| Meeting Confirm | `suite_6701m5vatn4bfgevr09hhyw397cn` | all 3 fail: "Missing dynamic variables" — the tests carry none of the variables the agent needs |
| Sales Close | `suite_8201m5vatpczempbcj23knbdxfc4` | `test_2501…` fails: the agent asked a qualification question instead of calling `get_pricing` |
| Service | — | no attached tests |

Every test that existed before this change fails for a reason of its own (a missing mock, missing variables, one
behavioural failure), so the D7 gate "every attached test passes on the branch" cannot pass today on any agent. Fixing
those tests is outside this change and is listed as a follow-up.

## Groups 4–5 — the test event, the deploy and the first branch call (owner-approved 2026-10-26)

- **Test event (4.1/4.2):** the owner named event `5aaf0363-2a66-4d13-8c65-439acdc8224b` (staff-owned, `active`,
  2026-10-31, one guest whose contact number is the `VOX_TEST_NUMBERS` number, campaign `approved` with no `start_at`,
  0 attempts, 0 billed). `approved → active` happens only after a recorded payment (`activateCampaignAfterPayment`)
  or a manual `activateCampaign`, so the worker never dials it. Marked with `mark_test_event` → `marked`
  (`test_events.marked_at` 2026-10-26 05:39:31Z). `test_event_purge_blocker` = `approved_terms`: the existing purge
  refuses this event (an approved campaign's pricing round is kept history), so its rows stay.
- **Deploy (5.4, first half):** `npm run vox:upload -- --rule-name OutCallAgent` (dry run first: only `RSVPAgent`
  built). Scenario 920395 updated, modified 2026-10-26 05:41:04; the script read back from the platform equals the
  local file ignoring whitespace (the build re-indents) and passes `node --check`. Rule 1494311 not touched.
- **Branch call B:** attempt `cde845bd-b82a-4fd0-a803-c185c2311b45` (`npm run test-call:attempt`), `bridge:call
  --branch agtbrch_0901…`, `script_custom_data` 156 bytes, session 9779702974, conversation
  `conv_3901m5vbp2tgfmms8xk4k3kpm26p`. The conversation ran on `branch_id` `agtbrch_0901m5va14yres5b3tcxnzvcma0g`,
  version `agtvrsn_5401…` (fix 2), with the event's real dynamic variables (ctx 200). **`save_rsvp` was never called:**
  after the confirmed readback the agent said "שנייה, אני מעדכן...", the guest stayed silent, and the next agent turn
  was "מעולה, זה נרשם אצלנו במערכת. תהנו מהחתונה!" followed by `end_call`. The attempt closed `completed`,
  `agent_end_call`, 134 s; `rsvp_outcome` null; the guest is still `pending`. So the unit-test result for fix 1/2 (bridge
  sentence, no tool call) is the agent's real behaviour, and the next turn invents the result. Also seen: a premature
  "שנייה, אני מעדכן..." after "כן, מגיעים" (before the counts); "אני מעביר את זה למשפחה" without `notify_owner`; the
  opening "בנוגע לחתונה של החתונה של …" (the event name already starts with its kind). Audio not yet transcribed
  (§6.4).
- **Re-check after the call (2026-10-26 ~05:52Z).** The server never received a save: `webhook_inbox` for the attempt
  holds only `recording_started` and `completed` (no `call_rsvp` row); the guest is `pending`, 0/0. **The test
  campaign is no longer unactivated:** `campaign.activated` at 05:40:27Z by `actor: system` with a
  `paymentOperationId` (a payment was recorded for it, a minute after the 05:39 check that read `approved`); the
  worker then sent a WhatsApp template to the guest at 05:40:39Z and `outreach_state` is `active`. So D5's "never
  activated" no longer holds for this event: the worker's own schedule now reaches the test guest too (through Main).
  The completed test call wrote a billable `contact_interactions` row but no `billed_results` row.
- **The agent, the tool and the bridge read in full (2026-10-26).** `save_rsvp` (`tool_1501…`, client,
  `expects_response: true`, `execution_mode: immediate`, `pre_tool_speech: auto`, required `status`/`adults`/`children`)
  and the scenario's `ClientToolCall` router (`RSVPAgent.voxengine.js:1466-1630`) are sound: 18 `call_rsvp` rows have
  reached the server (`webhook_inbox`, last 2026-09-07), although `client_events` never listed `client_tool_call` (git
  history of `agent_configs/KALFA-RSVP.json`). The session log of 9779702974 has `agent branch: agtbrch_0901…`,
  `Context response: 200`, one `AGENT_TOOL_RESPONSE: end_call` and **no `CLIENT_TOOL_CALL`**: the model never asked
  to save. Completed agent calls since 2026-09-01: 06.09 (1, not saved), 07.09 (2, both saved), 25.10 (1, not saved),
  26.10 (1, not saved). Between the last saves and the two failures, two things changed: the prompt (2026-10-07,
  `3046f622`, step 6 "one spoken turn with the save result and the farewell, e.g. 'מעולה, זה נרשם אצלנו. יום נהדר!'")
  and the model (Eleven Realtime v1 Mini, 2026-10-25). Not yet separated.

## Root cause of the missing `save_rsvp` (investigated 2026-10-26, owner: "תחקור מה הסיבה")

- **Working pattern (07.09, Custom mode, `claude-haiku-4-5`):** after the guest's "נכון", one agent run (one
  `source_event_id`) produced, in order: "שנייה, אני מעדכן..." → `save_rsvp` → result `saved` → "מעולה, זה נרשם אצלנו
  במערכת" → `end_call` (`conv_3001m1xxjh80f938yh3jenrpb3xc`; same shape in `conv_8101m1ye5g97evc8g7b8xj8fmdz3`).
- **Broken pattern (26.10, Realtime Mini, `producing_llm: eleven_realtime_v1_mini`; this call ran the fix-2 prompt
  on the test branch — the original prompt's shape is in the flow map below, 25.10):** after "נכון" the run produced
  only "שנייה, אני מעדכן..." — no `convai_llm_tool_request_generation_latency`, no tool call — and ended. The next run,
  started by the guest's silence, said "מעולה, זה נרשם אצלנו במערכת". Same at 54 s after "כן, מגיעים". The script's
  step 5 ("אמור משפט גישור קצר … וקרא ל-save_rsvp") assumes the model keeps going after it speaks, which the Custom
  pipeline did and Mini, here, did not.
- **Hypothesis test (one line):** the live prompt with only step 5 changed to "קרא מיד ל-save_rsvp, בלי לומר שום דבר
  לפני הקריאה" (`test` version `agtvrsn_1201m5vcsddpf7jsw73fvch52hab`, `suite_9701m5vcsxv2ee8r7ez6346t80ay`): A 3/3
  pass (save first, then the result sentence), against 2/3 with the bridge sentence and 0/3 when fixes 1–2 stressed it.
  B (no context) 1/3. C "fails" 3/3 only because the reply comes after the harness's own tool result
  (`"testing_tool_result","status":"success","reason":"Skipping tool call in test mode"`): the order is right; C must be
  rewritten with a tool mock (e.g. `rejected`) to test honesty after the result.
- **Limit of the tests:** test runs are billed as `eleven_realtime_v1_mini` but their `producing_llm` is
  `qwen36-35b-a3b` (Max: `gemini-3.7-flash`); the real call's `producing_llm` is `eleven_realtime_v1_mini`. The tests are
  a text proxy, so the hypothesis is confirmed only after a real call on the branch.

## Flow map of one `save_rsvp` (owner: "תקרא תיעוד ותבצע מיפוי מדויק של תהליך הזרימה", 2026-10-26)

Tags: **[M]** measured here, **[D]** stated by vendor docs, **[I]** inferred. Docs read in full: ElevenLabs "Client
tools", "Client events", "Tool interruptions", "Tool Call Sounds", "Realtime models"; the `ClientToolConfig` /
`ToolExecutionMode` / `PreToolSpeechMode` schemas in the API spec; Voximplant `voxengine.d.ts` (`AgentsEvents`,
`clientToolResult`). Code read: `RSVPAgent.voxengine.js` lines 1053–1629, `agent-tool/rsvp/[token]/route.ts`.

1. The guest says "נכון". ElevenLabs ASR commits a `user_transcript`, and turn detection (`turn_v3`, eagerness
   `normal`) ends the user turn. [M: transcript entries, agent config]
2. The model generates **one response** for that turn. Docs: a response may carry speech and tool calls;
   `agent_response_complete` "fires when the agent has finished its response, including any pending tool calls. After
   this event, the agent will only produce further output if the user provides new input or a turn timeout triggers a
   new turn." [D: Client events]
3. **The break point.** The tool request must be in that same response. [M] Custom mode (07.09, `claude-haiku-4-5`):
   one generation yields the bridge text plus the `save_rsvp` request. The transcript splits them into two entries that
   share a `source_event_id`, and the LLM usage (94 output tokens) is on the tool entry. Realtime Mini, voice: in
   **both** real Mini calls, **no** response carried both speech and a tool request. 25.10 (Main, original prompt,
   `conv_7401m5t14826eed9ep15xgnjb1kg`) had 11 speech-only responses and 1 tool-only (`end_call`). 26.10 (test branch,
   fix-2 prompt `agtvrsn_5401m5vb62yrf8hvfv2bynr7b3qc`, `conv_3901m5vbp2tgfmms8xk4k3kpm26p`) had 15 speech-only and
   1 tool-only (`end_call`).
   - 25.10, original prompt: one response said "שנייה, אני מעדכן... מעולה, זה נרשם אצלנו. יום נהדר!" (28 tokens) with
     no tool, twice: at 32 s, before any headcount, and at 81 s. That is the false claim in one breath.
   - 26.10, fix-2 prompt: the response was only "שנייה, אני מעדכן..." (10 tokens), and the response ended.
4. If no tool request was emitted, steps 5–8 never happen. Nothing reaches Voximplant: there is no `CLIENT_TOOL_CALL`
   line in session 9779702974. [M]
5. With a tool request: ElevenLabs sends `client_tool_call` {tool_name, tool_call_id, parameters}. Voximplant raises
   `ElevenLabs.AgentsEvents.ClientToolCall`, and the scenario logs `CLIENT_TOOL_CALL` (line 1474). [D: Client events;
   typings 6277] [M: code]
   - Tool settings: `expects_response: true` blocks the conversation until the result arrives, up to
     `response_timeout_secs: 20`. `execution_mode: immediate` executes right away when the model requests it.
     `interruption_mode: disable_during_tool_and_turn` blocks barge-in during the tool and the reply after it.
     [D: schema / Tool interruptions] [M: `tool-save_rsvp.json`]
6. The scenario validates the arguments (`TOOL_ROUTES.save_rsvp.body`; no status → `invalid_arguments`, nothing sent).
   It then POSTs to `/api/voximplant/agent-tool/rsvp/{token}`. [M: code 1540–1571]
7. Server path: `guardAgentToolRequest` (token → attempt; rate limit; body cap) → Zod → durable `webhook_inbox` row,
   with a dedupe key per distinct answer → synchronous `processCallRsvp` → `{ok, status: saved|rejected|queued}`. Any
   non-200 reaches the agent as `error`. [M: route.ts]
8. The scenario answers with `clientToolResult({tool_call_id, result: saved|rejected|queued|error, is_error:false})`.
   Omitting `is_error` closes the WebSocket with 1008 (measured earlier). ElevenLabs appends the result to the
   context, and the model speaks the result sentence, then calls `end_call` (07.09 pattern). [D: Client tools] [M: code]
9. **Where the false "נרשם" enters, per prompt:**
   - Original prompt: in the step-3 response itself, with no save and no timeout.
   - Fix-2 prompt: after step 3 ended, `turn_timeout` is 4 s. The platform inserted a `user_turn_timeout` turn ("...",
     `platform_event: user_turn_timeout` at 60, 96 and 116 s). The model answered that turn fresh, said "נרשם", and
     there was no tool result in its context. [M]
   - 25.10 also shows the same timeout turn at 42 s and 97 s.
10. Observability gap. The scenario does not see "response ended without a tool":
    - Voximplant's `AgentsEvents` has no named `agent_response_complete`.
    - The agent's `client_events` does not enable it.
    - [M: typings 6255–6320, config]
    - Correction after reading the Voximplant ElevenLabs API reference in full (2026-10-26): `AgentsEvents.Unknown`
      exists as a provider-specific catch-all, so an enabled `agent_response_complete` would plausibly arrive there.
      [I, unverified]
    - No KALFA scenario listens to `Unknown`, `HTTPResponse`, `InternalTentativeAgentResponse` or `ContextualUpdate`.
      So `agent_chat_response_part`, which IS enabled in `client_events`, is dropped unseen today. [M: grep] [I: that
      it arrives as `Unknown`]
    - Voximplant's "Example: Function calling" (read in full) calls `clientToolResult` without `is_error`. ElevenLabs'
      client-events example includes it, and omitting it was measured to close the WebSocket with 1008 (session
      6760041670). The scenario follows ElevenLabs here, not the Voximplant example.
    - The Voximplant connector only relays the agent's tool request, so nothing in its docs changes step 3.

Further docs read in full (2026-10-26, owner: "האם אתה קראת את כל התיעוד ואיתרת את הסיבה?"):
- **ElevenLabs "OpenAI Realtime API compatibility" FAQ** [D]:
  - Realtime models are cascaded, not fused.
  - "The specifics of the underlying models aren't public."
  - So WHY Mini does not follow speech with a tool request cannot be learned from the docs. Only the behaviour can be
    measured (step 3).
- **ElevenLabs "Prompting guide"** [D]:
  - "prompts over 2000 tokens increase latency and cost".
  - "model-specific tuning can improve performance—particularly for tool-calling format".
  - Its refund example sequences a tool as "Confirm … Wait for customer confirmation … Call this tool", with no speech
    before the call.
  - The RSVP prompt reads as about 8,576 cached input tokens per turn on Mini [M: `input_cache_read` on the 25.10
    call].
- **"LLM cascading"** [D]: a Realtime agent falls back to a backup LLM only if the Realtime model does not respond in
  time. Every turn in both Mini calls reports `producing_llm: eleven_realtime_v1_mini`, so no fallback ran [M].
- **Not read yet:**
  - ElevenLabs: "End call", "Skip turn" (downloaded), the Agent WebSocket API reference, Workflows, Agent testing.
  - Voximplant: "Placing an outbound call" (downloaded).

Remaining docs read in full (2026-10-26, owner: "תקרא גם את שאר התיעוד"):
- ElevenLabs: End call, Skip turn, System tools, Conversation flow, Client to server events, Agent WebSocket API
  reference (full AsyncAPI), Agent Testing, Simulate Conversations (deprecated), Workflows, and the Eleven Realtime
  sections of Models.
- Voximplant: Placing an outbound call.

Findings:
- **Models page** [D]:
  - Mini is "optimized for fast, natural conversation" for "AI assistants / Educational tutors / Interactive
    characters".
  - Max is for "Customer support … Lead qualification … Multi-step workflows: Tasks that call tools to look things up
    or take actions".
  - In the voice-agents summary, "Tool calling for lookups and actions during a conversation" is listed under Max
    only.
  - Together with Realtime models ("Choose … Max … when the agent … relies on multi-step tool calls, and Mini's
    responses aren't good enough"), ElevenLabs does not position Mini for an agent whose core job is a tool action.
    That is positioning, not a stated limit.
  - Max was only tried on the text proxy (9/9 "נרשם" with parallel `save_rsvp` + `end_call`), never on a voice call.
- **Workflows, "Dispatch tool node"** [D]: "tool nodes are dedicated execution points that guarantee the tool is
  called", with success / failure edges.
  - This is the only documented mechanism that makes the save independent of the model choosing to call it.
  - Unknowns [I]: whether it accepts a client tool (the docs' example is a webhook), and how its parameters are filled.
  - Realtime forbids workflow overrides of managed settings, not tool nodes.
- **Agent WebSocket API reference** [D]:
  - `client_tool_result` requires `tool_call_id`, `result` (string) and `is_error`. This confirms the scenario and
    contradicts Voximplant's example.
  - The server also has `agent_tool_request` (every tool the agent requests, with `execution_mode`), `context_usage`,
    `agent_response_complete`, and `audio.is_final`.
  - None is enabled in `client_events`, and none has a named Voximplant event.
  - `conversation_initiation_client_data` also accepts `branch_id`.
- **Voximplant outbound example** [D]: it logs `AgentsEvents.Unknown` and `HTTPResponse`. RSVPAgent logs neither [M].
- **Conversation flow** [D]:
  - "Take turn after silence" is how long the agent waits before "taking the next turn and prompting for a response".
    That is the `user_turn_timeout` turn in step 9.
  - The docs suggest 5–10 s for customer service; the RSVP agent uses 4 s [M].
  - Soft timeout is the platform's own filler while the LLM is slow, and the docs say to avoid "One second…" style
    fillers. The RSVP agent has soft timeout off [M] and instead has the model speak "שנייה, אני מעדכן…" itself.
- **Agent Testing** [D]: says nothing about which model runs a test for a Realtime agent. The `qwen36-35b-a3b` proxy
  stays a measurement only [M]; `qwen36-35b-a3b` appears in the API's own LLM enum.
- **No document** explains why Mini emits no tool request after speech. "The specifics of the underlying models
  aren't public."

`save_rsvp` execution log (2026-10-26). Trigger: an owner-pasted analysis citing "Tool execution was abandoned because
the call ended before the tool could complete". Read via the tool-executions API, 20 rows, no further pages [M]:
- **The 2 abandoned rows are old.** They were on 2026-07-15 at 14:12 and 15:15 UTC (`conv_9901kxk1tek4en3ac0d0xap94wp9`,
  `conv_6501kxk5e26cfcbba15c6k8ay17c`).
  - Commit `d196af4d`, "add required is_error to clientToolResult (fixes WS 1008 kill)", landed the same day at
    15:21 UTC, minutes after the second one.
  - That is the E-12 bug: the result frame without `is_error` closed the WebSocket.
- **Every row since is a completed execution.** There are 18 rows, all `is_error:false`, with results
  `saved` / `rejected` / `queued`. The last is 2026-09-07 17:22 UTC.
- **None on 25.10 or 26.10.** This independently confirms step 3: the Mini calls never requested `save_rsvp`, so
  there was nothing to abandon.
- **On the three causes the pasted analysis suggests:**
  - "Client sends no result": refuted by the 18 completed rows.
  - "Call ended mid-tool": no tool was requested on the Mini calls.
  - "Use a webhook tool": a webhook changes who executes the save, not whether the model requests it, so it would not
    fix step 3. [I]

## H1 on a real call — FAILED (owner-approved, 2026-10-26 08:19 UTC)

Read-back before the call [M]:
- Test branch head `agtvrsn_1201m5vcsddpf7jsw73fvch52hab`, `eleven_realtime_v1_mini`.
- The prompt equals `prompt-h1.txt`, apart from a trailing newline.
- Main's head is unchanged (`agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4`).

The call [M]:
- Attempt `ed05a7f6-4cbb-41c6-a7b1-ec6d65e853db` (test event, touchpoint 900001), session 9779984054,
  `conv_9101m5vmq858fymasy24qpmd8hhn` (test branch, H1 version), 50 s.
- After the read-back "אז שני מבוגרים ואפס ילדים, נכון?" → "נכון", the agent said "מעולה, זה נשמר אצלנו. יום נהדר!" with
  **no `save_rsvp` request**. It called `end_call` after the guest's "תודה".
- `tool_names: [end_call]`; the session log has no `CLIENT_TOOL_CALL`.
- The guest is still `pending`, there are 0 `billed_results` rows for the event, and the attempt closed
  `completed:agent_end_call`.

What this shows:
- **The text-proxy tests (A 3/3) did not predict the voice model.** This is the caveat recorded above, now measured.
- **Three prompt variants (fix 1, fix 2, H1) all failed on voice Mini.** Across the three real Mini calls there were
  0 `save_rsvp` requests. The last Mini-era execution in the tool log is 2026-09-07, from Custom mode.
- **Per the debugging discipline (three failed fixes), prompt wording is not the lever. Stop prompt iteration.**

Live exposure [M, read-only]:
- Main (100% traffic) is Mini on the original prompt.
- Two non-test campaigns are `active` and one is `approved`, all with `allowed_channels {whatsapp,call}`.
- Since the switch (2026-10-25 16:00 UTC), only 3 `call_attempts` exist, all of them the owner's test calls. So no real
  guest RSVP has been lost yet.
- The next AI call on those campaigns runs on Mini.

What setting `realtime_model` back to null would restore [M]:
- Commit `971e3471` added only `realtime_model` (plus server-shape defaults), so null brings back the stored Custom
  settings: `claude-haiku-4-5`.
- The prompt has changed since the last saves (07.09): `3046f622`, 07.10, made the result and farewell one turn. TTS
  also moved to `eleven_v4_turbo` (`da358223`, 16.10).
- There were no RSVP-agent conversations between 2026-09-07 and 2026-10-25. So "Custom mode + today's prompt" has
  never run a real call, and one test call on Main must follow any restore.
- The same commit moved Meeting Confirm, Sales Close and Service to Mini. Their live tool use is a follow-up check.

Also noted:
- The 25.10 call ran with **every dynamic variable empty**: the opener was "בנוגע ל של . … מדבר עם ?", and the model
  invented a family name, a guest name and a date. That is the case D3 now refuses to dial. [M]
- [D] Parallel tool calls is a managed setting in Realtime mode. That fits Max sending `save_rsvp` + `end_call`
  together, but only in text-proxy tests.
- Open question, not a cause: what `pre_tool_speech: auto` does in Realtime mode. The schema says only "decides based
  on recent tool latency". [D]
- Tool-level settings (`pre_tool_speech`, `execution_mode`, `interruption_mode`) live on the workspace tool, which
  both branches share. Changing them changes Main. [M]
- [I] Every voice Mini tool request so far came in a response with no speech. H1 ("קרא מיד ל-save_rsvp, בלי לומר שום
  דבר לפני הקריאה") puts the save in exactly that kind of response. That is why it is the hypothesis to confirm with a
  real call.

## Group 3 — launcher and test-attempt helper (local code, 2026-10-25)

- **3.1** `parseTestBranch` and `BRANCH_ID_PATTERN` in `src/lib/voximplant/dial-preconditions.ts`; tests in
  `dial-preconditions.test.ts` (`parseTestBranch`): absent → Main, the live 36-character id accepted, a bare flag, an
  agent id, an empty id, upper case and an injected quote refused.
- **3.2** `bridge-call.ts --branch`: parsed with `flag()` (a bare `--branch` is refused) before `getCallAttemptById`;
  the payload is built and measured against `CUSTOM_DATA_CAP_BYTES` before the nonce is stamped (source-guard tests).
  `bridgeLaunchPayload` with the live 36-character branch id stays within 200 bytes (test). `buildScriptCustomData`
  is unchanged; the only diff in `src/lib/data/outreach-calls.ts` exports `CALL_TOKEN_TTL_SEC` for the helper.
- **3.3** `--allow-closed-event` removed; `closedEventDialMessage` names `npm run test-call:attempt`. `grep -rn
  allow-closed-event scripts docs src` finds it only in §6.6 (recorded as removed), the 2026-07-21 QA record (two
  historical lines plus a dated removal note) and the two test assertions of its absence.
- **3.4** `scripts/voximplant/test-call-attempt.ts` + `npm run test-call:attempt`; refusals in `testAttemptRefusal`
  (tests: not marked, closed event, guest count ≠ 1, number off the allowlist). Without `--confirm` it writes nothing.
  Both launchers bundle with the npm scripts' esbuild flags.
- **3.5** Launcher header and `docs/voice-agent/elevenlabs-json-reference.md` §6.6; every documented flag exists in
  the script it is documented for.

## Group 5 — RSVPAgent scenario code (local, not deployed, 2026-10-25)

- **5.1** `testBranchFrom` (top level, pure); `state.branchId`; `agentParams.branchId` set only when present;
  `AgentsClientParameters.branchId?: string` is at `typings/voxengine.d.ts:6688`. Tests: brace-extracted function
  (valid, absent, agent id, empty, number, upper case) and the conditional assignment.
- **5.2** `ctxDecision` + `refuseWithoutContext`: non-200 → `ctx_<code>`, unparseable/empty/array/string body →
  `ctx_unparseable`, no URL or request failure → `ctx_unavailable`; each posts `call_status: 'failed'` with the
  refusal as `error_reason` and terminates. `proceedToDial()` appears once in the ctx step, after `var ctx =
  decision.ctx` (source guard). Header comments (customData list, the old "never drops the call" sentence) rewritten;
  `scripts/voximplant/test-call.ts` notes that its fake token now makes RSVPAgent refuse.
- **5.3** `saveRsvpResult`: `saved`/`rejected`/`queued` pass; `pending`, `failed` and no status → `error`; the
  save_rsvp reply uses it (source guard).
- **Red first:** the new tests run against the scenario at `HEAD` fail at load (`RSVPAgent.voxengine.js no longer
  contains: function testBranchFrom(customData)`); against the change they pass.

## Checks behind D3, D4 and D5 (read-only, 2026-10-25)

- **D4 — the save route's statuses.** `src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts` answers 200 only
  with `status` ∈ {`saved`, `rejected`, `queued`}: `processCallRsvp` returns `RsvpApplyOutcome` (`saved` |
  `rejected`; a re-confirm of the same answer is `saved` with `unchanged`), and a throw becomes `queued`. Every other
  outcome is a non-200. So `saveRsvpResult`'s `error` branch is never reached by a real save. Pinned by the test
  `passes every status the save route can answer 200 with` (a `Record` over `RsvpApplyOutcome['status'] | 'queued'`,
  which fails typecheck if the server gains a status).
- **D3 — the ctx rate limit.** `src/app/api/voximplant/ctx/[token]/route.ts` limits `vox-ctx:<token
  fingerprint>:<ip>` at 12 per 5 minutes: per token, so calls sharing Voximplant's egress IPs do not share a budget,
  and a call fetches ctx once.
- **D3 — who else starts the RSVPAgent rule (1520915).** Of the `startScenarios` callers, only
  `src/lib/data/outreach-calls.ts` (the worker: always `tok` + `u`), `scripts/voximplant/bridge-call.ts` and
  `scripts/voximplant/test-call.ts` (manual `--rule`, fake token: now refused, noted in its header) reach it.
  `call-me-now` and the purpose, meeting-confirm and sales-close dispatchers use their own rules;
  `probe-scenario-binding.ts` does not start a scenario.
- **D5 — a never-activated campaign.** Saving does not read the campaign (`processCallRsvp` → `submit_rsvp` checks
  the event). The completed-call drain calls `writeReach` → `try_record_billed_result`, which returns `not_active`
  (no row, no throw) for a campaign that is neither `active` nor `paused`; the live definition contains that branch
  (`select position('''not_active''' in pg_get_functiondef(...)) > 0` → true). So a test call records no reach and no
  charge, and the drain does not error.

## Gates run so far

- `npx vitest run src/lib/voximplant/rsvp-agent-tool-args.test.ts src/lib/voximplant/dial-preconditions.test.ts
  src/lib/data/outreach-calls.test.ts`: 3 files, 124 tests passed (after the D4 pin).
- `npm run typecheck`: exit 0 (`scripts/` is inside its `include`).
- `npx eslint` on every changed TypeScript file: exit 0.
- `node --check` on `RSVPAgent.voxengine.js`: syntax OK.
- `npm run build` and `npm run lint` (full): not yet run — task 6.1.

## Test branch switched to Eleven Realtime v1 Max (owner, 26.10.2026)

- **Owner instruction:** "תעביר את הבוט ל-Max בגרסת הבדיקה".
- **Before the change (read):**
  - test branch `agtbrch_0901m5va14yres5b3tcxnzvcma0g` at `agtvrsn_1201m5vcsddpf7jsw73fvch52hab`;
  - `realtime_model: eleven_realtime_v1_mini`;
  - `max_tokens: -1` (no limit, as Max requires);
  - workflow: start node only.
- **The change:** one-field PATCH with `branch_id`, `{"conversation_config":{"realtime_model":"eleven_realtime_v1_max"}}`. It returned HTTP 200 and the new version `agtvrsn_5201m5w1x4g3ej6rqtrr3ywbejx3`.
- **Read back, test branch:**
  - `realtime_model: eleven_realtime_v1_max`;
  - `tool_ids` unchanged: client `save_rsvp`, `mark_dnc`, `notify_owner` and `schedule_callback`;
  - the prompt is byte-identical to the H1 prompt.
- **Read back, Main:**
  - unchanged at `agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4`, still `eleven_realtime_v1_mini`;
  - traffic: Main 100%, `test` 0%.
- **Not done:** no call has been placed on Max yet. `agent_configs/` tracks Main only (§6.6), so there is no local file change.

## Review of the test-branch settings and script — gaps checked (26.10.2026)

Sources:
- the test-branch config at `agtvrsn_5201m5w1x4g3ej6rqtrr3ywbejx3`;
- the transcripts of the three Mini calls;
- the audio of the morning call (session 9779702974), transcribed with Scribe v2 in two channels;
- the docs `conversation-flow`, `personalization/dynamic-variables` and `realtime-models`;
- live DB counts.

**Confirmed:**
- **Example sentences are copied verbatim.**
  - Prompt line 43's "מעולה, זה נרשם אצלנו. יום נהדר!" (or line 71's "…במערכת") is the success line spoken in all three calls without a save.
  - Line 22's "שני מבוגרים, מעולה. וילדים?" became "שני מבוגרים, וילדים?" right after a bare "כן" (conv_9101), and "שני מבוגרים, נכון?" in the Main simulation, with no count given.
- **The bridge phrase is said with no tool call, and the turn timeout then produces the "נרשם".** In the morning call (conv_3901):
  - at 54 s, "שנייה, אני מעדכן..." came before any headcount, with no tool call;
  - at 110 s, the same phrase after "נכון", again with no tool call;
  - each was followed by a `user_turn_timeout` about 6 s later in the transcript (4 s `turn_timeout`), after which the agent continued with "מעולה, זה נרשם אצלנו במערכת".
  - In the audio, the phrase is followed by 6.4 s of silence (60.3 → 66.7 and 116.6 → 123.0).
- **notify_owner is claimed without the tool.** At 36 s the agent said "אני מעביר את זה למשפחה", and that turn has no tool call. The same speak-instead-of-tool pattern now shows on a second client tool.
- **The opening line doubles the event noun.** The first message `בנוגע ל{{event_kind}} של {{event_name}}` gave "לחתונה של החתונה של אורית ודניאל" in both calls today, and the agent repeated it at 12 s. Events whose title already contains the kind noun: 3 of 10, and 1 of 5 active, which is the test event (`test_events`).
- **Prompt line 13's "{{guest_name}} מנוקד" is false.** The ctx route sends the trimmed raw name (`ctx/[token]/route.ts:184`); no niqqud is added.
- **The time sources contradict each other.**
  - Line 95 uses `{{system__time}}` (local, formatted) and "leave empty if unsure".
  - The `schedule_callback` description uses `{{system__time_utc}}` (ISO) and "do not leave empty, ask".
  - The docs also advise setting a timezone rather than placing time variables in the prompt: they change every minute or every turn and defeat prompt caching. The timezone is already set (`Asia/Jerusalem`).
- **Line 75 contradicts line 77.** Line 75 says "one result sentence in the whole conversation"; line 77 makes a correction re-save, which gives a second result.
- **The `rsvp_captured` evaluation was fooled.** The 25.10 rationale says "למרות שלא הוצגה קריאה לכלי save_rsvp, כלי ה-end_call מציין 'RSVP saved'" and marks success. The analysis LLM is `gemini-2.5-flash`.
- **`turn_timeout` 4.0 is below the documented range.** Best practice is "5-10 seconds for casual conversations" (`conversation-flow.md:186`).

**Refuted:**
- **Audio tags are not read aloud.** `[laughs]` at 67 s rendered as laughter: Scribe marked an audio event, not the word. `[slow]` and `[excited]` (25.10) were not checked in audio.

**Real, effect not measured:**
- **Line 42 conflicts with the tool setting.** Line 42 says "save_rsvp with nothing said before it", while the tool has `pre_tool_speech: auto`. Per the schema description, auto "decides based on recent tool latency".

**Seen in the audio, new:**
- **The agent's ASR misheard a question.** "אה, איפה האירוע יהיה?" was transcribed as "אה, אפשר ללווה לי, אה?", and the agent answered about transport.

## Gap fixes applied on the test branch (owner: "תתקן את הפערים בגרסת הבדיקה", 26.10.2026)

The test branch only. Two one-field PATCHes with `branch_id`, each followed by a read-back.

1. **The prompt** (`agtvrsn_9001m5w36f4cfzk9qex8f05m5r2w`). The full new text is in `prompt-test-branch-2026-10-26.txt` in this change. Ten replacements, each required to match exactly once:
   - "מנוקד" removed (the name is sent raw);
   - line 22's numeric example became a placeholder, with "repeat only a number the guest said";
   - step 2 says not to prefix `{{event_kind}}` when `{{event_name}}` already contains it;
   - step 6 lost its literal success sentence and closes only after a `save_rsvp` result;
   - a new result rule: a save exists only if a `save_rsvp` result is in the conversation, and a silence turn is not a result;
   - "one result sentence per save call" replaced "one per conversation", and a correction gets one short update sentence;
   - `notify_owner`: no "אעביר / אני מעביר / העברתי" before a tool result;
   - `callback_iso`: computed in Israel time, ask when unclear; this is aligned with the tool description, and `{{system__time}}` is removed (the timezone `Asia/Jerusalem` is set);
   - guardrail 16 no longer names a variable.
2. **The turn timeout** (`agtvrsn_7901m5w36jfdeqnb9x4w5n0y7h8e`): `turn.turn_timeout` changed from 4.0 to 7.0. The docs' best practice for casual conversation is 5-10 s.

**Read back:**
- the prompt is byte-equal to the file;
- `turn_timeout` is 7.0, and `realtime_model` is still `eleven_realtime_v1_max`;
- a field-by-field diff against the pre-fix branch config shows no other change;
- Main is unchanged: `agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4`, Mini, `turn_timeout` 4.

**Not fixable on the test branch alone:**
- **The first message doubling the event noun.** It is a fixed template, so it needs the ctx route to send a title without the repeated noun.
- **The `rsvp_captured` evaluation wording.** It is agent-level (Main only).
- **`pre_tool_speech` on `save_rsvp`.** The tool is shared with Main.
- **ASR keywords.** The per-call ctx override replaces the agent's list.

**Unverified:** whether, in Realtime mode, the platform still gives the agent the current date and time from the timezone setting once `{{system__time}}` is gone. The docs say a set timezone supplies it; this has not been observed in a call.

## Expert review of `agent_configs/KALFA-RSVP.json` (Main), 26.10.2026

The review ran in a separate agent with the `elevenlabs-agents` skill and the live docs. It was read-only.

**Findings, ranked:**
1. **Critical: "speak, then call the tool" instructions throughout the prompt.** Mini never combines speech and a tool in one turn (measured).
   - Main has this in Goal 5 and 6, "כלל סיום", the busy/bad-line branch, and Error handling.
   - On the test branch it is still in prompt lines 53, 130, 133-134, 137-138, 143 and 152-153. Main checked these on the file.
   - Proposed:
     - rewrite each as "call X; after the result, say Y";
     - set `pre_tool_speech: "off"` on save_rsvp;
     - optionally add a tool-call sound.
2. **High: copyable outcome sentences.** The Goal 4 read-back "אז רשמתי {מבוגרים}..." says "רשמתי" before any save. It is still on test-branch line 41.
3. **High: end_call always runs in its own silent turn.** It waits for turn_timeout or for the guest. The proposal is to re-test the end_call `message` parameter on Realtime with audio; the 23.08 truncation was measured in Custom mode.
4. **High: the tests cannot reach the cause.**
   - Text tests run on qwen.
   - The test branch changes three things at once (Max, `turn_timeout` 7, the prompt).
5. **Medium: settings Realtime ignores.**
   - Settings stored but ignored: llm, cascade timeout, parallel tool calls, TTS model, expressive mode, ASR provider.
   - The V3-tags section is stale.
   - The default backup LLM cascade can fall to Flash Lite.
6. **Medium: tool errors are hidden from the agent.**
   - `tool_error_handling_mode: "auto"` means "hide" for non-native tools. Per the OpenAPI description, auto is "summarized for native integrations, hide for others". Main confirmed this from the schema text.
   - Any `is_error: true` reply never reaches the agent.
   - Proposed: `passthrough`.
7. **Medium: `{{system__time}}` in the prompt and `{{system__time_utc}}` in the callback_iso description defeat caching.** The timezone is already set.
8. **Medium: contradictions in the prompt.**
   - "מטעם קלפה" (line 2) vs "מטעם {{event_celebrants}}" (line 4).
   - "אתה {{guest_name}}?" vs guardrail 13.
   - The first_message noun doubling needs a fix in the ctx route.
9. **Medium: `interruption_ignore_terms` includes answer words** (כן, נכון, בסדר…). Their effect is unverified.
10. **Medium: privacy and abuse.**
    - Privacy: `retention_days: -1` (unlimited) with recordings and no redaction.
    - Abuse: `enable_auth: false`, unlimited concurrency, a text-capable widget, file input on, and `text_only` overridable. Anyone holding the agent id can start billed conversations.
11. **Low: client_events lacks `vad_score`.** The scenario's VadScore listener cannot fire, which matches maxVadScore=0 in the 21.07 QA.
12. **Low:**
    - `ignore_default_personality: false` (claimed API default: true; not verified here);
    - the soft-timeout text;
    - temperature 0.56.

**Found correct:**
- interruption modes;
- expects_response;
- timeouts;
- the tool parameter and result strings match the scenario and server;
- the dynamic variables are injected before the first message;
- the override permissions;
- voicemail and skip_turn;
- `max_tokens` is valid for Max.

## Reviewer findings applied on the test branch (owner: "תתקן את כל הממצאים בגרסת הבדיקה ותפעל לפי ההמלצות שלו", 26.10.2026)

**Test-only tool copies.** The workspace tools are shared with Main, so each client tool was copied under the same name; the scenario routes by name, and ElevenLabs accepted the duplicate names (HTTP 200). Main still has the originals.

| copy | id | changes |
|---|---|---|
| save_rsvp | `tool_2501m5w8qk3cec3tx9z4e03e8da5` | `pre_tool_speech: off`, `tool_error_handling_mode: passthrough`, `tool_call_sound: typing` + `always` |
| mark_dnc | `tool_4401m5w8r0qxecqa9p18s6y70tw4` | `pre_tool_speech: off`, `passthrough` |
| notify_owner | `tool_3401m5w8r12gen2rc9jy67v8h13z` | `pre_tool_speech: off`, `passthrough` |
| schedule_callback | `tool_6801m5w8r19pe22a0cv9e4pm3gmc` | `pre_tool_speech: off`, `passthrough`; `{{system__time_utc}}` removed from the callback_iso description |

**Test-branch PATCHes**, one field each, ending at `agtvrsn_8501m5w8t5hzfsvbmatc3gqn2g5d`:
- **prompt** (13 replacements, each matched exactly once):
  - every speak-first line now calls the tool first and speaks only after its result: the busy/bad-line branch, mark_dnc, third silence, two misunderstandings, bad line, tool failure, other language, guardrail 11;
  - the read-back "אז רשמתי" became "אז {מבוגרים} מבוגרים ו-{ילדים} ילדים, נכון?";
  - "מטעם קלפה" became "מטעם בעלי השמחה";
  - "אתה {{guest_name}}?" became "אני מדבר עם {{guest_name}}?" (×2);
  - the "תגי V3" header became "תגים" (tags kept: `[laughs]` was verified in audio as rendered, not read).

  The full text is in `prompt-test-branch-2026-10-26.txt`.
- **tool_ids:** the four copies above.
- **client_events:** `vad_score` added.
- **ignore_default_personality:** true.
- **temperature:** 0.56 → 0.3.
- **interruption_ignore_terms:** the answer words כן, נכון, בסדר, בטח and ברור removed. One "כן" at 0 s of conv_3901 was dropped as a backchannel; the rest of the list is unchanged.

**Read back:**
- every field is as sent, and the inline tools show the new settings;
- a field-by-field diff against the pre-change branch config shows no other change;
- realtime Max and `turn_timeout` 7 are unchanged;
- Main is unchanged: `agtvrsn_1601m5t086avfvgtzkhnfcfmrwm4`, Mini, original tool ids.

**Not applied, with reason:**
- **The first_message noun doubling.** It needs a change to the ctx route (code plus deploy).
- **The end_call `message` re-test.** It needs a call. Also, the scenario hangs up `FAREWELL_GRACE_MS` (2 s) after the end_call AgentToolResponse (RSVPAgent.voxengine.js:1379-1383), which is a likely cause of the 23.08 truncation. A message farewell would need a scenario change first.
- **An isolating voice run** (Mini, revised prompt, 4 s). It needs an approved call.
- **Audio verification of ASR keywords and the ignore-terms effect.** It needs calls.
- **retention_days, enable_auth and the rsvp_captured wording.** These are agent-level settings (Main only) and the owner's decision.
- **A self-describing save result string.** Optional; it is a scenario change.

## Test call on the fixed test branch (Max) — save_rsvp called; refused as invalid_count (26.10.2026 16:43)

The call: attempt `2a63ea3e-21be-40ab-96d5-c12847591c3b`, session 9781335558, conversation `conv_3401m5wapjmkf2sv59kkx2kapv2d`. It ran on the test branch, version `agtvrsn_0801m5w9tfwkee48ysvdjv50fp6p` (Max), with `producing_llm` `eleven_realtime_v1_max` on every turn.

**The tool chain worked, for the first time since 07.09.** The sequence:
1. The read-back "אז שלושה מבוגרים ואפס ילדים, נכון?" got "נכון.".
2. A tool-only turn called `save_rsvp {status: attending, adults: 3, children: 0}` with no speech before it (the test copy `tool_2501…`).
3. The result came back as `rejected` (3.3 s).
4. `notify_owner` was called and answered `noted`.
5. A spoken result and farewell followed.
6. `end_call` came 3 s later, with no guest turn needed. Its reason, "rsvp rejected, notified owner and ended call", is honest.

The server side shows the same:
- inbox rows `call_rsvp` (payload 3/0/attending) and `call_owner_note`;
- `call_attempts.rsvp_outcome = attending`;
- the activity_log has `rsvp.call_rejected` with `reason: invalid_count`.

**Why the save was refused:** the guest's `expected_count` is 2. The live `submit_rsvp` returns `invalid_count` when adults plus children exceed `expected_count` (migration 20260714193500; the live function was checked to still contain the rule). The guest row is unchanged.

**What the guest heard was wrong.** "לא הצלחתי לעדכן… ההרשמה לאירוע כבר נסגרה". Two causes:
- the scenario forwards only the status (`saveRsvpResult(status)`) and drops the `reason`;
- the prompt maps every `rejected` to "registration closed".

**Not yet done:** transcribing this call's audio.

## Second test call on the test branch (Max) — SAVED (26.10.2026 17:03)

The call: attempt `e4b064c7-9cb5-495f-bfe6-8f064940a4dc`, session 9781735494, conversation `conv_0701m5wbss9sff8rgpnmw63f4fc3`, Max on every turn.

**Saved:**
- the guest row is `attending`, with 2 adults and 0 children (updated 15:04:25 UTC);
- the inbox has a `call_rsvp` row with the payload 2/0/attending;
- the activity log has `rsvp.from_call`, plus `rsvp.submitted` twice, 0.4 s apart (a duplicate activity row, not yet investigated);
- `rsvp_outcome` is `attending`;
- `rsvp_captured` evaluates to success.

**Still wrong:** at 43 s the agent said "אז שני מבוגרים ואפס ילדים, נשמר אצלנו במערכת. מעולה, נתנאל, תהנו מהחתונה!". It said this before the `save_rsvp` request at 45 s. After the `saved` result (57 s) it said "מעולה, זה נרשם אצלנו במערכת… יום נהדר!", and then called `end_call`. So the guest heard the save claim and the farewell twice, and the first claim came before any save. Counting both Max calls, a pre-save claim happened in 1 of 2.

**Latency:** `save_rsvp` took 11.6 s (`tool_latency_secs`). On our server, the inbox row arrived at 15:04:20.18 and the guest update landed at 15:04:25.14, about 5 s. The remaining ~6.6 s is spread across the ElevenLabs → Voximplant → KALFA hops and back; it has not been broken down yet.

**The opening line still doubles the event kind**: "לחתונה של החתונה של".
