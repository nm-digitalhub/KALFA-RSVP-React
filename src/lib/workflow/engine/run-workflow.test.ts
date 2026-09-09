// The execution half of the contract. The adapter tests prove a bad graph never
// runs; these prove a good one runs exactly once.
//
// The centrepiece is 'a replayed run performs no side effect twice'. pg-boss is
// at-least-once and `runGraph` has no per-node checkpoint, so a retry replays
// the whole graph — every one of these nodes, including the one that changed a
// guest's RSVP. Without the ledger claim that is a second write; with it, the
// second pass returns the first pass's output and touches nothing.
import { describe, expect, it, vi } from 'vitest';

import {
  STEP_LEASE_MS,
  type GuestActionsPort,
  type RunStatus,
  type StepClaim,
  type StepLedgerPort,
  type WorkflowEngineDeps,
} from './ports';
import { runWorkflow } from './run-workflow';

// --- fakes -----------------------------------------------------------------

// An in-memory stand-in for workflow_run_steps, modelling the two behaviours
// that matter: `unique (run_id, node_id)` means a second claim is not a claim,
// and a `running` row older than STEP_LEASE_MS is reclaimed rather than treated
// as contended.
type LedgerRow = { status: 'running' | 'done'; startedAt: number; result?: unknown };

function fakeLedger(now = () => Date.now()) {
  const rows = new Map<string, LedgerRow>();
  const port: StepLedgerPort = {
    claimStep: vi.fn(async ({ runId, nodeId }): Promise<StepClaim> => {
      const key = `${runId}:${nodeId}`;
      const existing = rows.get(key);
      if (existing?.status === 'done') return { kind: 'already_done', result: existing.result };
      if (existing?.status === 'running') {
        // The lease. Inside the window another attempt is presumed live; past
        // it the holder is presumed dead and the row is taken over.
        if (now() - existing.startedAt < STEP_LEASE_MS) return { kind: 'in_flight' };
        rows.set(key, { status: 'running', startedAt: now() });
        return { kind: 'claimed' };
      }
      rows.set(key, { status: 'running', startedAt: now() });
      return { kind: 'claimed' };
    }),
    completeStep: vi.fn(async ({ runId, nodeId, result }) => {
      const key = `${runId}:${nodeId}`;
      rows.set(key, { status: 'done', startedAt: rows.get(key)?.startedAt ?? now(), result });
    }),
    failStep: vi.fn(async ({ runId, nodeId }) => {
      rows.delete(`${runId}:${nodeId}`);
    }),
  };
  return { port, rows };
}

function fakeGuests(guestCount = 1) {
  const submitted: { token: string; status: string }[] = [];
  const logged: string[] = [];
  const port: GuestActionsPort = {
    getGuestsForContact: async () =>
      Array.from({ length: guestCount }, (_, i) => ({
        id: `guest-${i}`,
        rsvp_token: `token-${i}`,
      })),
    submitRsvp: vi.fn(async (token, input) => {
      submitted.push({ token, status: input.status });
      return { ok: true };
    }),
    recordRsvpFromWhatsapp: vi.fn(async (_e, guestId) => {
      logged.push(guestId);
    }),
  };
  return { port, submitted, logged };
}

function fakeRuns() {
  const statuses: RunStatus[] = [];
  return {
    port: {
      setRunStatus: vi.fn(async ({ status }: { status: RunStatus }) => {
        statuses.push(status);
      }),
    },
    statuses,
  };
}

function deps(guestCount = 1): WorkflowEngineDeps & {
  _guests: ReturnType<typeof fakeGuests>;
  _ledger: ReturnType<typeof fakeLedger>;
  _runs: ReturnType<typeof fakeRuns>;
} {
  const ledger = fakeLedger();
  const guests = fakeGuests(guestCount);
  const runs = fakeRuns();
  return {
    ledger: ledger.port,
    guests: guests.port,
    runs: runs.port,
    _ledger: ledger,
    _guests: guests,
    _runs: runs,
  };
}

const TRIGGER = {
  eventId: 'event-1',
  contactId: 'contact-1',
  message_text: 'כן אני מגיע',
  button_payload: '',
};

