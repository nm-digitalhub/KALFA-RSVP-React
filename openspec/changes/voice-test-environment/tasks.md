# Tasks

Production writes in this list (ElevenLabs branches and tests, the test event, the scenario deploy, every test call)
each need the owner's approval at the time they run. Agent configs change only through `agents pull --update` →
edit → `agents push` → `pull --update` (CLAUDE.md, Voice Agent). Evidence for each Verify line goes in
`verification.md` in this change.

## 1. ElevenLabs test branches (no traffic)

- [x] 1.1 Create a `test` branch on the RSVP agent from Main's current version (`elevenlabs agents branches create`),
  then read back `agents branches list` and the agent's traffic deployment. Verify: two branches, Main 100%, `test`
  0%, and Main's latest version id unchanged from before the create.
- [x] 1.2 Repeat 1.1 for Meeting Confirm, Sales Close and the service agent, one agent at a time, each with its own
  read-back. Verify: the same three facts per agent, recorded with each agent's `test` branch id.
- [x] 1.3 Run `agents pull --update` for all four agents. Verify: `git diff agent_configs/ agents.json` shows no change
  to any Main configuration; whatever the CLI records about branches is described in `verification.md`.
- [x] 1.4 Record in `docs/voice-agent/elevenlabs-json-reference.md` §6: the four `test` branch ids (not secrets), that
  a change is pushed with `agents push --branch` first, that the branch is rebased onto Main before each test cycle,
  that a branch never gets a traffic percentage, and that per-agent settings exist only on Main. Verify: the ids in
  the doc match the 1.1/1.2 read-backs.

## 2. Test gates

- [x] 2.1 Add the save-before-confirm regression test to the RSVP agent (a tool-call test: the guest confirms
  attendance and the agent must call `save_rsvp` before any "נרשם" wording), following the
  `architect-create-tool-test` skill, and attach it. Verify: `agents_list_tests` shows it attached to the RSVP agent;
  one run on the `test` branch with the 25.10 conditions (empty dynamic variables) is recorded, and if that run passes
  the test is tightened until it fails on the 25.10 behaviour.
- [x] 2.2 Run every attached test on each agent's `test` branch (`run-tests` with `branch_id`). Verify: run ids and
  pass/fail per test recorded as the baseline for all four agents.
- [ ] 2.3 Document the merge gate (D7) in §6: attached tests green on the branch, one branch test call transcribed
  from its audio per §6.4, owner approval, then a read-back of Main 100%. Verify: the §6 steps name the exact commands
  used in 2.2.

## 3. Launcher and test-attempt helper

- [x] 3.1 Add the branch-id check as a pure function in `src/lib/voximplant/` (pattern `^agtbrch_[0-9a-z]+$`) with unit
  tests for a valid id, a malformed value and an absent value. Verify: the tests pass.
- [x] 3.2 Give `scripts/voximplant/bridge-call.ts` a `--branch <id>` flag that uses 3.1, refuses a malformed value
  before any database write or dial, and adds the id to `script_custom_data` under one short key. Verify: a unit test
  shows the payload with a 36-character branch id (the length of the live ids) stays within the scenario's 200-byte
  cap; `buildScriptCustomData` in `src/lib/data/outreach-calls.ts` is unchanged (`git diff`).
- [x] 3.3 Remove `--allow-closed-event` (D6); the closed-event refusal names the test event and the helper in 3.4.
  Verify: `grep -rn allow-closed-event scripts docs src` finds the flag only where it is recorded as removed or as
  history — §6.6, the 2026-07-21 QA record (its two lines and their dated removal note) — and in the tests that assert
  its absence; no script accepts it; the source-guard test
  (no override in the launcher) and the `closedEventDialMessage` test pass. (A launcher run cannot show the refusal:
  without `--confirm` it exits at its first check, and the 25.10 attempt is terminal, which it refuses earlier.)
