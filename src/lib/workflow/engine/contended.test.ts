import { describe, expect, it } from 'vitest';

import type { StepClaim, WorkflowEngineDeps } from './ports';
import { runWorkflow } from './run-workflow';

// A second delivery of the SAME run meeting a node the first one is still inside.
//
// ⚠️ THIS USED TO END THE RUN. `claimStep` returns `in_flight`, the runner turns
// that into a `PermanentNodeExecutionError`, and — because throwing is the only
// way a node can stop the graph — it arrived as `node_failed` +
// `execution_failed` and the run was written `failed`. An owner's automation was
// marked broken because two jobs raced, which is a scheduling fact about pg-boss
// and says nothing at all about the workflow they drew.
//
// It is not a rare shape either, and that is why it is worth a test rather than
// a comment. `singletonKey` enforces nothing on a `standard` queue (pg-boss
// 12.30.0: every unique index over `singleton_key` is policy-conditioned), and
// `failJobsByTimeout` re-queues a job whose handler outlived `expireInSeconds`
// while that handler is still running. Two deliveries for one run is something
// the queue permits by design.
//
// What this pins:
//   1. the outcome is `contended`, never `failed`;
//   2. NOTHING is written to the run row — not even 'running';
//   3. the owner's log shows no failure for it.

type Event = { type: string; nodeId?: string; payload?: unknown };

const node = (id: string, type: string, properties: Record<string, unknown> = {}) => ({
  id,
  type: 'node',
  position: { x: 0, y: 0 },
  data: { type, icon: 'Lightning', properties: { label: id, description: 'd', ...properties } },
});

/** trigger → notify */
const definition = {
  name: 'w',
  layoutDirection: 'DOWN',
  nodes: [
    node('t', 'trigger.whatsapp_inbound'),
    node('n1', 'action.notify_team', { level: 'info', title: 'שלום' }),
  ],
  edges: [{ id: 'e1', source: 't', target: 'n1', sourceHandle: null }],
};

/**
 * A ledger whose claim answer is chosen per node.
 *
 * `in_flight` is the real ledger's answer for a 'running' row still inside its
 * lease — the exact state a live attempt leaves behind.
 */
function ledgerFake(claims: Record<string, StepClaim['kind']>) {
  const failed: string[] = [];
  return {
    ledger: {
      async claimStep({ nodeId }: { nodeId: string }): Promise<StepClaim> {
        const kind = claims[nodeId] ?? 'claimed';
        return kind === 'in_flight' ? { kind: 'in_flight' } : { kind: 'claimed' };
      },
      async completeStep() {},
      async failStep({ nodeId }: { nodeId: string }) {
        failed.push(nodeId);
      },
      async beginWait() {},
    },
    failed,
  };
}

function makeDeps(claims: Record<string, StepClaim['kind']>) {
  const { ledger, failed } = ledgerFake(claims);
  const statuses: { status: string; errorMessage?: string }[] = [];
  const events: Event[] = [];
  const notified: string[] = [];

  const deps = {
    ledger,
    runs: {
      async setRunStatus({ status, errorMessage }: { status: string; errorMessage?: string }) {
        statuses.push({ status, ...(errorMessage ? { errorMessage } : {}) });
      },
    },
    guests: {} as WorkflowEngineDeps['guests'],
    alerts: {
      async notifyTeam({ title }: { title: string }) {
        notified.push(title);
        return { sent: true };
      },
    },
    webhook: { post: async () => ({ ok: true, status: 200 }) },
    log: {
      async appendEvent(e: Event) {
        events.push(e);
      },
    },
  } as unknown as WorkflowEngineDeps;

  return { deps, statuses, events, notified, failed };
}

const run = (deps: WorkflowEngineDeps) =>
  runWorkflow({
    runId: 'run-1',
    workflowId: 'wf-1',
    storedDefinition: definition,
    trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
    deps,
  });

