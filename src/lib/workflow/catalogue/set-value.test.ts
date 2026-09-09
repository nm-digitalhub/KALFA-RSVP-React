// `logic.set_value` is the only node in the catalogue that performs no I/O, and
// that makes it the easiest one to ship broken: it type-checks, it appears in
// the palette, it "runs", and it is still worthless unless a LATER node can
// quote what it computed. Nothing about the handler proves that — the proof
// lives in three separate places that have to agree:
//
//   1. the handler returns `{ output: { value } }`               (steps/index.ts)
//   2. the runner writes `nodeOutputs[node.id] = result.output`  (graph-runner.ts)
//   3. the resolver maps the `nodes` namespace onto `nodeOutputs` (resolve-template.ts)
//
// So this runs the chain end to end and reads the text that would have reached
// a guest. If the composition ever breaks, `send_whatsapp` sends the literal
// `{{nodes.…}}` to a real person, which is precisely the failure that must not
// reach production quietly.
import { describe, expect, it } from 'vitest';

import { dryRunWorkflow } from '../engine/dry-run';

const TRIGGER = 'sv-trigger';
const SET = 'sv-compose';
const SEND = 'sv-send';

const diagram = {
  name: 'הרכבת ערך ושליחתו',
  layoutDirection: 'RIGHT',
  nodes: [
    {
      id: TRIGGER,
      type: 'start-node',
      position: { x: 0, y: 0 },
      data: {
        segments: [],
        type: 'trigger.whatsapp_inbound',
        icon: 'WhatsappLogo',
        properties: { label: 'הודעה נכנסת', description: '', keyword: '' },
      },
    },
    {
      id: SET,
      type: 'node',
      position: { x: 300, y: 0 },
      data: {
        segments: [],
        type: 'logic.set_value',
        icon: 'Tag',
        properties: {
          label: 'הרכבת הברכה',
          description: '',
          // Literal text and TWO namespaces in one field. If the resolver only
          // handled a whole-string reference, this would come back untouched.
          value: 'שלום {{trigger.guest_name}}, נתראה ב{{trigger.event_name}}!',
        },
      },
    },
    {
      id: SEND,
      type: 'node',
      position: { x: 600, y: 0 },
      data: {
        segments: [],
        type: 'action.send_whatsapp',
        icon: 'WhatsappLogo',
        properties: {
          label: 'שליחה',
          description: '',
          // The claim under test: one node's output is another node's input.
          body: '{{nodes.sv-compose.value}}',
          errorPolicy: 'continue',
        },
      },
    },
  ],
  edges: [
    {
      id: 'sv-e1',
      source: TRIGGER,
      sourceHandle: 'source',
      target: SET,
      targetHandle: 'target',
      type: 'labelEdge',
    },
    {
      id: 'sv-e2',
      source: SET,
      sourceHandle: 'source',
      target: SEND,
      targetHandle: 'target',
      type: 'labelEdge',
    },
  ],
};

describe('logic.set_value as a composition primitive', () => {
  it('feeds a resolved value into a later node', async () => {
    const run = await dryRunWorkflow({
      workflowId: 'wf-set-value',
      storedDefinition: diagram,
      allNodeIds: [TRIGGER, SET, SEND],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    expect(run.outcome.status).toBe('completed');

    // The node computed the composed string, not the raw template.
    const composed = run.steps.find((s) => s.nodeId === SET)?.output;
    expect(composed).toEqual({ value: 'שלום דנה, נתראה באירוע לדוגמה!' });

    // And the DOWNSTREAM node received it — this is the assertion that would
    // have caught a `nodes` namespace that never reached `nodeOutputs`.
    expect(run.effects).toEqual([
      { kind: 'send_whatsapp', description: 'היה שולח לאורח בוואטסאפ: "שלום דנה, נתראה באירוע לדוגמה!"' },
    ]);
  });

  it('the reference is resolved, never passed through as literal text', async () => {
    const run = await dryRunWorkflow({
      workflowId: 'wf-set-value',
      storedDefinition: diagram,
      allNodeIds: [TRIGGER, SET, SEND],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'one' },
    });

    // Stated separately from the equality above because THIS is the production
    // incident: a guest receiving `{{nodes.sv-compose.value}}` in a WhatsApp
    // message. An equality assertion that someone later "fixes" by pasting the
    // actual output would still pass; this one would not.
    for (const effect of run.effects) {
      expect(effect.description).not.toContain('{{');
    }
  });

  it('an unknown guest name fails the run loudly instead of sending a hole', async () => {
    // `guestCase: 'several'` is the live rule: two guests behind one phone, so
    // there is no answer to "whose name".
    //
    // This assertion is INVERTED from what it used to be, deliberately. The
    // field was normalised to `''`, the strict reference resolved, and the guest
    // received `שלום , נתראה…` — a sentence with a hole, from a run that
    // reported success. The key is now ABSENT, so a strict reference throws and
    // the owner is told. The next test is the other half: an owner who expects
    // the name to be missing sometimes says so, and gets their own wording.
    const run = await dryRunWorkflow({
      workflowId: 'wf-set-value',
      storedDefinition: diagram,
      allNodeIds: [TRIGGER, SET, SEND],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'several' },
    });

    expect(run.outcome.status).toBe('failed');
    const failed = run.steps.find((step) => step.status === 'failed');
    expect(failed?.errorMessage).toContain('{{trigger.guest_name}}');
    // And nothing reached the guest.
    expect(run.effects).toEqual([]);
  });

  it('and `| default` now actually fires for that same case', async () => {
    // The reason the change above was worth making. `resolveTemplate` fires a
    // fallback only for a strictly undefined value — the vendor's own suite pins
    // that `''` is a real value — so while the field was emptied, this template
    // produced `שלום ` and the owner's fallback never ran.
    const withFallback = {
      ...diagram,
      nodes: diagram.nodes.map((n) =>
        n.id !== SET
          ? n
          : {
              ...n,
              data: {
                ...n.data,
                properties: {
                  ...n.data.properties,
                  value: "שלום {{trigger.guest_name | default:'אורח יקר'}}, נתראה!",
                },
              },
            },
      ),
    };

    const run = await dryRunWorkflow({
      workflowId: 'wf-set-value',
      storedDefinition: withFallback,
      allNodeIds: [TRIGGER, SET, SEND],
      scenario: { messageText: 'כן', buttonPayload: '', guestCase: 'several' },
    });

    expect(run.outcome.status).toBe('completed');
    expect(run.steps.find((s) => s.nodeId === SET)?.output).toEqual({
      value: 'שלום אורח יקר, נתראה!',
    });
  });
});