- [x] 3.4 Add the test-attempt helper (today a scratch script) under `scripts/voximplant/`, with an npm script: it
  creates the attempt through `nextManualTouchpoint` and `createCallAttempt`, and refuses unless the event is in
  `test_events`, active, with a future date, and the guest's phone is on `VOX_TEST_NUMBERS`. Put the refusal rules in a
  pure function with unit tests. Verify: the tests pass, plus `npm run typecheck` and `npm run lint`.
- [x] 3.5 Update the launcher's header comment and §6 with the test-call steps (helper → `bridge:call --branch`).
  Verify: every documented flag exists in the two scripts.

## 4. The permanent test event

- [ ] 4.1 With the owner's approval, the owner's staff account creates the event in the app: draft → published with a
  future date, one guest with the owner's number, and its campaign, not activated. Verify (read-only SQL): event
  `active` with a future date, exactly one guest, campaign not `active`.
- [ ] 4.2 Mark it with `mark_test_event` (staff path in `src/lib/data/admin/test-events.ts`). Verify: a `test_events`
  row for it, and the staff test-events list shows it.
- [ ] 4.3 Answer the design's open question: read the billing summary, the owner-agent cores and the staff reports for
  how they treat test-marked events. Verify: findings with `file:line` in `verification.md`, and §6 says what a test
  call shows in those reports.
- [ ] 4.4 Record in §6 the test event, how to move its date forward before it passes, and that `purge_test_event`
  removes its rows. Verify: the steps match the code they name.

## 5. RSVPAgent scenario (one deploy)

- [x] 5.1 Branch routing (D2): read the branch key from customData, apply the same pattern, and pass `branchId` to
  `ElevenLabs.createAgentsClient` only when it matches. Put the check in a pure function, tested by brace-extraction as
  `src/lib/voximplant/rsvp-agent-tool-args.test.ts` already does. Verify: tests for valid, malformed and absent
  values; the `branchId` parameter matches `typings/voxengine.d.ts`.
- [x] 5.2 Fail closed on ctx (D3): on a non-200, a parse error, a request failure or a missing `u`, post the
  `failed` close with `error_reason` `ctx_<code>` / `ctx_unavailable` and terminate without `callPSTN`; update the
  header comments that promise the call goes ahead (lines 19-24, 38-39). Verify: a brace-extraction test of the
  decision function covers 200, 404, 500, an unparseable body and a missing origin.
- [x] 5.3 Unknown save status (D4): only `saved`, `rejected`, `queued` pass through; anything else, including no
  status, becomes `error`. Verify: a brace-extraction test covers the three known statuses, an unknown one and a
  missing one.
- [ ] 5.4 With the owner's approval, deploy through `voxengine-ci upload` only, never touching rule 1494311. Verify:
  the deployed scenario version is read back; test call A (no `--branch`, test event) gets ctx 200, the agent says the
  real guest and event, and `save_rsvp` returns `saved`, with the conversation on Main; test call B (`--branch` with
  the RSVP `test` id) runs on the `test` branch (the conversation's `branch_id`); session C
  (`scripts/voximplant/test-call.ts --rule 1520915`, whose fake token makes ctx answer 404) logs the refusal and the
  `failed` close, never calls `callPSTN`, and the phone does not ring (closing a real attempt is covered by the 5.2
  test: the fake token has no row to close); calls A and B are transcribed from their audio per §6.4.
- [ ] 5.5 Record in §6 the fail-closed behaviour, the branch key, and the rollback (previous `RSVPAgent` version from
  git, through `voxengine-ci upload`). Verify: the rollback command is the one used in 5.4.

## 6. Integration check

- [ ] 6.1 Run `npm run lint`, `npm run typecheck`, `npm run build` and the vitest files touched in groups 3 and 5.
  Verify: all green, output recorded.
- [ ] 6.2 Final read-back: all four agents Main 100% / `test` 0%, the test event active and marked, and every spec
  scenario mapped to its evidence in `verification.md`. Verify: no scenario is left without evidence.

## Workflow follow-up

- Archive the change after the owner's review (`/opsx:archive voice-test-environment`).
- Out of this change: branch routing for the Meeting Confirm, Sales Close and Purpose bridges; the owner's decision on
  Mini for the live agents.
