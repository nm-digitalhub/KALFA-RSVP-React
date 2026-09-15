import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StepClaim, WorkflowEngineDeps } from './ports';
import { runWorkflow } from './run-workflow';

// A run that PARKS and then RESUMES, through the real `runGraph`.
//
// ⚠️ WHY THIS IS AN ENGINE TEST AND NOT A NODE TEST. A wait leaves the scheduler
// as a THROWN ERROR — `runGraph` has no suspension point, so the node throws,
// the default 'fail' policy makes it fatal, and the runner returns
// `{ status: 'failed' }` having already emitted `node_failed`,
// `execution_failed` and written the run as FAILED.
//
// Everything that makes that acceptable lives in `run-workflow`'s event wrapper,
// and none of it is visible from the node. What this file holds:
//
//   1. the run reports `waiting`, not `failed`;
//   2. the row is never written as failed;
//   3. the log says `node_waiting`, not `node_failed`;
//   4. on resume the steps BEFORE the wait do not run a second time.
//
// (4) is the one a reader is most likely to doubt, and the most expensive to get
// wrong: it is what stops a guest being messaged again every time a wait wakes.

type Event = { type: string; nodeId?: string; payload?: unknown };

const node = (id: string, type: string, properties: Record<string, unknown> = {}) => ({
  id,
  type: 'node',
  position: { x: 0, y: 0 },
  data: { type, icon: 'Lightning', properties: { label: id, description: 'd', ...properties } },
});

/** trigger → notify → wait(1 day) → notify */
const definition = {
  name: 'w',
  layoutDirection: 'DOWN',
  nodes: [
    node('t', 'trigger.whatsapp_inbound'),
    node('before', 'action.notify_team', { level: 'info', title: 'לפני' }),
    node('w1', 'logic.wait', { amount: 1, unit: 'days' }),
    node('after', 'action.notify_team', { level: 'info', title: 'אחרי' }),
  ],
  edges: [
    { id: 'e1', source: 't', target: 'before', sourceHandle: null },
    { id: 'e2', source: 'before', target: 'w1', sourceHandle: null },
    { id: 'e3', source: 'w1', target: 'after', sourceHandle: null },
  ],
};

/**
 * A ledger that behaves like the real one across a park/resume cycle.
 *
 * `rows` survives between the two `runWorkflow` calls, which is the whole point:
 * the second call is a REPLAY, and what it sees in the ledger is what decides
 * whether anything runs twice.
 */
const beginWaitCalls: { nodeId: string; waitUntil: string; correlationId?: string }[] = [];

function ledgerFake() {
  const rows = new Map<string, { status: string; result?: unknown; waitUntil?: string }>();
  const claims: string[] = [];

  const ledger = {
    rows,
    claims,
    async claimStep({ nodeId }: { nodeId: string }): Promise<StepClaim> {
      claims.push(nodeId);
      const row = rows.get(nodeId);
      if (!row) {
        rows.set(nodeId, { status: 'running' });
        return { kind: 'claimed' };
      }
      if (row.status === 'completed') return { kind: 'already_done', result: row.result };
      if (row.status === 'waiting') {
        const elapsed = Date.now() >= Date.parse(row.waitUntil ?? '');
        if (!elapsed) return { kind: 'in_flight' };
        rows.set(nodeId, { status: 'running' });
        return { kind: 'claimed', resumedFromWait: true };
      }
      return { kind: 'in_flight' };
    },
    async completeStep({ nodeId, result }: { nodeId: string; result: unknown }) {
      rows.set(nodeId, { status: 'completed', result });
    },
    async failStep({ nodeId }: { nodeId: string }) {
      rows.set(nodeId, { status: 'failed' });
    },
    async beginWait({
      nodeId,
      waitUntil,
      correlationId,
    }: {
      nodeId: string;
      waitUntil: string;
      correlationId?: string;
    }) {
      // RECORDED, not stored on the row — the real store does the same. A parked
      // step is identified by its deadline; the correlation only travels through
      // this call so `run-workflow` can capture it while the park is still
      // structured (see the beginWait wrapper there). Recording it lets a test
      // assert what actually crossed the seam.
      beginWaitCalls.push({ nodeId, waitUntil, ...(correlationId ? { correlationId } : {}) });
      rows.set(nodeId, { status: 'waiting', waitUntil });
    },
  };
  return ledger;
}

