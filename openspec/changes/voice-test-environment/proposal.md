# Proposal

## Why

KALFA has no place to test a voice-agent change before guests hear it. Each of the four ElevenLabs agents has only its
Main branch (100% of traffic, read 25.10.2026), Voximplant has one application (`kalfa-rsvp`; the `kalfatest` app the
docs mention no longer exists), and the database is production. On 25.10.2026 Eleven Realtime v1 Mini was switched on
directly on all four live agents, and the only test call possible ran on a closed event: the context route refused it
(`src/app/api/voximplant/ctx/[token]/route.ts:169`, event not `active`), the bridge went on with empty variables
(`RSVPAgent.voxengine.js:38-39`), and the agent invented the guest name, date and time and said "זה נרשם אצלנו" twice
without calling `save_rsvp` (conversation `conv_7401m5t14826eed9ep15xgnjb1kg`). The test environment would have
caught this on a branch, with real context, before any live change.

## What Changes

- **A test branch per agent in ElevenLabs.** Each of the four agents gets one long-lived branch (`test`) created from
  its Main version, at 0% traffic. Agent changes are pushed to the branch first (`elevenlabs agents push --branch`),
  and Main keeps 100% of traffic until a change is merged.
- **Test gates before a merge to Main.** The tests already attached to the agents (RSVP 1, Meeting Confirm 3, Sales
  Close 1, service agent 0) run against the branch, plus a new regression test for the failure seen on 25.10: the
  agent must not say "נרשם" before `save_rsvp` returns `saved`. A merge to Main needs the gates green and one recorded
  test call transcribed from the audio (`docs/voice-agent/elevenlabs-json-reference.md` §6.4).
- **A test call that reaches the test branch.** The RSVP bridge passes an optional ElevenLabs branch id to
  `ElevenLabs.createAgentsClient({ branchId })` (VoxEngine typings, `typings/voxengine.d.ts:6688`). Only the ops
  launcher `npm run bridge:call` can set it (a new `--branch` flag, validated as `agtbrch_…`); the worker never sends
  it, so production calls keep going to Main.
- **A permanent test event with real context.** A separate event owned by the owner's staff account (staff are exempt
  from the one-event rule, `events_before_insert` R10), published as `active` with a future date, with the owner's own
  number as its only guest, marked through `mark_test_event` so the existing purge and reports treat it as a test. A
  test call on it gets the same ctx and `save_rsvp` behaviour a real guest gets.
- **The bridge fails closed without context.** When ctx answers anything but 200, the RSVP bridge does not dial,
  instead of calling with empty values. **BREAKING** for the scenario's documented behaviour ("it never drops the call
  over missing personalization").
- **An unknown save result is an error.** A 200 from the save route with an unrecognised status is reported to the
  agent as `error`, not `queued` (`RSVPAgent.voxengine.js:1556-1558`), so the agent never promises an update without
  proof.
- **The `--allow-closed-event` launcher flag is corrected**: its help text says it tests the audio path, but ctx
  refuses a closed event, so the agent runs without context. The flag is removed or reworded so it cannot produce a
  misleading test again.

Out of scope: whether the four agents stay on Eleven Realtime v1 Mini (an owner decision, taken separately; the test
branch is where Mini or Max is evaluated next); a staging copy of the database or of Supabase; the Meeting Confirm,
Sales Close and Purpose bridges (they get their branch and attached tests here, their scenario changes later).

## Capabilities

### New Capabilities
- `voice-agent-testing`: how an agent change is tried before it reaches guests: the per-agent test branch at 0%
  traffic, the test gates that must pass before a merge to Main, the launcher route of a single test call to the
  branch, and the permanent test event that gives that call real context.
- `outbound-call-context-guard`: what the outbound RSVP bridge does when it cannot prove the call's context or a
  tool's result: no dial without a 200 from ctx, and an unrecognised save result reported as an error.

### Modified Capabilities
<!-- openspec/specs holds no capability yet. -->

## Impact

- **ElevenLabs** (four production agents): one new branch each, at 0% traffic; tests attached to the branch. Main and
  its traffic are not changed by this change.
- **Voximplant**: `RSVPAgent.voxengine.js` (scenario #920395 on rule `OutCallAgent` 1520915) gains the branch
  parameter, the fail-closed ctx check and the unknown-status mapping; deployed only through `voxengine-ci upload`,
  after the owner's approval. The DTMF rule `OutCall` (1494311) is not touched.
- **Code**: `scripts/voximplant/bridge-call.ts` (`--branch`, the closed-event flag), the helper that creates a test
  call attempt (today a scratch script), and their tests; `docs/voice-agent/elevenlabs-json-reference.md` §6 (the test
  workflow).
- **Production data**: one test event, its campaign and one guest, marked as a test event; each test call adds a
  `call_attempts` row and, on a reached contact, a `contact_interactions` row. No `billed_results` row: the billing
  function refuses a reach on a campaign that was never activated (design, Risks).
- **Cost**: each test call uses Voximplant minutes and ElevenLabs credits.
