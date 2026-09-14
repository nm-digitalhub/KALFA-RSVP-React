import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuestActionsPort } from '@/lib/workflow/engine/ports';
import { readWaitSignal } from '@/lib/workflow/steps';

import { STEP_HANDLERS, type StepContext } from './index';

// `action.start_voice_call` waiting for the call to END — the half the engine
// could not express until now (0ב).
//
// ⚠️ THE OLD SHAPE WAS "DIAL AND CARRY ON". A graph that wanted to branch on
// whether the guest actually answered had to follow the call with `logic.wait`
// and a guessed duration: a seven-minute call checked at minute five, and a call
// that failed on dial still burning the whole wait. The node now parks on the
// CALL rather than on a clock, and the callback wakes it the moment the call
// reports.
//
// Three properties are what make that safe, and each has a test below:
//
//   1. IT IS OPT-IN. The node has dialled and continued since it shipped, so the
//      wait only happens when the owner ticked the box.
//   2. THE CEILING IS THE TOKEN'S OWN EXPIRY. The callback route refuses an
//      expired token, so a longer park is a park no wake could ever reach.
//   3. THE RESUME READS THE ROW. A parked run is delivered by whichever comes
//      first — the wake, the ceiling, or the recovery sweep — and only the first
//      means the call reported.

const handler = STEP_HANDLERS['action.start_voice_call'];

const EXPIRY = '2026-09-14T18:30:00.000Z';

type Dial = NonNullable<GuestActionsPort['startVoicePurposeCall']>;
type Read = NonNullable<GuestActionsPort['readVoicePurposeOutcome']>;

function ctx(
  guests: Partial<GuestActionsPort>,
  extra: { resumedFromWait?: boolean } = {},
): StepContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    ...(extra.resumedFromWait ? { resumedFromWait: true } : {}),
    deps: {
      guests: guests as GuestActionsPort,
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {} as StepContext['deps']['webhook'],
    },
  } as StepContext;
}

// PLAIN functions, wrapped in a fresh `vi.fn` at each use. A shared `vi.fn`
// passed as an implementation carries its call count from test to test, which
// made "did not dial again" pass for the wrong reason.
const dialedOk: Dial = async () => ({
  ok: true,
  status: 'dialed',
  attemptId: 'attempt-1',
  tokenExpiresAt: EXPIRY,
});

const notYet: Read = async () => ({
  attemptId: 'attempt-1',
  dispatchStatus: 'confirmed',
  finishReason: null,
  callDurationSec: null,
});

beforeEach(() => vi.clearAllMocks());

/** Run the handler and hand back the wait it asked for, or null. */
async function park(config: Record<string, unknown>, guests: Partial<GuestActionsPort>) {
  try {
    const r = await handler(config, ctx(guests));
    return { wait: null, output: r.output };
  } catch (e) {
    return { wait: readWaitSignal(e), output: null, error: e };
  }
}

