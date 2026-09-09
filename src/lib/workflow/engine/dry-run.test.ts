// The dry run's whole claim is that it exercises the REAL path — same adapter,
// same runGraph, same handlers — and only swaps what touches data. These tests
// hold it to that: the trace must match what a live run would do, and nothing
// must reach a guest.
import { describe, expect, it } from 'vitest';

import { dryRunWorkflow } from './dry-run';

type Props = Record<string, unknown>;

function node(id: string, type: string, properties: Props = {}) {
  return {
    id,
    type: 'node',
    position: { x: 0, y: 0 },
    data: { type, icon: 'Lightning', properties },
  };
}

function slice(keyword = 'כן') {
  return {
    name: 'בדיקה',
    layoutDirection: 'DOWN',
    nodes: [
      node('t', 'trigger.whatsapp_inbound'),
      node('c', 'logic.condition', {
        field: 'message_text',
        operator: 'contains',
        value: keyword,
      }),
      node('a', 'action.update_guest_status', { status: 'attending' }),
    ],
    edges: [
      { id: 'e1', source: 't', target: 'c', sourceHandle: null },
      { id: 'e2', source: 'c', target: 'a', sourceHandle: 'true' },
    ],
  };
}

const ALL = ['t', 'c', 'a'];

function run(definition: unknown, over: Partial<Parameters<typeof dryRunWorkflow>[0]['scenario']> = {}) {
  return dryRunWorkflow({
    workflowId: 'wf-1',
    storedDefinition: definition,
    allNodeIds: ALL,
    scenario: {
      messageText: 'כן אני מגיע',
      buttonPayload: '',
      guestCase: 'one',
      ...over,
    },
  });
}

describe('dryRunWorkflow', () => {
  it('traces every node the graph actually ran, in order', async () => {
    const result = await run(slice());

    expect(result.outcome.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'c', 'a']);
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(result.skippedNodeIds).toEqual([]);
  });

  it('names the branch a condition chose', async () => {
    const result = await run(slice());
    expect(result.steps.find((s) => s.nodeId === 'c')?.nextPort).toBe('true');
  });

  it('reports what it WOULD have done, having done nothing', async () => {
    const result = await run(slice());
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]?.kind).toBe('submit_rsvp');
    expect(result.effects[0]?.description).toContain('attending');
  });

  it('names the nodes the untaken branch never reached', async () => {
    // The message says "כן" but the condition looks for "לא", so the action is
    // pruned. Reporting it as skipped is the difference between "it worked" and
    // "it worked, and here is the half that did not run".
    const result = await run(slice('לא'));

    expect(result.outcome.status).toBe('incomplete');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'c']);
    expect(result.skippedNodeIds).toEqual(['a']);
    expect(result.effects).toHaveLength(0);
  });

  it('surfaces the shared-phone case, which the happy path hides', async () => {
    const result = await run(slice(), { guestCase: 'several' });

    // Completes — nothing went wrong — but the action deliberately wrote
    // nothing, and the trace has to make that legible or the owner concludes
    // the workflow is broken.
    expect(result.outcome.status).toBe('completed');
    expect(result.effects).toHaveLength(0);
    expect(result.steps.find((s) => s.nodeId === 'a')?.output).toMatchObject({
      skipped: true,
      reason: 'ambiguous_contact',
    });
  });

  it('reports no guest behind the contact', async () => {
    const result = await run(slice(), { guestCase: 'none' });
    expect(result.steps.find((s) => s.nodeId === 'a')?.output).toMatchObject({
      reason: 'no_guest_for_contact',
    });
    expect(result.effects).toHaveLength(0);
  });

  it('reports a contract violation without running anything', async () => {
    const broken = slice();
    broken.nodes.push(node('t2', 'trigger.whatsapp_inbound'));
    broken.edges.push({ id: 'e3', source: 't2', target: 'c', sourceHandle: null });

    const result = await run(broken);

    expect(result.outcome.status).toBe('failed');
    if (result.outcome.status !== 'failed') return;
    expect(result.outcome.message).toContain('צעדי פתיחה');
    expect(result.steps).toHaveLength(0);
    expect(result.effects).toHaveLength(0);
  });

  it('reads the button payload, so a quick-reply tap is testable', async () => {
    const byButton = slice();
    byButton.nodes[1] = node('c', 'logic.condition', {
      field: 'button_payload',
      operator: 'equals',
      value: 'rsvp_attending',
    });

    const hit = await run(byButton, { messageText: '', buttonPayload: 'rsvp_attending' });
    expect(hit.effects).toHaveLength(1);

    const miss = await run(byButton, { messageText: '', buttonPayload: 'rsvp_declined' });
    expect(miss.effects).toHaveLength(0);
  });
});