function makeDeps(ledger: ReturnType<typeof ledgerFake>) {
  const statuses: { status: string; resumeAt?: string }[] = [];
  const events: Event[] = [];
  const notified: string[] = [];

  const deps = {
    ledger,
    runs: {
      async setRunStatus({
        status,
        resumeAt,
        resumeCorrelationId,
      }: {
        status: string;
        resumeAt?: string;
        resumeCorrelationId?: string;
      }) {
        statuses.push({
          status,
          ...(resumeAt ? { resumeAt } : {}),
          ...(resumeCorrelationId ? { resumeCorrelationId } : {}),
        });
      },
    },
    guests: {} as WorkflowEngineDeps['guests'],
    alerts: {
      async notifyTeam({ title }: { title: string }) {
        notified.push(title);
        return { sent: true };
      },
    },
    webhook: {
      post: async () => ({ ok: true, status: 200 }),
    },
    log: {
      async appendEvent(e: Event) {
        events.push(e);
      },
    },
  } as unknown as WorkflowEngineDeps;

  return { deps, statuses, events, notified };
}

const run = (deps: WorkflowEngineDeps) =>
  runWorkflow({
    runId: 'run-1',
    workflowId: 'wf-1',
    storedDefinition: definition,
    trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
    deps,
  });

const NOW = Date.parse('2026-09-13T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  beginWaitCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the run parks', () => {
  it('reports waiting with a deadline and the node that asked', async () => {
    const ledger = ledgerFake();
    const { deps } = makeDeps(ledger);

    const outcome = await run(deps);
    expect(outcome).toEqual({
      status: 'waiting',
      resumeAt: new Date(NOW + 86_400_000).toISOString(),
      nodeId: 'w1',
    });
  });

  it('⚠️ the run row is NEVER written as failed', async () => {
    // The runner really does call updateStatus('failed') — that is how a wait
    // leaves the scheduler. If the suppression regresses, an owner opens /admin
    // and reads that their automation broke while it is simply waiting.
    const ledger = ledgerFake();
    const { deps, statuses } = makeDeps(ledger);

    await run(deps);
    expect(statuses.map((s) => s.status)).not.toContain('failed');
    expect(statuses.at(-1)).toEqual({
      status: 'waiting',
      resumeAt: new Date(NOW + 86_400_000).toISOString(),
    });
  });

  it('⚠️ the log says node_waiting, not node_failed', async () => {
    const ledger = ledgerFake();
    const { deps, events } = makeDeps(ledger);

    await run(deps);
    const types = events.map((e) => e.type);
    expect(types).toContain('node_waiting');
    expect(types).not.toContain('node_failed');
    expect(types).not.toContain('execution_failed');
  });

  it('the node_waiting event carries when it wakes', async () => {
    const ledger = ledgerFake();
    const { deps, events } = makeDeps(ledger);

    await run(deps);
    const waiting = events.find((e) => e.type === 'node_waiting');
    expect(waiting?.nodeId).toBe('w1');
    expect(waiting?.payload).toMatchObject({
      resumeAt: new Date(NOW + 86_400_000).toISOString(),
    });
  });

  it('⚠️ …and WHAT it waits on, because the date alone means two things', async () => {
    // A `logic.wait` deadline is when the run RESUMES. A correlated wait's
    // `resumeAt` is when it GIVES UP — the callback may land long before it, or
    // never. The canvas renders a different sentence for each, so the kind has
    // to leave the engine; without it the node said "continues at 14:30" about a
    // step really waiting for a phone call to end.
    //
    // ⚠️ AND IT IS ASSERTED SEPARATELY FROM THE TEST ABOVE ON PURPOSE. That one
    // uses `toMatchObject`, which passes on a payload carrying extra keys AND on
    // one missing this — so deleting `waitKind` from `run-workflow.ts` left the
    // whole suite green. Measured before this line existed.
    const ledger = ledgerFake();
    const { deps, events } = makeDeps(ledger);

    await run(deps);
    const payload = events.find((e) => e.type === 'node_waiting')?.payload as {
      waitKind?: unknown;
    };
    expect(payload?.waitKind).toBe('timer');
  });

  it('the step is PARKED, not failed — the ledger would otherwise let it through', async () => {
    const ledger = ledgerFake();
    const { deps } = makeDeps(ledger);

    await run(deps);
    expect(ledger.rows.get('w1')).toMatchObject({ status: 'waiting' });
  });

  it('nothing AFTER the wait has run', async () => {
    const ledger = ledgerFake();
    const { deps, notified } = makeDeps(ledger);

    await run(deps);
    expect(notified).toEqual(['לפני']);
    expect(ledger.rows.has('after')).toBe(false);
  });
});