describe('action.start_voice_call — waiting for the outcome', () => {
  it('⚠️ does NOT wait unless the owner asked — the shipped behaviour is untouched', async () => {
    const dial = vi.fn<Dial>(dialedOk);
    const read = vi.fn<Read>(notYet);

    const r = await park({ purposeKey: 'feedback' }, {
      startVoicePurposeCall: dial,
      readVoicePurposeOutcome: read,
    });

    expect(r.wait).toBeNull();
    expect(r.output).toMatchObject({ dialed: true, status: 'dialed', attemptId: 'attempt-1' });
    // Not merely "did not park" — the outcome is not even consulted. Every graph
    // drawn before this feature existed must behave exactly as it did.
    expect(read).not.toHaveBeenCalled();
  });

  it('parks on the ATTEMPT, to the TOKEN’S expiry', async () => {
    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: vi.fn<Dial>(dialedOk),
      readVoicePurposeOutcome: vi.fn<Read>(notYet),
    });

    // The correlation is the attempt id, which is what the callback route feeds
    // the wake and what `workflow_runs.resume_correlation_id` stores. Anything
    // else and the wake matches nothing.
    expect(r.wait).toMatchObject({ resumeAt: EXPIRY, correlationId: 'attempt-1' });
    // The verifier rides along with the park — it is what closes the window
    // between deciding to wait and the wait becoming wakeable.
    expect(typeof r.wait?.verify).toBe('function');
  });

  it('⚠️ the ceiling is never a duration chosen in code', async () => {
    // A park past `token_expires_at` is a park in a window where no callback can
    // be accepted — the route 404s an expired token — so the run would sleep to
    // a deadline that had stopped being wakeable. Pinned by using an expiry that
    // no plausible hardcoded duration would produce.
    const odd = '2027-01-02T03:04:05.000Z';
    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: vi.fn<Dial>(async () => ({
        ok: true,
        status: 'dialed',
        attemptId: 'attempt-9',
        tokenExpiresAt: odd,
      })),
      readVoicePurposeOutcome: vi.fn<Read>(notYet),
    });
    expect(r.wait?.resumeAt).toBe(odd);
  });

  it('⚠️ never parks on a call that has already settled', async () => {
    // `already_dispatched` on a replay can find a row that finished long ago.
    // Parking then is a wait nothing will ever end, because the only thing that
    // would have woken it already happened.
    for (const settled of ['concluded', 'failed']) {
      const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
        startVoicePurposeCall: vi.fn<Dial>(async () => ({
          ok: true,
          status: 'already_dispatched',
          attemptId: 'attempt-1',
          tokenExpiresAt: EXPIRY,
        })),
        readVoicePurposeOutcome: vi.fn<Read>(async () => ({
          attemptId: 'attempt-1',
          dispatchStatus: settled,
          finishReason: 'completed',
          callDurationSec: 42,
        })),
      });
      expect(r.wait).toBeNull();
      expect(r.output).toMatchObject({ status: settled, concluded: settled === 'concluded' });
    }
  });

  it('⚠️ DOES park on an ambiguous start — the call may well be ringing', async () => {
    // `start_unknown` writes dispatch_status='unknown', which is deliberately NOT
    // settled: StartScenarios gave an answer we could not classify, the scenario
    // still holds a valid token, and a report can still arrive. Not parking here
    // would discard exactly the outcome a waiting step wants most.
    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: vi.fn<Dial>(async () => ({
        ok: false,
        status: 'start_unknown',
        attemptId: 'attempt-1',
        tokenExpiresAt: EXPIRY,
      })),
      readVoicePurposeOutcome: vi.fn<Read>(async () => ({
        attemptId: 'attempt-1',
        dispatchStatus: 'unknown',
        finishReason: 'ambiguous_start_response',
        callDurationSec: null,
      })),
    });
    expect(r.wait).toMatchObject({ resumeAt: EXPIRY, correlationId: 'attempt-1' });
    // The verifier rides along with the park — it is what closes the window
    // between deciding to wait and the wait becoming wakeable.
    expect(typeof r.wait?.verify).toBe('function');
  });

  it('⚠️ never parks without a correlation to park on', async () => {
    // A refusal carries no attempt, and `already_dispatched` returns an empty id
    // when the row it collided with could not be re-read. Parking on '' is a park
    // no callback can ever match — unwakeable until the ceiling.
    for (const outcome of [
      { ok: false, status: 'blocked', reason: 'dnc' },
      { ok: true, status: 'already_dispatched', attemptId: '', tokenExpiresAt: EXPIRY },
      { ok: true, status: 'dialed', attemptId: 'attempt-1' }, // no expiry ⇒ no ceiling
    ]) {
      const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
        startVoicePurposeCall: vi.fn<Dial>(async () => outcome),
        readVoicePurposeOutcome: vi.fn<Read>(notYet),
      });
      expect(r.wait).toBeNull();
      expect(r.output).toMatchObject({ status: outcome.status });
    }
  });
});