// The slice, as the editor would save it: trigger → condition → action.
// `properties` is widened deliberately: a test rewrites one to inject a template
// reference, and the inferred literal type would refuse the new keys.
type Fixture = {
  name: string;
  layoutDirection: string;
  nodes: {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: { type: string; icon: string; properties: Record<string, unknown> };
  }[];
  edges: { id: string; source: string; target: string; sourceHandle: string | null }[];
};

function slice(keyword = 'כן'): Fixture {
  return {
    name: 'אישור אוטומטי',
    layoutDirection: 'DOWN',
    nodes: [
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: { type: 'trigger.whatsapp_inbound', icon: 'WhatsappLogo', properties: {} },
      },
      {
        id: 'c',
        type: 'node',
        position: { x: 0, y: 120 },
        data: {
          type: 'logic.condition',
          icon: 'GitBranch',
          properties: { field: 'message_text', operator: 'contains', value: keyword },
        },
      },
      {
        id: 'a',
        type: 'node',
        position: { x: 0, y: 240 },
        data: {
          type: 'action.update_guest_status',
          icon: 'UserCheck',
          properties: { status: 'attending' },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 't', target: 'c', sourceHandle: null },
      { id: 'e2', source: 'c', target: 'a', sourceHandle: 'true' },
    ],
  };
}

function run(storedDefinition: unknown, d: WorkflowEngineDeps, runId = 'run-1') {
  return runWorkflow({
    runId,
    workflowId: 'wf-1',
    storedDefinition,
    trigger: TRIGGER,
    deps: d,
  });
}

// --- the happy path --------------------------------------------------------

describe('runWorkflow', () => {
  it('runs the slice and actually changes the guest', async () => {
    const d = deps();
    const outcome = await run(slice(), d);

    expect(outcome.status).toBe('completed');
    expect(d._guests.submitted).toEqual([{ token: 'token-0', status: 'attending' }]);
    expect(d._guests.logged).toEqual(['guest-0']);
    expect(d._runs.statuses).toEqual(['running', 'completed']);
  });

  it('takes the false branch and touches no guest when the condition misses', async () => {
    const d = deps();
    // The message says "כן"; the condition looks for "לא", so the true branch
    // is pruned. The action sits only on 'true', so nothing runs after the
    // condition — and the condition named a port that reached nothing, which is
    // exactly what 'incomplete' means.
    const outcome = await run(slice('לא'), d);

    expect(outcome.status).toBe('incomplete');
    if (outcome.status !== 'incomplete') return;
    expect(outcome.deadEnds).toEqual([{ nodeId: 'c', port: 'false' }]);
    expect(d._guests.submitted).toHaveLength(0);
  });

  it('refuses to guess when one phone backs several guests', async () => {
    const d = deps(2);
    const outcome = await run(slice(), d);

    // The run completes — nothing went wrong — but the action wrote nothing.
    // Same rule as the inbound webhook's C9: a shared phone makes "who did this
    // mean?" unanswerable, and guessing would set the wrong guest's RSVP.
    expect(outcome.status).toBe('completed');
    expect(d._guests.submitted).toHaveLength(0);
    expect(d._ledger.rows.get('run-1:a')?.result).toMatchObject({
      output: { skipped: true, reason: 'ambiguous_contact' },
    });
  });
});

// --- the one that matters --------------------------------------------------

