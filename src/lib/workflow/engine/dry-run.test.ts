// The dry run's whole claim is that it exercises the REAL path — same adapter,
// same runGraph, same handlers — and only swaps what touches data. These tests
// hold it to that: the trace must match what a live run would do, and nothing
// must reach a guest.
import { describe, expect, it } from 'vitest';

import { CONDITION_BRANCH_HANDLES } from '../catalogue/types';

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

type Edge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
};

function slice(keyword = 'כן'): {
  name: string;
  layoutDirection: string;
  nodes: ReturnType<typeof node>[];
  edges: Edge[];
} {
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
      // The id the EDITOR writes on the condition's "מתקיים" handle. A literal
      // 'true' here is what let the branch defect pass this suite for a week.
      { id: 'e2', source: 'c', target: 'a', sourceHandle: CONDITION_BRANCH_HANDLES.true },
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
    expect(result.steps.find((s) => s.nodeId === 'c')?.nextPort).toBe(
      CONDITION_BRANCH_HANDLES.true,
    );
  });

  // The regression guard for the branch defect. Every other test in this file
  // wires ONE branch, which cannot distinguish "the right edge fired" from "the
  // only edge fired" — and that is precisely the blind spot the handler's old
  // 'true' / 'false' ports lived in. This wires BOTH, with the ids the editor
  // actually writes, and asserts the chosen half ran while the other did not.
  it('fires only the matching branch when both are wired', async () => {
    const both = slice();
    both.nodes.push(node('b', 'action.update_guest_status', { status: 'declined' }));
    both.edges.push({
      id: 'e3',
      source: 'c',
      target: 'b',
      sourceHandle: CONDITION_BRANCH_HANDLES.false,
    });

    const yes = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: both,
      allNodeIds: [...ALL, 'b'],
      scenario: {
        messageText: 'כן אני מגיע',
        buttonPayload: '',
        guestCase: 'one',
      },
    });

    expect(yes.outcome.status).toBe('completed');
    expect(yes.steps.map((s) => s.nodeId)).toEqual(['t', 'c', 'a']);
    expect(yes.skippedNodeIds).toEqual(['b']);
    expect(yes.effects).toHaveLength(1);
    expect(yes.effects[0]?.description).toContain('attending');

    // Same graph, a message the condition rejects: the other half runs instead.
    // Both halves being reachable is the whole claim.
    const no = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: both,
      allNodeIds: [...ALL, 'b'],
      scenario: {
        messageText: 'לא מגיע',
        buttonPayload: '',
        guestCase: 'one',
      },
    });

    expect(no.outcome.status).toBe('completed');
    expect(no.steps.map((s) => s.nodeId)).toEqual(['t', 'c', 'b']);
    expect(no.skippedNodeIds).toEqual(['a']);
    expect(no.effects[0]?.description).toContain('declined');
  });

  // The send node: the first step whose failure a GUEST would notice.
  it('quotes the message it would have sent, and sends nothing', async () => {
    const withReply = slice();
    withReply.nodes.push(
      node('r', 'action.send_whatsapp', { body: 'תודה! רשמנו שאתם מגיעים 🎉' }),
    );
    withReply.edges.push({ id: 'e4', source: 'a', target: 'r', sourceHandle: 'source' });

    const result = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: withReply,
      allNodeIds: [...ALL, 'r'],
      scenario: { messageText: 'כן אני מגיע', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.outcome.status).toBe('completed');
    const send = result.effects.find((e) => e.kind === 'send_whatsapp');
    // Quoted in full: an owner judges a message by its exact wording, and a
    // summary would hide a typo that reaches every guest.
    expect(send?.description).toContain('תודה! רשמנו שאתם מגיעים 🎉');
    expect(result.steps.find((s) => s.nodeId === 'r')?.output).toMatchObject({ sent: true });
  });

  it('refuses an empty message instead of sending a blank one', async () => {
    const blank = slice();
    blank.nodes.push(node('r', 'action.send_whatsapp', { body: '   ' }));
    blank.edges.push({ id: 'e4', source: 'a', target: 'r', sourceHandle: 'source' });

    const result = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: blank,
      allNodeIds: [...ALL, 'r'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    // Completed, not failed: nothing went wrong in the graph. But no effect was
    // recorded, which is what stops a whitespace-only body from reaching Meta.
    expect(result.outcome.status).toBe('completed');
    expect(result.effects.filter((e) => e.kind === 'send_whatsapp')).toHaveLength(0);
    expect(result.steps.find((s) => s.nodeId === 'r')?.output).toMatchObject({
      skipped: true,
      reason: 'empty_body',
    });
  });

  // Templates, end to end: the editor stores the raw `{{…}}`, the activity
  // runner resolves it against the live context, and the guest sees a value.
  it('resolves {{trigger.…}} and {{global.…}} in a message body', async () => {
    const personalised = slice();
    personalised.nodes.push(
      node('r', 'action.send_whatsapp', {
        body: 'תודה! קיבלנו "{{trigger.message_text}}" עבור {{global.eventName}}.',
      }),
    );
    personalised.edges.push({ id: 'e4', source: 'a', target: 'r', sourceHandle: 'source' });

    const result = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: {
        ...personalised,
        globalVariables: {
          v1: {
            id: 'v1',
            name: 'eventName',
            type: 'string',
            defaultValue: 'החתונה של דנה ויוסי',
            description: '',
          },
        },
      },
      allNodeIds: [...ALL, 'r'],
      scenario: { messageText: 'כן אני מגיע', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.outcome.status).toBe('completed');
    const send = result.effects.find((e) => e.kind === 'send_whatsapp');
    expect(send?.description).toContain('קיבלנו "כן אני מגיע"');
    expect(send?.description).toContain('עבור החתונה של דנה ויוסי');
    // The raw form must be gone — a leaked `{{` is the failure this whole
    // mechanism exists to prevent.
    expect(send?.description).not.toContain('{{');
  });

  it('fails the step permanently on a reference nothing can satisfy', async () => {
    const typo = slice();
    typo.nodes.push(node('r', 'action.send_whatsapp', { body: 'שלום {{trigger.no_such_field}}' }));
    typo.edges.push({ id: 'e4', source: 'a', target: 'r', sourceHandle: 'source' });

    const result = await dryRunWorkflow({
      workflowId: 'wf-1',
      storedDefinition: typo,
      allNodeIds: [...ALL, 'r'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    // Loud, not silent: an empty substitution would have reached a guest.
    expect(result.outcome.status).toBe('failed');
    expect(result.effects.filter((e) => e.kind === 'send_whatsapp')).toHaveLength(0);
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

describe('action.notify_team in a dry run', () => {
  // A trigger and one alert node. Deliberately NOT chained onto the condition:
  // the point here is the alert itself, and a branch would only add a way for
  // the test to fail for an unrelated reason.
  const alertOnly = {
    name: 'התראה',
    layoutDirection: 'DOWN',
    nodes: [
      node('t', 'trigger.whatsapp_inbound'),
      node('n', 'action.notify_team', {
        title: 'הודעה לא זוהתה',
        detail: 'האורח כתב: {{trigger.message_text}}',
        level: 'warn',
      }),
    ],
    edges: [{ id: 'e1', source: 't', target: 'n', sourceHandle: null }],
  };

  it('records the alert instead of posting it, with the template resolved', async () => {
    const result = await dryRunWorkflow({
      workflowId: 'wf-alert',
      storedDefinition: alertOnly,
      allNodeIds: ['t', 'n'],
      scenario: { messageText: 'אולי', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.outcome.status).toBe('completed');
    // `detail` went through the same resolver as every other field, so the
    // owner sees the real sentence rather than the reference they typed.
    expect(result.effects).toEqual([
      {
        kind: 'notify_team',
        description: 'היה שולח התראה לצוות (warn): "הודעה לא זוהתה" — האורח כתב: אולי',
      },
    ]);
  });

  it('skips a blank title rather than sending an empty alert', async () => {
    const blank = {
      ...alertOnly,
      nodes: [
        node('t', 'trigger.whatsapp_inbound'),
        node('n', 'action.notify_team', { title: '   ', detail: 'משהו', level: 'info' }),
      ],
    };

    const result = await dryRunWorkflow({
      workflowId: 'wf-alert',
      storedDefinition: blank,
      allNodeIds: ['t', 'n'],
      scenario: { messageText: 'אולי', buttonPayload: '', guestCase: 'one' },
    });

    // Completed, not failed: a missing title is an owner's omission, not a
    // fault, and it must not take a guest's run down with it.
    expect(result.outcome.status).toBe('completed');
    expect(result.effects).toEqual([]);
    expect(result.steps.find((step) => step.nodeId === 'n')?.output).toEqual({
      skipped: true,
      reason: 'empty_title',
    });
  });
});
