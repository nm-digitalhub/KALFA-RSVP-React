import { describe, expect, it } from 'vitest';

import { findTriggerNode, matchesKeyword, planRuns, type ArmedWorkflow } from './trigger';

function definition(
  triggerProps: Record<string, unknown> = {},
  extraNodes: unknown[] = [],
) {
  return {
    name: 'w',
    layoutDirection: 'DOWN',
    nodes: [
      {
        id: 't',
        type: 'node',
        position: { x: 0, y: 0 },
        data: {
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: triggerProps,
        },
      },
      ...extraNodes,
    ],
    edges: [],
  };
}

const MESSAGE = {
  eventId: 'event-1',
  contactId: 'contact-1',
  inboxRowId: 'inbox-9',
  messageText: 'כן אני מגיע',
  buttonPayload: '',
};

function armed(over: Partial<ArmedWorkflow> = {}): ArmedWorkflow {
  return { id: 'wf-1', eventId: null, definition: definition(), ...over };
}

describe('matchesKeyword', () => {
  it('an empty keyword matches everything — the documented default', () => {
    expect(matchesKeyword('', 'anything')).toBe(true);
    expect(matchesKeyword('   ', 'anything')).toBe(true);
    expect(matchesKeyword(undefined, 'anything')).toBe(true);
  });

  it('matches Hebrew substrings', () => {
    expect(matchesKeyword('כן', 'כן אני מגיע')).toBe(true);
    expect(matchesKeyword('לא', 'כן אני מגיע')).toBe(false);
  });

  it('ignores case, because a Latin keyword should not need the guest\'s shift key', () => {
    expect(matchesKeyword('yes', 'YES please')).toBe(true);
    expect(matchesKeyword('YES', 'yes please')).toBe(true);
  });
});

describe('findTriggerNode', () => {
  it('asks the catalogue, not the stored JSON', () => {
    // A crafted row claiming an action is the entry point. If this function read
    // `role` or `isStartNode` it would find a trigger here; it must not.
    const crafted = {
      name: 'w',
      layoutDirection: 'DOWN',
      nodes: [
        {
          id: 'a',
          type: 'node',
          position: { x: 0, y: 0 },
          data: {
            type: 'action.update_guest_status',
            icon: 'UserCheck',
            properties: { status: 'attending' },
            role: 'start',
            isStartNode: true,
          },
        },
      ],
      edges: [],
    };
    expect(findTriggerNode(crafted)).toBeUndefined();
  });

  it('returns nothing when the graph has two triggers', () => {
    const two = definition({}, [
      {
        id: 't2',
        type: 'node',
        position: { x: 200, y: 0 },
        data: { type: 'trigger.whatsapp_inbound', icon: 'WhatsappLogo', properties: {} },
      },
    ]);
    expect(findTriggerNode(two)).toBeUndefined();
  });

  it('returns nothing for a malformed definition rather than throwing', () => {
    expect(findTriggerNode(null)).toBeUndefined();
    expect(findTriggerNode({ nodes: 'not an array' })).toBeUndefined();
  });
});

describe('planRuns', () => {
  it('plans one run per matching armed workflow', () => {
    const runs = planRuns(MESSAGE, [armed({ id: 'wf-1' }), armed({ id: 'wf-2' })]);
    expect(runs.map((r) => r.workflowId)).toEqual(['wf-1', 'wf-2']);
  });

  it('keys the dedupe on the inbox row, so a redelivery is one run', () => {
    const [first] = planRuns(MESSAGE, [armed()]);
    const [again] = planRuns(MESSAGE, [armed()]);
    expect(first!.dedupeKey).toBe(again!.dedupeKey);
    expect(first!.dedupeKey).toBe('whatsapp_inbound:inbox-9:wf-1');
  });

  it('gives two workflows on one message distinct keys', () => {
    const runs = planRuns(MESSAGE, [armed({ id: 'wf-1' }), armed({ id: 'wf-2' })]);
    expect(new Set(runs.map((r) => r.dedupeKey)).size).toBe(2);
  });

  it('does not fire an event-scoped workflow for another event', () => {
    expect(planRuns(MESSAGE, [armed({ eventId: 'other-event' })])).toHaveLength(0);
    expect(planRuns(MESSAGE, [armed({ eventId: 'event-1' })])).toHaveLength(1);
  });

  it('respects the keyword filter', () => {
    expect(planRuns(MESSAGE, [armed({ definition: definition({ keyword: 'לא' }) })])).toHaveLength(0);
    expect(planRuns(MESSAGE, [armed({ definition: definition({ keyword: 'כן' }) })])).toHaveLength(1);
  });

  it('carries the payload the condition node reads', () => {
    const [run] = planRuns({ ...MESSAGE, buttonPayload: 'rsvp_attending' }, [armed()]);
    expect(run!.triggerPayload).toEqual({
      eventId: 'event-1',
      contactId: 'contact-1',
      message_text: 'כן אני מגיע',
      button_payload: 'rsvp_attending',
    });
  });
});
