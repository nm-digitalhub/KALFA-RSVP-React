import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyDryRunTrace,
  applyEvent,
  applySnapshot,
  resetExecution,
  useExecutionStore,
} from './use-execution-store';

// A parked run, from the engine's event to what the owner sees.
//
// ⚠️ WHY THIS FILE EXISTS. `node_waiting` is a declared member of the vendored
// `ExecutionEventType` — it has its own `NodeWaitingEvent` type in
// `vendor/workflowbuilder/types/workflow-execution/execution-events.ts` — and the
// client was ported without it. The engine wrote the event, the SSE route
// carried it, and every reader on this page dropped it:
//
//   the reducer had no case, so a parked node kept `running` and its SPINNER
//   the run's header kept saying "רץ" until a reconnect brought a snapshot
//   the log printed the raw string `node_waiting` on a Hebrew screen
//   `resumeAt` — attached by the engine expressly "for the log panel" — was
//     written to every parked run's row and displayed nowhere
//
// `logic.wait` allows a year of that. Nothing errored; the canvas simply lied.
//
// The last two tests are the ones that matter in a year: they compare our label
// tables against the vendor's own vocabulary, so the NEXT event or status the
// upstream adds fails here instead of appearing in English on a customer's
// screen.

const DIR = join(
  process.cwd(),
  'src/app/(admin)/admin/workflows/[id]',
);
const VENDOR = join(
  process.cwd(),
  'src/lib/workflow/vendor/workflowbuilder/types/workflow-execution/execution-events.ts',
);

const RESUME_AT = '2026-09-18T11:30:00.000Z';

function waitingEvent(nodeId: string, resumeAt?: string, waitKind?: 'timer' | 'event') {
  return {
    seq: 1,
    type: 'node_waiting',
    nodeId,
    timestamp: '2026-09-15T09:00:00.000Z',
    ...(resumeAt ? { payload: { resumeAt, ...(waitKind ? { waitKind } : {}) } } : {}),
  };
}

beforeEach(() => {
  resetExecution();
});

describe('a parked node reaches the canvas as parked', () => {
  it('marks the node waiting and keeps the deadline', () => {
    applyEvent({ seq: 0, type: 'node_started', nodeId: 'n1', timestamp: '' });
    expect(useExecutionStore.getState().nodeStates.n1?.status).toBe('running');

    applyEvent(waitingEvent('n1', RESUME_AT));

    const state = useExecutionStore.getState().nodeStates.n1;
    expect(state?.status).toBe('waiting');
    expect(state?.resumeAt).toBe(RESUME_AT);
  });

  it('a vendored join-wait carries no deadline, and none is invented', () => {
    // The vendor's own payload is `{ waitingForNodeIds?: string[] }` — a node
    // waiting on its predecessors rather than on a clock. It must still mark the
    // node; it must not grow a `resumeAt` out of nothing.
    applyEvent(waitingEvent('n2'));

    const state = useExecutionStore.getState().nodeStates.n2;
    expect(state?.status).toBe('waiting');
    expect(state?.resumeAt).toBeUndefined();
  });

  it('⚠️ carries WHAT it waits on, because the same date means two things', () => {
    // A timer's `resumeAt` is when the run continues. A correlated wait's is
    // when it gives up — the callback may land in a minute. Without the kind the
    // canvas said "continues at 14:30" about a node waiting for a phone call.
    applyEvent(waitingEvent('n1', RESUME_AT, 'event'));
    expect(useExecutionStore.getState().nodeStates.n1?.waitKind).toBe('event');

    resetExecution();
    applyEvent(waitingEvent('n2', RESUME_AT, 'timer'));
    expect(useExecutionStore.getState().nodeStates.n2?.waitKind).toBe('timer');
  });

  it('a row written before `waitKind` shipped stays vague, not wrong', () => {
    // Every parked run recorded before this field existed replays through the
    // same reducer. Reading a missing value as 'timer' would make an old
    // correlated wait describe itself as a scheduled resume.
    applyEvent(waitingEvent('n1', RESUME_AT));
    const state = useExecutionStore.getState().nodeStates.n1;
    expect(state?.resumeAt).toBe(RESUME_AT);
    expect(state?.waitKind).toBeUndefined();
  });

  it('⚠️ tolerates payload fields upstream has not invented yet', () => {
    // The contract is upstream's and ours only extends it. A future
    // `NodeWaitingPayload` member — `waitingForNodeIds` is already declared —
    // must pass through without disturbing what we do read. A reducer that
    // threw, or that refused the event, would turn an upstream addition into
    // our outage.
    applyEvent({
      seq: 1,
      type: 'node_waiting',
      nodeId: 'n1',
      timestamp: '',
      payload: {
        resumeAt: RESUME_AT,
        waitKind: 'timer',
        waitingForNodeIds: ['a', 'b'],
        somethingAddedIn2027: { nested: true },
      },
    });

    const state = useExecutionStore.getState().nodeStates.n1;
    expect(state?.status).toBe('waiting');
    expect(state?.resumeAt).toBe(RESUME_AT);
    expect(state?.waitKind).toBe('timer');
  });

  it('an unrecognised waitKind is dropped rather than trusted', () => {
    // If upstream ever gives the field its own meaning, a third value must read
    // as "unknown" — which renders the neutral label — instead of being carried
    // into a type that says it is one of two things.
    applyEvent({
      seq: 1,
      type: 'node_waiting',
      nodeId: 'n1',
      timestamp: '',
      payload: { resumeAt: RESUME_AT, waitKind: 'human' },
    });

    expect(useExecutionStore.getState().nodeStates.n1?.waitKind).toBeUndefined();
  });
});

