import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STEP_HANDLERS, readWaitSignal, WORKFLOW_WAIT_CODE, type StepContext } from './index';

// `logic.wait` — the node that parks a run.
//
// ⚠️ THE PROPERTY THIS FILE EXISTS FOR IS THE SECOND ONE: a wait must END.
//
// On resume the WHOLE graph replays. A wait that recomputed its deadline from
// config on every pass would park for another full duration each time — a
// three-day wait that is never over, and a run that sleeps for ever while
// looking perfectly healthy. The ledger is the only thing that knows this step
// was already parked, which is why `resumedFromWait` exists and why it is tested
// harder than the parking itself.

const handler = STEP_HANDLERS['logic.wait'];

function ctx(overrides: Partial<StepContext> = {}) {
  return {
    runId: 'run-1',
    workflowId: 'wf-self',
    nodeId: 'node-1',
    trigger: { eventId: 'e1', contactId: 'c1', message_text: '', button_payload: '' },
    deps: {
      guests: {} as StepContext['deps']['guests'],
      alerts: {} as StepContext['deps']['alerts'],
      webhook: {
        post: async () => {
          throw new Error('a wait must not make a request');
        },
      },
      integrations: {} as StepContext['deps']['integrations'],
      accounting: {} as StepContext['deps']['accounting'],
      ai: { run: async () => ({ text: '', costUsd: null, sessionId: null }) },
    },
    ...overrides,
  } satisfies StepContext;
}

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parking', () => {
  it('throws a wait signal carrying the deadline', async () => {
    const error = await handler({ amount: 3, unit: 'days' }, ctx()).catch((e: unknown) => e);
    const wait = readWaitSignal(error);
    expect(wait?.resumeAt).toBe(new Date(NOW + 3 * 86_400_000).toISOString());
  });

  it('computes the deadline from the unit', async () => {
    const cases: Array<[string, number]> = [
      ['minutes', 60_000],
      ['hours', 3_600_000],
      ['days', 86_400_000],
    ];
    for (const [unit, ms] of cases) {
      const error = await handler({ amount: 2, unit }, ctx()).catch((e: unknown) => e);
      expect(readWaitSignal(error)?.resumeAt).toBe(new Date(NOW + 2 * ms).toISOString());
    }
  });

  it('⚠️ the deadline is an ISO timestamp inside the MESSAGE', async () => {
    // Load-bearing, and easy to break by "tidying" the message. The thrown object
    // does not survive: `runGraph` rebuilds the payload as
    // `{ error: { message, code } }` and redacts it, so by the time
    // `run-workflow` sees anything the only carrier left is the text.
    const error = (await handler({ amount: 1, unit: 'hours' }, ctx()).catch(
      (e: unknown) => e,
    )) as Error;
    expect(error.message).toContain(new Date(NOW + 3_600_000).toISOString());
  });

  it('carries the code the interceptor matches on', async () => {
    const error = (await handler({ amount: 1, unit: 'days' }, ctx()).catch(
      (e: unknown) => e,
    )) as Error & { code?: string };
    expect(error.code).toBe(WORKFLOW_WAIT_CODE);
  });
});

describe('⚠️ resuming — the half that makes a wait end', () => {
  it('a resumed step COMPLETES instead of parking again', async () => {
    // THE TEST THIS FILE EXISTS FOR. Without the resume branch this call throws
    // a fresh signal with a fresh deadline, and the run sleeps for ever.
    const r = await handler({ amount: 3, unit: 'days' }, ctx({ resumedFromWait: true }));
    expect(r.output).toMatchObject({ waited: true, resumed: true });
    expect(r.nextPort).toBeUndefined();
  });

  it('resuming ignores the configured duration entirely', async () => {
    // Even a year: the ledger already decided the wait was over, and the config
    // must not get a second vote.
    await expect(
      handler({ amount: 300, unit: 'days' }, ctx({ resumedFromWait: true })),
    ).resolves.toBeTruthy();
  });
});

describe('a duration that cannot be honoured is refused PERMANENTLY', () => {
  // Permanent, not transient: a retry in five minutes will not make the number
  // valid, and burning the queue's retry budget on a typo helps nobody.

  it('refuses zero and negative', async () => {
    for (const amount of [0, -1]) {
      await expect(handler({ amount, unit: 'days' }, ctx())).rejects.toThrow(/גדול מאפס/);
    }
  });

  it('refuses a non-number', async () => {
    // The config is jsonb: the form constrains what can be typed, not what is in
    // the row.
    for (const amount of ['soon', null, {}]) {
      await expect(handler({ amount, unit: 'days' }, ctx())).rejects.toThrow(/גדול מאפס/);
    }
  });

  it('accepts a numeric STRING — a form value that never got coerced', async () => {
    const error = await handler({ amount: '2', unit: 'hours' }, ctx()).catch((e: unknown) => e);
    expect(readWaitSignal(error)?.resumeAt).toBe(new Date(NOW + 2 * 3_600_000).toISOString());
  });

  it('refuses an unknown unit', async () => {
    await expect(handler({ amount: 1, unit: 'fortnights' }, ctx())).rejects.toThrow(/לא חוקי/);
  });

  it('⚠️ refuses a wait longer than a year', async () => {
    // A typo of "90" in a field meaning days is a pg-boss job sitting in the
    // queue for three months. The ceiling costs nothing real and catches it.
    await expect(handler({ amount: 400, unit: 'days' }, ctx())).rejects.toThrow(/ארוך משנה/);
  });
});

describe('readWaitSignal — matched by SHAPE, never instanceof', () => {
  // The worker bundles its own copy of this module, so class identity does not
  // survive the boundary. Same rule as the vendored `classifyNodeError`.

  it('recognises a plain object carrying the code and a deadline', () => {
    const foreign = Object.assign(new Error('x'), {
      code: WORKFLOW_WAIT_CODE,
      resumeAt: '2026-09-16T12:00:00.000Z',
    });
    expect(readWaitSignal(foreign)).toEqual({ resumeAt: '2026-09-16T12:00:00.000Z' });
  });

  it('does NOT match an ordinary error', () => {
    expect(readWaitSignal(new Error('boom'))).toBeNull();
    expect(readWaitSignal(Object.assign(new Error('x'), { code: 'invalid_config' }))).toBeNull();
  });

  it('does not match the code without a deadline', () => {
    // Half a signal is not a signal: parking with no time to wake is a run that
    // never returns.
    expect(readWaitSignal(Object.assign(new Error('x'), { code: WORKFLOW_WAIT_CODE }))).toBeNull();
  });

  it('does not match a non-Error', () => {
    expect(readWaitSignal({ code: WORKFLOW_WAIT_CODE, resumeAt: 'x' })).toBeNull();
    expect(readWaitSignal(null)).toBeNull();
  });
});
