# Design

## Context

See proposal.md, Why. Facts the approach rests on, each read on 25.10.2026:

- **ElevenLabs versioning is already on** for all four agents: each has one branch, `Main`, at 100% traffic
  (`GET /v1/convai/agents/{id}/branches`). Branches, traffic deployments, merges and rebases are documented in
  https://elevenlabs.io/docs/eleven-agents/operate/versioning.md. Traffic between branches is split by percentage and
  routed by conversation id; a conversation can also name a branch: the signed-URL endpoint takes `branch_id` and
  `version_id` (OpenAPI, `GET /v1/convai/conversation/get-signed-url`), and VoxEngine's
  `ElevenLabs.createAgentsClient` takes `branchId` (`typings/voxengine.d.ts:6688`). `POST /v1/convai/agents/{id}/run-tests`
  takes `branch_id`. The CLI has `agents branches create|list|merge|rebase`, `agents push --branch` and `agents test`.
  Per-agent settings (name, auth, call limits, privacy, analysis LLM) can only be changed on Main.
- **Attached tests:** RSVP 1 (`test_0401kxk9rce3frdtes8r479vgyxd`, simulation, "ask guest count after attendance
  confirmation"), Meeting Confirm 3, Sales Close 1, the service agent 0. None checks that `save_rsvp` returns before
  the agent says the reply is saved.
- **The RSVP bridge** (`RSVPAgent.voxengine.js`, scenario #920395, rule `OutCallAgent` 1520915, set as
  `app_settings.voximplant_rule_id`) fetches ctx first and calls `proceedToDial()` on every outcome, success, non-200,
  parse error or network error (lines 1690-1717; documented at 38-39). It creates the agent client with a hard-coded
  `AGENT_ID` (line 92) and no branch (lines 1011-1013). The save result maps an unknown status to `queued`
  (1556-1558).
- **The ctx route** returns 404 unless the token is known and unexpired, the attempt is not terminal and the event is
  `active` (`src/app/api/voximplant/ctx/[token]/route.ts:150-170`). `submit_rsvp` refuses a non-`active` or past
  event (`reason: 'closed'`). An event becomes `active` only through `publishEvent` (draft → active, future date,
  owner-only, `src/lib/data/events.ts`), with no payment. Staff are exempt from the one-event-per-account rule
  (`events_before_insert`, R10).
- **Test events** are marked in `public.test_events` through `mark_test_event` (service-role definer, re-checks the
  actor is staff, audited) and removed by `purge_test_event`, which deletes `billed_results`, `contact_interactions`,
  `campaign_*` rows and the event (`src/lib/data/admin/test-events.ts`; migrations `20260929001415`,
  `20261012000132`).
- **Test calls** are placed by `npm run bridge:call` (`scripts/voximplant/bridge-call.ts`), which needs an existing,
  non-terminal `call_attempts` row and a `--to` on the `VOX_TEST_NUMBERS` allowlist (now `+972536212562`, owner,
  25.10.2026). No script creates the attempt; on 25.10 a scratch helper did it through `nextManualTouchpoint` and
  `createCallAttempt`, exactly as `dispatchOutreachCall` does.

## Goals / Non-Goals

**Goals:**
- An agent change can be pushed, tested and heard on a branch while every production call stays on Main.
- A test call has the same context, tools and save path as a guest's call.
- The bridge never dials when it cannot prove what the call is about, and never lets the agent promise an unproven
  save.

**Non-Goals:**
- A second Supabase project or a staging site. The test event lives in production, marked as a test.
- Branch routing for the Meeting Confirm, Sales Close and Purpose bridges (each needs its own context and attempt
  shapes; they get the branch, the tests and the Main-stays-100% rule here, and the routing in a later change).
- Changing the worker's dial path or what it sends.

## Decisions

**D1 — One long-lived `test` branch per agent, not a duplicated test agent.** A branch shares the agent's tools,
per-agent settings and webhook, and merges back with `agents branches merge`; a duplicated agent (documented
`agents.duplicate`) would need its own tool registrations, webhook and post-call analysis linking, and would drift.
The branch is rebased onto Main before each test cycle (`agents branches rebase`) so it never tests a stale base.
Alternative: one short-lived branch per change. Kept possible, but a standing branch is what makes "test before
Main" the default rather than an extra step.

**D2 — The branch is chosen only by the launcher, through customData.** `bridge-call.ts` gains `--branch <id>`,
validated against `^agtbrch_[0-9a-z]+$`, and puts it in `script_custom_data` under a new short key. The scenario reads
it, applies the same pattern, and passes `branchId` to `createAgentsClient` only when it matches; otherwise it passes
nothing and ElevenLabs uses its deployment (Main 100%). The worker never sets the key (`buildScriptCustomData` in
`src/lib/data/outreach-calls.ts` is unchanged), so a production call cannot reach the branch. Alternative: a second
Voximplant rule and a forked scenario (`RSVPAgentTest`); rejected, the copy would drift from the live scenario and
the test would stop testing what guests get. Alternative: traffic split (e.g. 1% to the branch); rejected, it routes
real guests, by conversation id, to an untested branch.

**D3 — Fail closed on ctx in the same scenario change.** Every non-200, parse error, request failure and missing
`u` ends the session instead of `proceedToDial()`, through the path the scenario already uses for a missing
ElevenLabs secret (`RSVPAgent.voxengine.js:555-570`): `postFinalCallbackOnce({ call_status: 'failed',
call_duration: 0, error_reason })` and then `VoxEngine.terminate()`, so the attempt row closes instead of staying
pre-terminal. `error_reason` names the refusal (`ctx_<code>` or `ctx_unavailable`); the cb schema accepts any string up
to 256 characters (`src/lib/validation/voximplant.ts:56`) and stores it as `finish_reason`
(`call-result-processing.ts:187`). The log line names the code, never the token. A guest is never called without a
name and event. Recorded as a behaviour change of the scenario (proposal, BREAKING). Alternative: keep dialling and
rely on the prompt's "if a field is empty you don't have it" rule; rejected, the 25.10 call shows the agent inventing
a name, date and time anyway.

**D4 — An unknown 200 save status maps to `error`.** Only `saved`, `rejected` and `queued` pass through; anything
else, including a missing status, becomes `error` with `is_error:false` so the WebSocket stays open (the file's own
E-12 note). The agent's prompt already has the `error` wording ("לא הצלחתי לעדכן... מעביר למשפחה").

**D5 — The test event is created through the product, then marked.** The owner's staff account creates a draft event
in the app, publishes it (future date), adds one guest with the owner's number, and creates its campaign; staff mark
it with `mark_test_event`. Nothing is inserted by hand except the call attempt, which a committed helper creates
through `nextManualTouchpoint` and `createCallAttempt` (the dispatcher's own functions), replacing the scratch script.
The campaign is never activated or paid: the worker dials only active campaigns, so the test guest is reached only by
the launcher. The event date is kept in the future (a task to move it forward before it passes; a past event day
closes RSVP in `submit_rsvp`).

**D6 — The closed-event flag goes.** `--allow-closed-event` cannot test anything useful: ctx refuses a closed event
before the call connects, so the agent runs without context (the 25.10 call). With the test event (D5) there is no
need for it; with fail-closed ctx (D3) it would only produce a refused session. It is removed, and the launcher
refuses a closed event with a message that names the test event.

**D7 — Merge gate.** A change merges to Main only when, on the branch: `run-tests` with `branch_id` passes every
attached test (including the new save-before-confirm regression test, a tool-call test that asserts `save_rsvp` is
called before any "נרשם"), one test call through the branch is recorded and transcribed from the audio per
`docs/voice-agent/elevenlabs-json-reference.md` §6.4, and the owner approves the merge. After the merge, the traffic
deployment is read back: Main 100%.

## Risks / Trade-offs

- [The scenario change touches the live RSVP call path] → one deploy for D2, D3 and D4, through `voxengine-ci
  upload` only, with the owner's approval; proved first by test calls with and without `--branch`, and by a refused
  session on a token that ctx rejects; rollback is the previous scenario version from git.
- [A test branch with traffic would route real guests to it] → every task that touches a branch reads the deployment
  back and asserts Main 100%; branches are never given a percentage.
- [Fail-closed drops a call that would have worked, if ctx is briefly down] → the attempt closes as `failed` with
  `finish_reason` `ctx_…` (D3), the same outcome as an unanswered dial; a dropped call is a missed reminder, while a
  call without context tells a guest invented details. No sweeper closes `call_attempts` stuck pre-terminal (none
  found 25.10; `call_attempts_stale_idx` serves the active-call count, `countActiveCalls`), which is why D3 posts the
  close itself rather than leaving the row open. When ctx is down the cb route may be down too; the
  `AppEvents.Terminating` last-resort close (`RSVPAgent.voxengine.js:436-466`) is the second try.
- [Test calls write production rows: `call_attempts`, `contact_interactions`] → all on the marked test event, removed
  by `purge_test_event`; a task verifies the staff reports exclude test-marked events, and records what they show if
  they do not. No `billed_results` row: `try_record_billed_result` returns `not_active` for a campaign that is neither
  `active` nor `paused` (`20261011190349`, checked against the live definition 25.10), and the test campaign is never
  activated, so a completed test call records no reach and no charge. The save path does not depend on the campaign:
  `processCallRsvp` → `submit_rsvp` checks the event only.
- [The test event's date passes and RSVP closes] → a task, and a check in the helper, keep it in the future.
- [Per-agent settings cannot be tested on a branch (docs warning)] → recorded in the test workflow doc; such changes
  are made on Main with a call immediately after.
- [Cost: each test call uses Voximplant minutes and ElevenLabs credits] → test calls only through the launcher, to the
  allowlist, with `--confirm`.

## Migration Plan

1. Branches (ElevenLabs only, no traffic): create `test` on each agent from its Main version; read back Main 100%.
2. Tests: add the save-before-confirm regression test to the RSVP agent; run all attached tests on each branch to set
   a baseline.
3. Test event: created through the app, marked as a test; the helper and launcher changes merged.
4. Scenario (one deploy, owner-approved): D2, D3, D4; proved by test calls on the branch and on Main.
5. Docs: the test workflow in `elevenlabs-json-reference.md` §6.

Rollback: archive the branches (0% traffic, allowed by the docs); redeploy the previous `RSVPAgent` version from git;
unmark and purge the test event.

## Open Questions

- Whether the staff reports (billing summary, owner agent cores) already exclude test-marked events. Answered by a
  task; it changes only what the test workflow doc says, not the approach.