describe('⚠️ the upstream contract this projection rests on', () => {
  // Not a guard against upstream CHANGING — an event appearing there later is
  // not a breaking change, and its payload would have to be read before anyone
  // reacted. This pins the two facts the projection actually depends on, so
  // that if the vendored copy is refreshed and either stops being true, the
  // failure names itself here.
  const vendorSource = readFileSync(VENDOR, 'utf8');

  it('declares `node_waiting` as an execution event type', () => {
    expect(vendorSource).toMatch(/ExecutionEventType =[\s\S]*?'node_waiting'/);
  });

  it('types its payload as optional, which is what lets KALFA extend it', () => {
    // `payload?:` is the whole reason `resumeAt` and `waitKind` are legal
    // additions rather than a fork of the contract. A required, closed payload
    // would mean our two fields belong somewhere else.
    expect(vendorSource).toMatch(/type: 'node_waiting';\s*\n\s*payload\?:/);
  });

  it('⚠️ moves the RUN status too, because no execution_waiting event exists', () => {
    // The engine suppresses `execution_failed` while parking and writes
    // `waiting` straight to the row. Over a LIVE stream this node event is the
    // only signal the run parked — without it the header read "רץ" until a
    // reconnect delivered a snapshot, which is what hid the bug.
    applyEvent({ seq: 0, type: 'execution_started', timestamp: '' });
    expect(useExecutionStore.getState().status).toBe('running');

    applyEvent(waitingEvent('n1', RESUME_AT));
    expect(useExecutionStore.getState().status).toBe('waiting');
  });

  it('a snapshot replays it the same way a live event does', () => {
    // The two paths must not disagree: a reader who opens the page on a parked
    // run and a reader who watched it park should see the same canvas.
    applySnapshot({
      runId: 'r1',
      status: 'waiting' as never,
      lastSequence: 2,
      events: [
        { seq: 1, type: 'node_started', nodeId: 'n1', timestamp: '' },
        waitingEvent('n1', RESUME_AT),
      ],
    });

    const state = useExecutionStore.getState();
    expect(state.nodeStates.n1?.status).toBe('waiting');
    expect(state.nodeStates.n1?.resumeAt).toBe(RESUME_AT);
    expect(state.status).toBe('waiting');
  });
});