describe('action.start_voice_call — resuming', () => {
  it('⚠️ does NOT dial again, and reads the outcome from the row', async () => {
    const dial = vi.fn<Dial>(dialedOk);
    const read = vi.fn<Read>(async () => ({
      attemptId: 'attempt-1',
      dispatchStatus: 'concluded',
      finishReason: 'completed',
      callDurationSec: 73,
    }));

    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx({ startVoicePurposeCall: dial, readVoicePurposeOutcome: read }, { resumedFromWait: true }),
    );

    // The whole graph replays on resume. A handler that dialled here would
    // telephone the guest a second time, every time.
    expect(dial).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith({ runId: 'run-1', nodeId: 'node-1' });
    expect(r.output).toMatchObject({
      concluded: true,
      status: 'concluded',
      finishReason: 'completed',
      durationSec: 73,
      resumed: true,
    });
  });

  it('⚠️ a call that NEVER reported completes honestly — it does not throw', async () => {
    // The ceiling fired with the row still 'confirmed'. The rules placed the call
    // correctly and nothing came back; that is the same category as the refusals
    // this node already treats as a completed step, not the error branch. The
    // graph branches on `concluded`, which is false.
    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx({ readVoicePurposeOutcome: vi.fn<Read>(notYet) }, { resumedFromWait: true }),
    );
    expect(r.output).toMatchObject({ concluded: false, status: 'confirmed', resumed: true });
  });

  it('survives the row having vanished', async () => {
    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx(
        { readVoicePurposeOutcome: vi.fn<Read>(async () => null) },
        { resumedFromWait: true },
      ),
    );
    expect(r.output).toMatchObject({ concluded: false, resumed: true });
  });
});

// ⚠️ THE STATUS THE TWO LISTS USED TO DISAGREE ABOUT.
//
// `PURPOSE_SETTLED` omits `unknown` because a report may still arrive, but
// `PURPOSE_PRE_TERMINAL` also omitted it — so the callback's UPDATE matched zero
// rows, the status stayed `unknown`, and a waiting workflow read `concluded:
// false` for a call that had completed and reported. This pins the engine half:
// `unknown` parks and waits rather than settling.
describe('an ambiguous start is not an outcome', () => {
  it('parks on unknown, and reports it honestly if nothing ever comes', async () => {
    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: vi.fn<Dial>(async () => ({
        ok: false,
        status: 'start_unknown',
        attemptId: 'attempt-1',
        tokenExpiresAt: EXPIRY,
      })),
      readVoicePurposeOutcome: vi.fn<Read>(async () => ({
        attemptId: 'attempt-1',
        dispatchStatus: 'unknown',
        finishReason: 'ambiguous_start_response',
        callDurationSec: null,
      })),
    });
    expect(r.wait).toMatchObject({ resumeAt: EXPIRY, correlationId: 'attempt-1' });
    // The verifier rides along with the park — it is what closes the window
    // between deciding to wait and the wait becoming wakeable.
    expect(typeof r.wait?.verify).toBe('function');

    // …and if the callback DID land, the row is 'concluded' by then, so the
    // resume reads a real outcome rather than the ambiguity it parked on.
    const resumed = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx(
        {
          readVoicePurposeOutcome: vi.fn<Read>(async () => ({
            attemptId: 'attempt-1',
            dispatchStatus: 'concluded',
            finishReason: 'completed',
            callDurationSec: 51,
          })),
        },
        { resumedFromWait: true },
      ),
    );
    expect(resumed.output).toMatchObject({ concluded: true, durationSec: 51 });
  });
});