describe('a node another delivery already holds', () => {
  it('reports `contended`, not `failed`', async () => {
    const { deps } = makeDeps({ n1: 'in_flight' });
    // `reason` distinguishes the two ways a delivery stops owning its run:
    // 'in_flight' is "someone else is already on this node", 'abandoned' is
    // "the queue took the job from me". Both are the same outcome for the run.
    expect(await run(deps)).toEqual({ status: 'contended', nodeId: 'n1', reason: 'in_flight' });
  });

  it('⚠️ writes no TERMINAL status — the run is left in flight', async () => {
    // The ordinary 'running' from `execution_started` still lands: the runner
    // emits it before any node is claimed, so nothing can know yet that this
    // delivery is the loser. What must not land is a verdict — 'failed' above
    // all, which is what this replaced.
    const { deps, statuses } = makeDeps({ n1: 'in_flight' });
    await run(deps);
    expect(statuses.map((s) => s.status)).toEqual(['running']);
  });

  it('⚠️ stops writing the moment it knows it lost', async () => {
    // Everything after the claim is the winner's to write. The guard is in
    // `updateStatus` rather than only on the outcome, because `runGraph` goes on
    // to report the contended node as a failed execution and would otherwise
    // write that verdict on a run that is working perfectly.
    const { deps, statuses } = makeDeps({ n1: 'in_flight' });
    await run(deps);
    expect(statuses.map((s) => s.status)).not.toContain('failed');
    expect(statuses.map((s) => s.status)).not.toContain('completed');
  });

  it('⚠️ the owner’s log shows no failure', async () => {
    const { deps, events } = makeDeps({ n1: 'in_flight' });
    await run(deps);
    expect(events.map((e) => e.type)).not.toContain('node_failed');
    expect(events.map((e) => e.type)).not.toContain('execution_failed');
  });

  it('does not run the contended node’s side effect', async () => {
    const { deps, notified } = makeDeps({ n1: 'in_flight' });
    await run(deps);
    // The point of stopping: the attempt that holds the node is doing this.
    expect(notified).toEqual([]);
  });

  it('a REAL failure still fails — the suppression is narrow', async () => {
    // Same graph, same engine, an unconfigured node instead of a contended one.
    // Nothing about the interception may soften an actual broken workflow.
    const { deps, statuses } = makeDeps({});
    const bad = {
      ...definition,
      nodes: [node('t', 'trigger.whatsapp_inbound'), node('n1', 'action.send_template', {})],
    };
    const outcome = await runWorkflow({
      runId: 'run-1',
      workflowId: 'wf-1',
      storedDefinition: bad,
      trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
      deps,
    });
    expect(outcome.status).toBe('failed');
    expect(statuses.map((s) => s.status)).toContain('failed');
  });
});

// The OTHER way a delivery stops owning its run: pg-boss took the job back.
describe('the queue takes the job away mid-walk', () => {
  it('⚠️ stops before the next node instead of walking on beside the retry', async () => {
    // pg-boss aborts `job.signal` when the handler outlives `expireInSeconds` —
    // by which point it has DELETED the active job and re-inserted it as `retry`
    // (`failJobsByTimeout`), so this run already belongs to another delivery.
    // Aborting cannot stop work already in flight, so the guarantee is the one
    // that is actually available: no FURTHER node is claimed or executed.
    const { deps, notified, statuses } = makeDeps({});
    const outcome = await runWorkflow({
      runId: 'run-1',
      workflowId: 'wf-1',
      storedDefinition: definition,
      trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
      signal: AbortSignal.abort(),
      deps,
    });

    // 't', the trigger — the FIRST node reached. The check sits before the claim,
    // so a signal already aborted when the walk begins stops it at the entry node
    // rather than one node in.
    expect(outcome).toEqual({ status: 'contended', nodeId: 't', reason: 'abandoned' });
    // The side effect the retry is about to perform did not happen twice.
    expect(notified).toEqual([]);
    // And no verdict was written on a run someone else is running.
    expect(statuses.map((s) => s.status)).not.toContain('failed');
  });

  it('a live signal changes nothing', async () => {
    const { deps, notified } = makeDeps({});
    const outcome = await runWorkflow({
      runId: 'run-1',
      workflowId: 'wf-1',
      storedDefinition: definition,
      trigger: { eventId: 'e1', contactId: 'c1', message_text: 'כן', button_payload: '' },
      signal: new AbortController().signal,
      deps,
    });
    expect(outcome.status).toBe('completed');
    expect(notified).toEqual(['שלום']);
  });
});