describe('the run resumes', () => {
  it('⚠️ steps BEFORE the wait do NOT run a second time', async () => {
    // THE ASSERTION THE WHOLE DESIGN RESTS ON. Resuming replays the entire graph
    // — there is no checkpoint — so the only thing standing between a wait and a
    // second message to the same guest is the ledger returning `already_done`.
    const ledger = ledgerFake();
    const first = makeDeps(ledger);
    await run(first.deps);
    expect(first.notified).toEqual(['לפני']);

    vi.setSystemTime(NOW + 86_400_001);
    const second = makeDeps(ledger);
    const outcome = await run(second.deps);

    expect(outcome).toEqual({ status: 'completed' });
    // 'לפני' is NOT here: it was replayed from the ledger, not executed.
    expect(second.notified).toEqual(['אחרי']);
  });

  it('parks AGAIN when woken early', async () => {
    // A redelivery for any other reason — a retry, a manual re-run — must not
    // walk past a wait that has not elapsed.
    const ledger = ledgerFake();
    await run(makeDeps(ledger).deps);

    vi.setSystemTime(NOW + 1000);
    const second = makeDeps(ledger);
    const outcome = await run(second.deps);

    expect(outcome.status).not.toBe('completed');
    expect(second.notified).toEqual([]);
  });

  it('a completed run writes a terminal status and no resumeAt', async () => {
    const ledger = ledgerFake();
    await run(makeDeps(ledger).deps);

    vi.setSystemTime(NOW + 86_400_001);
    const second = makeDeps(ledger);
    await run(second.deps);

    expect(second.statuses.at(-1)).toEqual({ status: 'completed' });
  });
});

describe('a ledger that cannot park fails CLOSED', () => {
  it('refuses the node rather than treating the wait as ordinary', async () => {
    // Without `beginWait` the row would be written `failed`, and the very next
    // delivery would take it over and walk straight past a wait that had not
    // elapsed — a silent loss of the delay, which is worse than a loud refusal.
    const ledger = ledgerFake();
    const { deps, statuses } = makeDeps(ledger);
    delete (ledger as { beginWait?: unknown }).beginWait;

    const outcome = await run(deps);
    expect(outcome.status).toBe('failed');
    expect(statuses.map((s) => s.status)).toContain('failed');
  });
});