// The verifier the park hands out, exercised as its caller will exercise it.
describe('the wait verifier', () => {
  it('⚠️ READS the attempt — it must never place the call again', async () => {
    const dial = vi.fn<Dial>(dialedOk);
    const read = vi.fn<Read>(notYet);

    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: dial,
      readVoicePurposeOutcome: read,
    });

    const dialsBefore = dial.mock.calls.length;
    await r.wait!.verify!();

    // The dial count is unchanged. A verifier that re-dispatched would telephone
    // the guest a second time on every park — the single worst thing this whole
    // mechanism could do.
    expect(dial.mock.calls.length).toBe(dialsBefore);
    expect(read).toHaveBeenCalledWith({ runId: 'run-1', nodeId: 'node-1' });
  });

  it('answers TRUE only once the call has SETTLED', async () => {
    // ⚠️ REWRITTEN. The first version parked with one status and then parked a
    // SECOND time with the status under test, asking that park's verifier — so
    // for 'concluded'/'failed' no park happened at all and the test returned a
    // hardcoded `true` rather than asking anything. It asserted its own fixture.
    //
    // The verifier reads the attempt AT CALL TIME, so the honest way to test it
    // is one park whose port answer CHANGES underneath it — exactly what happens
    // in production when the callback lands during the window.
    for (const [settledTo, expected] of [
      ['concluded', true],
      ['failed', true],
      ['confirmed', false],
      ['unknown', false],
      ['pending', false],
    ] as const) {
      let status = 'confirmed';
      const read = vi.fn<Read>(async () => ({
        attemptId: 'attempt-1',
        dispatchStatus: status,
        finishReason: null,
        callDurationSec: null,
      }));

      const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
        startVoicePurposeCall: vi.fn<Dial>(dialedOk),
        readVoicePurposeOutcome: read,
      });
      expect(r.wait, settledTo).not.toBeNull();

      // The window: the call reports between the park and the check.
      status = settledTo;
      expect(await r.wait!.verify!(), settledTo).toBe(expected);
    }
  });

  it('a vanished row is not "it happened"', async () => {
    let gone = false;
    const read = vi.fn<Read>(async () =>
      gone
        ? null
        : { attemptId: 'attempt-1', dispatchStatus: 'confirmed', finishReason: null, callDurationSec: null },
    );
    const r = await park({ purposeKey: 'feedback', waitForOutcome: true }, {
      startVoicePurposeCall: vi.fn<Dial>(dialedOk),
      readVoicePurposeOutcome: read,
    });

    gone = true;
    // A missing row says nothing happened, not that everything did. Reporting
    // true here would resume a run onto an outcome that does not exist.
    expect(await r.wait!.verify!()).toBe(false);
  });
});

// The business outcome on the node's own output.
describe('the outcome a diagram branches on', () => {
  it('⚠️ a SIP code becomes a word an owner can reason about', async () => {
    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx(
        {
          readVoicePurposeOutcome: vi.fn<Read>(async () => ({
            attemptId: 'attempt-1',
            dispatchStatus: 'concluded',
            finishReason: 'sip_486', // Busy Here
            callDurationSec: null,
          })),
        },
        { resumedFromWait: true },
      ),
    );

    expect(r.output).toMatchObject({ outcome: 'no_answer' });
    // …and the telephony's own word survives beside it, for whoever is debugging
    // rather than branching.
    expect(r.output).toMatchObject({ finishReason: 'sip_486' });
  });

  it('a completed call reads completed', async () => {
    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx(
        {
          readVoicePurposeOutcome: vi.fn<Read>(async () => ({
            attemptId: 'attempt-1',
            dispatchStatus: 'concluded',
            finishReason: 'completed',
            callDurationSec: 61,
          })),
        },
        { resumedFromWait: true },
      ),
    );
    expect(r.output).toMatchObject({ outcome: 'completed', durationSec: 61 });
  });

  it('⚠️ the ceiling firing on a live call is no_answer, not failed', async () => {
    // The wait timed out with the call still 'confirmed'. The rules placed it
    // correctly and nothing came back — a legitimate business result.
    const r = await handler(
      { purposeKey: 'feedback', waitForOutcome: true },
      ctx({ readVoicePurposeOutcome: vi.fn<Read>(notYet) }, { resumedFromWait: true }),
    );
    expect(r.output).toMatchObject({ outcome: 'no_answer', concluded: false });
  });
});
