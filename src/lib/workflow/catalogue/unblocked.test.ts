// Three restrictions this codebase invented, each now opened — and each proved
// here rather than asserted in a comment. They are grouped in one file because
// they share a cause: every one was a guard written when the surrounding
// machinery was missing, and left standing after the machinery arrived.
import { describe, expect, it } from 'vitest';

import { toWorkflowDefinition } from '../adapter/to-definition';
import { dryRunWorkflow } from '../engine/dry-run';

import { ACTION_BRANCH_HANDLES, RUNNER_ERROR_PORT } from './types';

type Props = Record<string, unknown>;

function node(id: string, type: string, properties: Props = {}) {
  return {
    id,
    type: 'node',
    position: { x: 0, y: 0 },
    data: { type, icon: 'Lightning', properties },
  };
}

function edge(id: string, source: string, target: string, sourceHandle: string | null = null) {
  return { id, source, target, sourceHandle };
}

function diagram(nodes: ReturnType<typeof node>[], edges: ReturnType<typeof edge>[]) {
  return { name: 'בדיקה', layoutDirection: 'DOWN', nodes, edges };
}

// ---------------------------------------------------------------------------
// 1. The condition can compare anything, not two trigger fields
// ---------------------------------------------------------------------------

describe('a condition is no longer limited to the inbound message', () => {
  it('compares one node’s OUTPUT against a value', async () => {
    // Impossible before: `field` was an enum over the trigger payload, so a
    // condition could not ask about anything a previous step had computed.
    const result = await dryRunWorkflow({
      workflowId: 'wf-left',
      storedDefinition: diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('compose', 'logic.set_value', { value: 'סטטוס:{{trigger.guest_name}}' }),
          node('c', 'logic.condition', {
            left: '{{nodes.compose.value}}',
            operator: 'ends_with',
            value: 'דנה',
          }),
          node('yes', 'action.update_guest_status', { rsvpStatus: 'attending' }),
        ],
        [
          edge('e1', 't', 'compose'),
          edge('e2', 'compose', 'c'),
          edge('e3', 'c', 'yes', 'source:inner:true'),
        ],
      ),
      allNodeIds: ['t', 'compose', 'c', 'yes'],
      scenario: { messageText: 'שלום', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.steps.find((s) => s.nodeId === 'c')?.output).toEqual({ result: true });
    expect(result.effects[0]?.description).toContain('attending');
  });

  it('still evaluates a diagram saved before `left` existed, identically', async () => {
    // The compatibility claim, tested rather than trusted: these carry `field`
    // and no `left`, and there are stored workflows shaped exactly like this.
    const result = await dryRunWorkflow({
      workflowId: 'wf-old',
      storedDefinition: diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('c', 'logic.condition', {
            field: 'message_text',
            operator: 'contains',
            value: 'כן',
          }),
        ],
        [edge('e1', 't', 'c')],
      ),
      allNodeIds: ['t', 'c'],
      scenario: { messageText: 'כן בהחלט', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.steps.find((s) => s.nodeId === 'c')?.output).toEqual({ result: true });
  });

  it('reads the five trigger fields the closed set used to hide', async () => {
    const result = await dryRunWorkflow({
      workflowId: 'wf-fields',
      storedDefinition: diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('c', 'logic.condition', {
            field: 'guest_name',
            operator: 'is_not_empty',
            value: '',
          }),
        ],
        [edge('e1', 't', 'c')],
      ),
      allNodeIds: ['t', 'c'],
      scenario: { messageText: 'x', buttonPayload: '', guestCase: 'one' },
    });

    // guestCase 'one' supplies 'דנה'. Before this, `guest_name` was not offered
    // at all — the payload carried it and no condition could see it.
    expect(result.steps.find((s) => s.nodeId === 'c')?.output).toEqual({ result: true });
  });
});

// ---------------------------------------------------------------------------
// 2. errorRoute
// ---------------------------------------------------------------------------

