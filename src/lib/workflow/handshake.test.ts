import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { loadRun, ledger, runs, log, guests, alerts, webhook, origin, markReady } =
  vi.hoisted(() => ({
    loadRun: vi.fn(),
    ledger: vi.fn(),
    runs: vi.fn(),
    log: vi.fn(),
    guests: vi.fn(),
    alerts: vi.fn(),
    webhook: vi.fn(),
    origin: vi.fn(async () => 'https://x.test'),
    markReady: vi.fn(),
  }));

vi.mock('./store', () => ({
  loadRunForExecution: loadRun,
  createStepLedger: ledger,
  createRunStore: runs,
  createExecutionLog: log,
  listStuckWaitingRuns: vi.fn(async () => []),
}));
vi.mock('./guest-actions', () => ({ createGuestActions: guests }));
vi.mock('./team-alerts', () => ({ createTeamAlerts: alerts }));
vi.mock('./outbound-webhook', () => ({ createOutboundWebhook: webhook }));
vi.mock('@/lib/url', () => ({ getAppOrigin: origin }));
vi.mock('./wake-store', () => ({ markParkedRunReady: markReady }));

const { runWorkflow } = vi.hoisted(() => ({ runWorkflow: vi.fn() }));
vi.mock('./engine/run-workflow', () => ({ runWorkflow }));

import { handleWorkflowRun, pullWorkflowRunForward } from './enqueue';

// THE REGISTER→CHECK HANDSHAKE, and the four races it has to survive.
//
// ⚠️ WHY A HANDSHAKE AT ALL. A node decides to wait by READING the world, and
// the event it is waiting for can land between that read and the park becoming
// something a callback can find. The callback that fires in that window does
// exactly the right thing — it looks for a waiting run, finds none, and reports
// nothing to wake — and the run then sleeps to its ceiling with the answer
// already sitting in the database. Without this, an event wake is best-effort.
//
// ⚠️ SCOPE, stated so these tests are not read as proving more than they do.
// Everything below drives TWO LIVE ACTORS racing, which is the case that happens
// on every healthy call. None of it covers a CRASH: the step row, the run row,
// the enqueue and the check are four separate writes with no transaction around
// them, and a process dying between them leaves gaps this suite says nothing
// about. `handleWorkflowRun` enumerates those three gaps where they occur.
//
// ⚠️ AND WHY THIS ORDER. Checking before registering does not fix it, it only
// moves the window: a callback arriving between a "not yet" answer and the
// enqueue would find a waiting run with NO pending job to pull forward, and lose
// the wake just the same. Register the listener, THEN ask whether you missed it.

const RUN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CEILING = '2026-09-15T12:00:00.000Z';

/** Records the order of the queue and database calls, which is the contract. */
function bossFake() {
  const calls: string[] = [];
  const boss = {
    send: vi.fn(async () => {
      calls.push('enqueue');
      return 'job-1';
    }),
    update: vi.fn(async () => {
      calls.push('pull');
      return { jobs: ['job-1'], updated: 1 };
    }),
  };
  return { boss, calls };
}