describe('at-least-once delivery', () => {
  it('a replayed run performs no side effect twice', async () => {
    const d = deps();

    const first = await run(slice(), d);
    expect(first.status).toBe('completed');
    expect(d._guests.submitted).toHaveLength(1);

    // The same job, delivered again — a crash after the graph finished but
    // before pg-boss recorded completion, or any of the ordinary at-least-once
    // reasons. Same runId, because the run row is the same row.
    const second = await run(slice(), d);

    expect(second.status).toBe('completed');
    // The assertion the whole ledger exists for.
    expect(d._guests.submitted).toHaveLength(1);
    expect(d._guests.logged).toEqual(['guest-0']);
  });

  it('a replay routes down the branch the first attempt chose', async () => {
    // Not the same thing as "does not write twice". A condition re-evaluated on
    // an empty replay output could pick the OTHER branch, and a subtree that
    // never ran would run now. The claim returns the original output precisely
    // so the second pass reproduces the first pass's shape.
    const d = deps();
    await run(slice(), d);

    const claimCalls = () => (d.ledger.claimStep as ReturnType<typeof vi.fn>).mock.calls.length;
    const before = claimCalls();

    await run(slice(), d);

    // Every node was claimed again (the graph really did replay) …
    expect(claimCalls()).toBe(before * 2);
    // … and every one of them short-circuited.
    expect((d.guests.submitRsvp as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('stops while another attempt genuinely holds a node', async () => {
    const d = deps();
    // A row claimed moments ago. `singletonKey: runId` should make this
    // unreachable for a retry of the same run, but the guard is what makes that
    // assumption safe to hold rather than merely hoped for.
    d._ledger.rows.set('run-1:t', { status: 'running', startedAt: Date.now() });

    const outcome = await run(slice(), d);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.message).toContain('כבר רץ');
    expect(d._guests.submitted).toHaveLength(0);
  });

  it('recovers a run whose worker died holding a node', async () => {
    // WITHOUT the lease this is the shape that makes a crash permanent: the
    // retry meets the dead attempt's own `running` row on the very first node
    // and fails, every time, until the retry limit is gone. The run would be
    // safe and useless.
    const d = deps();
    d._ledger.rows.set('run-1:t', {
      status: 'running',
      startedAt: Date.now() - STEP_LEASE_MS - 1,
    });

    const outcome = await run(slice(), d);

    expect(outcome.status).toBe('completed');
    expect(d._guests.submitted).toEqual([{ token: 'token-0', status: 'attending' }]);
  });

  it('a reclaimed node runs again — which is why an action must be safe twice', async () => {
    // The cost of the lease, made explicit rather than left as a footnote. The
    // action's side effect landed; `completeStep` did not (the crash fell
    // between them). Reclaiming re-runs it.
    //
    // This test asserts the SECOND call happens. It is not a defect to fix — it
    // is the property every action node must tolerate, and the reason
    // update_guest_status was chosen as the first action: submit_rsvp setting
    // the same status again yields the same row. An action that cannot say that
    // needs its own deterministic dedup key before it may exist.
    const d = deps();
    await run(slice(), d);
    expect(d._guests.submitted).toHaveLength(1);

    // Rewind the action's row to 'running', as a crash between effect and
    // record would leave it, and age it past the lease.
    d._ledger.rows.set('run-1:a', {
      status: 'running',
      startedAt: Date.now() - STEP_LEASE_MS - 1,
    });

    const outcome = await run(slice(), d);

    expect(outcome.status).toBe('completed');
    expect(d._guests.submitted).toHaveLength(2);
    expect(d._guests.submitted[1]).toEqual({ token: 'token-0', status: 'attending' });
  });
});

// --- validation gates execution -------------------------------------------

describe('a graph that fails the contract never executes', () => {
  it('reports the conversion errors and claims no step', async () => {
    const d = deps();
    const broken = slice();
    // Two triggers: every node is real and runnable, so nothing but the
    // contract stops this graph.
    broken.nodes.push({
      id: 't2',
      type: 'node',
      position: { x: 200, y: 0 },
      data: { type: 'trigger.whatsapp_inbound', icon: 'WhatsappLogo', properties: {} },
    });
    broken.edges.push({ id: 'e3', source: 't2', target: 'c', sourceHandle: null });

    const outcome = await run(broken, d);

    expect(outcome.status).toBe('failed');
    expect(d.ledger.claimStep).not.toHaveBeenCalled();
    expect(d.guests.submitRsvp).not.toHaveBeenCalled();
    expect(d._runs.statuses).toEqual(['failed']);
  });

  it('blocks a template reference before anything runs', async () => {
    const d = deps();
    const withReference = slice();
    withReference.nodes[2]!.data.properties = {
      status: 'attending',
      label: 'שלום {{trigger.guest.name}}',
    };

    const outcome = await run(withReference, d);

    expect(outcome.status).toBe('failed');
    expect(d.ledger.claimStep).not.toHaveBeenCalled();
  });
});