describe('a dry run that parks says so', () => {
  it('marks the node and emits a final line', () => {
    // A dry run reaching `logic.wait` ENDS there — nothing is scheduled. The
    // node produced no step, so without this it carried no marker and the log
    // just stopped, indistinguishable from a truncated trace.
    applyDryRunTrace({
      outcome: { status: 'waiting', resumeAt: RESUME_AT, nodeId: 'n9' },
      steps: [{ nodeId: 'n1', status: 'completed', output: { ok: true } }],
      skippedNodeIds: [],
    });

    const state = useExecutionStore.getState();
    expect(state.nodeStates.n9?.status).toBe('waiting');
    expect(state.nodeStates.n9?.resumeAt).toBe(RESUME_AT);

    const last = state.events.at(-1);
    expect(last?.type).toBe('node_waiting');
    expect(last?.nodeId).toBe('n9');
  });

  it('`contended` is marked too, without a deadline it does not have', () => {
    applyDryRunTrace({
      outcome: { status: 'contended', nodeId: 'n7' },
      steps: [],
      skippedNodeIds: [],
    });

    const state = useExecutionStore.getState();
    expect(state.nodeStates.n7?.status).toBe('waiting');
    expect(state.nodeStates.n7?.resumeAt).toBeUndefined();
    expect(state.events.at(-1)?.type).toBe('node_waiting');
  });
});

describe('⚠️ the Hebrew tables cover the vendor’s whole vocabulary', () => {
  // Read as TEXT rather than imported: `log-panel.tsx` is a client component
  // that pulls in the SDK, and the tables are module-local. The same approach as
  // `sdk-integration-invariants.test.ts`, for the same reason — the thing being
  // guarded is a literal in a file, and a type cannot see a missing key in a
  // `Record<string, string>`.
  const logPanel = readFileSync(join(DIR, 'log-panel.tsx'), 'utf8');
  const vendor = readFileSync(VENDOR, 'utf8');

  /** The members of a `type X = | 'a' | 'b'` union in the vendored source. */
  function unionMembers(typeName: string): string[] {
    const declaration = new RegExp(`export type ${typeName} =([\\s\\S]*?);`).exec(vendor);
    expect(declaration, `${typeName} is no longer declared in the vendored source`).not.toBeNull();
    return [...declaration![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  }

  it('every ExecutionEventType the vendor declares has a Hebrew label', () => {
    const labels = /const EVENT_LABEL[\s\S]*?\n};/.exec(logPanel)?.[0] ?? '';
    // `TerminalExecutionEventType` is referenced rather than spelled out in the
    // union, so its four members are read from their own tuple.
    const types = [...unionMembers('ExecutionEventType'), ...terminalEventTypes()];

    const missing = types.filter((t) => !labels.includes(`${t}:`));
    expect(
      missing,
      `EVENT_LABEL is missing these, so the log would print them in English: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every ExecutionStatus has one, plus KALFA’s own `waiting`', () => {
    const labels = /const STATUS_LABEL[\s\S]*?\n};/.exec(logPanel)?.[0] ?? '';
    const statuses = [
      ...unionMembers('ExecutionStatus'),
      ...terminalStatuses(),
      // Not the vendor's — a run parked on a `logic.wait` deadline is KALFA's
      // addition, and it is in the runs table's own RUN_STATUS_HE.
      'waiting',
    ];

    const missing = statuses.filter((s) => !labels.includes(`${s}:`));
    expect(
      missing,
      `STATUS_LABEL is missing these: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('and the two tables agree with the runs table on the same page', () => {
    // `page.tsx` translates the same statuses for the runs list. They drifted
    // once already — `waiting` and `cancelling` were there and missing here —
    // and a second divergence would be just as invisible.
    const page = readFileSync(join(DIR, 'page.tsx'), 'utf8');
    const runStatuses = [
      ...(/const RUN_STATUS_HE[\s\S]*?\n};/.exec(page)?.[0] ?? '').matchAll(/^\s{2}([a-z]+):/gm),
    ].map((m) => m[1]!);

    const statusLabels = /const STATUS_LABEL[\s\S]*?\n};/.exec(logPanel)?.[0] ?? '';
    const missing = runStatuses.filter((s) => !statusLabels.includes(`${s}:`));
    expect(
      missing,
      `the runs table translates these and the log panel does not: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  function terminalEventTypes(): string[] {
    const tuple = /TERMINAL_EXECUTION_EVENT_TYPES = \[([\s\S]*?)\]/.exec(vendor)?.[1] ?? '';
    return [...tuple.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  }

  function terminalStatuses(): string[] {
    const tuple = /TERMINAL_EXECUTION_STATUSES = \[([\s\S]*?)\]/.exec(vendor)?.[1] ?? '';
    return [...tuple.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
  }
});