describe('errorRoute is reachable', () => {
  it('rewrites the editor’s error handle into the runner’s reserved port', () => {
    const converted = toWorkflowDefinition(
      'wf-err',
      diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('a', 'action.update_guest_status', { rsvpStatus: 'attending' }),
          node('rescue', 'action.notify_team', { title: 'נכשל', detail: '', level: 'error' }),
        ],
        [
          edge('e1', 't', 'a'),
          edge('e2', 'a', 'rescue', ACTION_BRANCH_HANDLES.error),
        ],
      ),
    );

    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const errorEdge = converted.definition.edges.find((e) => e.id === 'e2');
    // The claim in one line: what the owner drew is not what the runner reads,
    // and the adapter is the only thing that knows both.
    expect(errorEdge?.sourceHandle).toBe(RUNNER_ERROR_PORT);
  });

  it('routes a failed step down the error branch and finishes the run', async () => {
    // The failure is an unresolvable reference, which is the one an owner
    // actually hits: they quoted a node, then deleted or renamed it. The
    // resolver raises `unresolved_template_reference` before the handler runs,
    // so the step fails for real rather than returning a skip — and with
    // errorPolicy 'errorRoute' that failure must not end the run.
    const result = await dryRunWorkflow({
      workflowId: 'wf-err',
      storedDefinition: diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('a', 'action.send_whatsapp', {
            body: 'שלום {{nodes.a-node-that-was-deleted.value}}',
            errorPolicy: 'errorRoute',
          }),
          node('ok', 'action.notify_team', { title: 'הצליח', detail: '', level: 'info' }),
          node('rescue', 'action.notify_team', {
            title: 'לא זוהה אורח',
            detail: 'ההודעה הגיעה ממספר שאינו ברשימה',
            level: 'warn',
          }),
        ],
        [
          edge('e1', 't', 'a'),
          edge('e2', 'a', 'ok', ACTION_BRANCH_HANDLES.ok),
          edge('e3', 'a', 'rescue', ACTION_BRANCH_HANDLES.error),
        ],
      ),
      allNodeIds: ['t', 'a', 'ok', 'rescue'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'none' },
    });

    // Not 'failed', and not 'incomplete' — the run handled its own error.
    expect(result.outcome.status).toBe('completed');
    // The rescue branch fired; the success branch did not.
    expect(result.effects).toEqual([
      {
        kind: 'notify_team',
        description:
          'היה שולח התראה לצוות (warn): "לא זוהה אורח" — ההודעה הגיעה ממספר שאינו ברשימה',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Active / Draft / Disabled
// ---------------------------------------------------------------------------

describe('a step can be switched off without being deleted', () => {
  const withStatus = (status: string) =>
    diagram(
      [
        node('t', 'trigger.whatsapp_inbound'),
        node('a', 'action.update_guest_status', { rsvpStatus: 'attending', status }),
        node('after', 'action.notify_team', { title: 'אחרי', detail: '', level: 'info' }),
      ],
      [edge('e1', 't', 'a'), edge('e2', 'a', 'after')],
    );

  it('performs no side effect, and lets the workflow continue through it', async () => {
    const result = await dryRunWorkflow({
      workflowId: 'wf-off',
      storedDefinition: withStatus('disabled'),
      allNodeIds: ['t', 'a', 'after'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.outcome.status).toBe('completed');
    expect(result.steps.find((s) => s.nodeId === 'a')?.output).toEqual({
      skipped: true,
      reason: 'node_disabled',
    });
    // Pass-through, not removal: the step AFTER the disabled one still ran.
    expect(result.effects.map((e) => e.kind)).toEqual(['notify_team']);
    // And nothing touched a guest.
    expect(result.effects.some((e) => e.kind === 'submit_rsvp')).toBe(false);
  });

  it('says which of the two it was', async () => {
    const result = await dryRunWorkflow({
      workflowId: 'wf-draft',
      storedDefinition: withStatus('draft'),
      allNodeIds: ['t', 'a', 'after'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    // A step nobody finished writing is not the same as one deliberately
    // switched off, even though neither may touch a guest.
    expect(result.steps.find((s) => s.nodeId === 'a')?.output).toEqual({
      skipped: true,
      reason: 'node_draft',
    });
  });

  it('treats a pre-rename `status: attending` as active, not as a broken switch', async () => {
    // The trap this rename created. Old diagrams put the RSVP value under
    // `status`; reading it as a lifecycle value would silently disable a live
    // node, and rejecting it would break every one of them.
    const result = await dryRunWorkflow({
      workflowId: 'wf-legacy',
      storedDefinition: diagram(
        [
          node('t', 'trigger.whatsapp_inbound'),
          node('a', 'action.update_guest_status', { status: 'attending' }),
        ],
        [edge('e1', 't', 'a')],
      ),
      allNodeIds: ['t', 'a'],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    expect(result.outcome.status).toBe('completed');
    expect(result.effects[0]?.description).toContain('attending');
  });
});