// The wait's OTHER half, added with the event-driven wake (0ב).
//
// `logic.wait` waits on a clock and names no event; these pin that it stays that
// way — a timed park must not pick up a correlation by accident, and the run row
// must not record one. They also cover the REGRESSION that mattered most in this
// change: the deadline used to be recovered with a regex over the error message
// and now comes from the `beginWait` capture, so "the park still reports the
// right instant" is the assertion that proves the swap.
//
// The correlated direction cannot be driven end to end yet: no node emits a
// correlation until the voice step does, and STEP_HANDLERS is imported directly
// so a handler cannot be injected here. Its transport is covered where it is
// pure, in wait-signal.test.ts.
describe('a timed wait carries no correlation', () => {
  it('beginWait receives the deadline and nothing else', async () => {
    const ledger = ledgerFake();
    const { deps } = makeDeps(ledger);
    await run(deps);

    expect(beginWaitCalls).toHaveLength(1);
    expect(beginWaitCalls[0]!.waitUntil).toBe(new Date(NOW + 86_400_000).toISOString());
    expect(beginWaitCalls[0]).not.toHaveProperty('correlationId');
  });

  it('the run row records that same deadline, and no correlation', async () => {
    const ledger = ledgerFake();
    const { deps, statuses } = makeDeps(ledger);
    await run(deps);

    const parked = statuses.find((s) => s.status === 'waiting');
    expect(parked?.resumeAt).toBe(new Date(NOW + 86_400_000).toISOString());
    expect(parked).not.toHaveProperty('resumeCorrelationId');
  });
});

// The OTHER kind of park, and the only thing this block is here to pin.
//
// ⚠️ THE SAME `resumeAt` FIELD MEANS THE OPPOSITE THING HERE. Above, it is when
// the run resumes. For a wait that is correlated to something outside the run —
// a call outcome, a webhook — it is when the run GIVES UP; the callback may land
// long before it, or never. `run-workflow` maps that difference onto
// `waitKind`, the canvas renders a different sentence for each, and until this
// test existed only the `'timer'` half was ever executed by the suite.
//
// Driven through the real engine and the real handler rather than by calling the
// mapping directly: the input is `wait.correlationId`, which
// `action.start_voice_call` derives from the dialled attempt's id — code this
// block deliberately does not reach past.
describe('a CORRELATED park — action.start_voice_call waiting for the outcome', () => {
  const voiceDefinition = {
    name: 'w',
    layoutDirection: 'DOWN',
    nodes: [
      node('t', 'trigger.whatsapp_inbound'),
      node('v1', 'action.start_voice_call', { purposeKey: 'feedback', waitForOutcome: true }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'v1', sourceHandle: null }],
  };

  const TOKEN_EXPIRY = '2027-01-02T03:04:05.000Z';

  /** The two guest ports the voice step needs: one dials, one reads the outcome. */
  function voiceDeps(ledger: ReturnType<typeof ledgerFake>) {
    const base = makeDeps(ledger);
    return {
      ...base,
      deps: {
        ...base.deps,
        guests: {
          startVoicePurposeCall: async () => ({
            ok: true,
            status: 'dialed',
            attemptId: 'attempt-1',
            tokenExpiresAt: TOKEN_EXPIRY,
          }),
          // Not finished yet — which is what makes the step park rather than
          // return. A finished outcome is `voice-call-wait.test.ts`'s subject.
          readVoicePurposeOutcome: async () => ({
            attemptId: 'attempt-1',
            dispatchStatus: 'confirmed',
            callStatus: null,
            finishReason: null,
            callDurationSec: null,
          }),
        },
      } as unknown as WorkflowEngineDeps,
    };
  }

  const runVoice = (deps: WorkflowEngineDeps) =>
    runWorkflow({
      runId: 'run-1',
      workflowId: 'wf-1',
      storedDefinition: voiceDefinition as never,
      trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
      deps,
    });

  it("emits waitKind 'event', not 'timer'", async () => {
    const { deps, events } = voiceDeps(ledgerFake());
    await runVoice(deps);

    const payload = events.find((e) => e.type === 'node_waiting')?.payload as {
      waitKind?: unknown;
      resumeAt?: unknown;
    };
    expect(payload?.waitKind).toBe('event');
    // The deadline is the TOKEN's expiry — the moment the wake stops being
    // possible — not a duration anyone configured.
    expect(payload?.resumeAt).toBe(TOKEN_EXPIRY);
  });

  it('carries the correlation to the ledger, which the timer park never does', async () => {
    const { deps } = voiceDeps(ledgerFake());
    await runVoice(deps);

    const parked = beginWaitCalls.at(-1);
    expect(parked?.correlationId).toBe('attempt-1');
  });
});
