import { describe, expect, it } from 'vitest';

import { DEFAULT_WHATSAPP_MESSAGE_KINDS } from './catalogue/types';
import {
  findTriggerNode,
  matchesKeyword,
  matchesKind,
  planRuns,
  type ArmedWorkflow,
} from './trigger';

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

// The RSVP line (measured 2026-09-13). The receiving-number FILTER is exercised
// in trigger-number.test.ts, which needs both lines; here it only has to be a
// real value so the fixture is not a message from nowhere.
const RSVP_LINE = '1018741517998430';

const MESSAGE = {
  eventId: 'event-1',
  contactId: 'contact-1',
  inboxRowId: 'inbox-9',
  // A guest's text message — what every case in this file is about.
  kind: 'text',
  phoneNumberId: RSVP_LINE,
  messageText: 'כן אני מגיע',
  buttonPayload: '',
    guestName: 'דנה',
    eventName: 'אירוע בדיקה',
    eventDate: '01.01.2027',
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
    // Every key here is a `{{trigger.<key>}}` an owner can type, so this
    // assertion is the payload's public contract and not an incidental snapshot.
    expect(run!.triggerPayload).toEqual({
      eventId: 'event-1',
      contactId: 'contact-1',
      guest_name: 'דנה',
      event_name: 'אירוע בדיקה',
      event_date: '01.01.2027',
      message_text: 'כן אני מגיע',
      button_payload: 'rsvp_attending',
      // A REFERENCE to the inbox row, not its content: `action.import_guest_list`
      // reaches the file or the contact cards through it, and copying them into
      // this jsonb column would be a second permanent copy of a guest list.
      inboxRowId: 'inbox-9',
    });
  });
});

describe('matchesKind — which messages may start a flow', () => {
  // ⚠️ THE GATE THAT MOVED OFF THE BILLING CLASSIFIER.
  //
  // `createRunsForInboundMessage` used `BILLABLE_MESSAGE_TYPES` to decide what an
  // owner may automate. That is a BILLING concept, and it disagreed with
  // automation on exactly the case that mattered: an owner sending a guest list
  // is not a billable reach, so a file could never start a workflow and guest
  // import had to live as a separate hard-coded mechanism.

  it('⚠️ absent means the OLD billable set — every saved diagram is unchanged', () => {
    // THE COMPATIBILITY ASSERTION. If this ever loosens, every armed workflow in
    // production starts firing on message kinds its owner never chose — on a
    // photo, on a voice note — and replies to guests who sent neither.
    for (const kind of ['text', 'button', 'interactive', 'reaction']) {
      expect(matchesKind(undefined, kind)).toBe(true);
    }
    for (const kind of ['document', 'contacts', 'image', 'audio', 'video']) {
      expect(matchesKind(undefined, kind)).toBe(false);
    }
  });

  it('and the default list IS that set, spelled once', () => {
    expect([...DEFAULT_WHATSAPP_MESSAGE_KINDS].sort()).toEqual(
      ['button', 'interactive', 'reaction', 'text'].sort(),
    );
  });

  it('an EMPTY array is treated as absent, not as "nothing"', () => {
    // The control writes `undefined` when the last box is unticked, but a
    // hand-edited row can still carry `[]`. A trigger that matches nothing is a
    // dead workflow that looks armed — the compatible default is the safer read.
    expect(matchesKind([], 'text')).toBe(true);
    expect(matchesKind([], 'document')).toBe(false);
  });

  it('an explicit list is honoured exactly', () => {
    expect(matchesKind(['document', 'contacts'], 'document')).toBe(true);
    expect(matchesKind(['document', 'contacts'], 'contacts')).toBe(true);
    // Opting into files does NOT silently keep text: the owner said which kinds.
    expect(matchesKind(['document', 'contacts'], 'text')).toBe(false);
  });

  it('an UNKNOWN kind matches nothing, even an explicit list', () => {
    // A payload with no `type`. We cannot say what it is, and guessing would
    // start a run on a message nobody chose.
    expect(matchesKind(undefined, '')).toBe(false);
    expect(matchesKind(['text'], '')).toBe(false);
  });

  it('tolerates a junk config rather than throwing mid-drain', () => {
    // The value arrives from a jsonb column; the form constrains what can be
    // typed, not what is in the row.
    expect(matchesKind('document', 'text')).toBe(true);
    expect(matchesKind([42, 'document'], 'document')).toBe(true);
  });

  it('planRuns applies it — a file does not start a text-only workflow', () => {
    const [run] = planRuns({ ...MESSAGE, kind: 'document' }, [armed()]);
    expect(run).toBeUndefined();
  });

  it('planRuns lets a file through when the trigger asked for one', () => {
    // `ArmedWorkflow.definition` is `unknown` by design — it is a jsonb column,
    // and `findTriggerNode` is the only thing allowed to give it a shape. The
    // narrowing here is the test's, not the code's.
    const w = armed();
    const definition = w.definition as {
      nodes: { data: { properties: Record<string, unknown> } }[];
    };
    const node = definition.nodes[0]!;
    node.data.properties = { ...node.data.properties, messageKinds: ['document'] };
    const [run] = planRuns({ ...MESSAGE, kind: 'document' }, [w]);
    expect(run).toBeDefined();
  });
});