function parksWith(verify?: () => Promise<boolean>) {
  runWorkflow.mockResolvedValue({
    status: 'waiting',
    resumeAt: CEILING,
    nodeId: 'node-1',
    correlationId: CORR,
    ...(verify ? { verify } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  loadRun.mockResolvedValue({
    runId: RUN,
    workflowId: 'wf-1',
    status: 'running',
    storedDefinition: {},
    definitionSnapshot: null,
    triggerPayload: {},
  });
  markReady.mockResolvedValue(true);
});

/** Puts the CAS into the same ordered trace as the queue calls. */
function traceCas(calls: string[], result = true) {
  markReady.mockImplementation(async () => {
    calls.push('cas');
    return result;
  });
}

describe('the wait handshake', () => {
  it('⚠️ REGISTERS the fallback wake-up BEFORE it asks whether the event happened', async () => {
    // ⚠️ ONE ORDERED LOG, not two arrays. An earlier version of this test asserted
    // `calls[0] === 'enqueue'` and `seen === ['verify']` separately — which both
    // pass just as happily when the order is REVERSED, because there is only one
    // queue call either way. The ordering is the entire claim of this change, so
    // it has to be a single sequence.
    const { boss, calls } = bossFake();
    parksWith(async () => {
      calls.push('verify');
      return false;
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(calls).toEqual(['enqueue', 'verify']);
  });

  it('race 1 — the event happened BEFORE the park: resumes immediately', async () => {
    // The callback fired while the node was still deciding. It found no waiting
    // run and did nothing, correctly. This is the only thing that notices.
    const { boss, calls } = bossFake();
    traceCas(calls);
    parksWith(async () => {
      calls.push('verify');
      return true;
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(markReady).toHaveBeenCalledWith({
      runId: RUN,
      nodeId: 'node-1',
      correlationId: CORR,
    });
    // All four stages in ONE sequence, so a reordering of any of them fails here
    // rather than passing on separate counters.
    expect(calls).toEqual(['enqueue', 'verify', 'cas', 'pull']);
  });

  it('race 2 — nothing happened: the run stays parked on its ceiling', async () => {
    const { boss, calls } = bossFake();
    parksWith(async () => {
      calls.push('verify');
      return false;
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(markReady).not.toHaveBeenCalled();
    expect(calls).toEqual(['enqueue', 'verify']);
  });

  it('race 3 — the CAS refuses: nothing is pulled forward', async () => {
    // The callback won the race and already moved the run on. `markParkedRunReady`
    // is the single gate both paths go through, so the loser simply does nothing
    // rather than delivering a run for a reason that no longer holds.
    const { boss, calls } = bossFake();
    traceCas(calls, false);
    parksWith(async () => {
      calls.push('verify');
      return true;
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(calls).toEqual(['enqueue', 'verify', 'cas']);
  });

  it('⚠️ race 4 — a verifier that THROWS leaves the run waiting, never failed', async () => {
    // A transient database fault during the CHECK says nothing about the call.
    // The fallback job is already registered, so the run still wakes — at its
    // ceiling, or when the callback arrives. Failing the workflow here would turn
    // a healthy call into a broken automation.
    const { boss, calls } = bossFake();
    parksWith(async () => {
      calls.push('verify');
      throw new Error('pooler timeout');
    });

    const outcome = await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(outcome.status).toBe('waiting');
    // The enqueue still happened — which is exactly why a failed check is
    // survivable: the fallback is already registered before anyone asks.
    expect(calls).toEqual(['enqueue', 'verify']);
    expect(markReady).not.toHaveBeenCalled();
  });

  it('a park with no verifier behaves exactly as it did before', async () => {
    // `logic.wait` names a clock and no event. Nothing to have missed.
    const { boss, calls } = bossFake();
    parksWith(undefined);

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(calls).toEqual(['enqueue']);
    expect(markReady).not.toHaveBeenCalled();
  });
});

describe('pullWorkflowRunForward', () => {
  it('edits the pending job rather than adding a second one', async () => {
    const { boss } = bossFake();
    expect(await pullWorkflowRunForward(boss as never, RUN)).toBe(true);
    expect(boss.send).not.toHaveBeenCalled();
    expect(boss.update).toHaveBeenCalled();
  });
});

// THE WINDOW THE 0ב REVIEW ASKED ABOUT, driven explicitly.
//
// The run is already published as `waiting` with its correlation, and the
// fallback job does NOT exist yet. A callback lands right there: its CAS
// succeeds, it has no job to pull forward, and it answers 200. The review's
// worry was that the handshake's own CAS would then return false — "the callback
// already won" — leaving the job at the ceiling and the early wake lost.
//
// ⚠️ IT DOES NOT, AND THE REASON IS THE CAS'S IDEMPOTENCE. The RPC predicates on
// the run being `waiting` with this correlation and the step being `waiting`, and
// it changes `wait_until` and nothing else — so the first call leaves every one
// of its own predicates true. MEASURED against the live function on 2026-09-14:
// callback CAS true, second CAS true, a DIFFERENT correlation false. That is
// what lets whichever party arrives second finish the delivery the first could
// not, and it is why a boolean is enough here: `false` only ever means the wait
// genuinely moved on, never "someone else got here first".
describe('a callback landing between publish and register', () => {
  it('⚠️ still resumes early — the second CAS succeeds and finds the job', async () => {
    const { boss, calls } = bossFake();
    // The callback already ran its CAS against the live run. The handshake's CAS
    // therefore meets a step whose `wait_until` is already now — and answers true
    // again, because none of its predicates changed.
    traceCas(calls, true);
    parksWith(async () => {
      calls.push('verify');
      return true; // the call concluded during the window
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    // The fallback was registered first, so by the time the CAS says "ready"
    // there IS a job to pull forward — which is the whole point of this order.
    expect(calls).toEqual(['enqueue', 'verify', 'cas', 'pull']);
  });

  it('a correlation that no longer belongs to this wait is refused', async () => {
    // The contrast case, and the only thing `false` is allowed to mean: the run
    // woke, carried on, and parked again for something else. Touching its job
    // then would deliver a run for a reason that no longer applies.
    const { boss, calls } = bossFake();
    traceCas(calls, false);
    parksWith(async () => {
      calls.push('verify');
      return true;
    });

    await handleWorkflowRun({ runId: RUN }, boss as never);

    expect(calls).toEqual(['enqueue', 'verify', 'cas']);
  });
});
