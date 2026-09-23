// A step that needs a guest, under a trigger that will never supply one.
//
// ⚠️ THIS IS AN EXISTING ENGINE RULE MOVED EARLIER, NOT A NEW ONE. Seven step
// handlers call `requireGuestContext` and throw `missing_guest_context` when the
// run has no contact. Whether the run HAS one is decided by the trigger at the
// other end of the diagram — so the check is cross-node, and neither a JSON
// Schema (which sees one node's properties) nor a JsonForms rule (which sees one
// node's data) can express it.
//
// Before this, `לפי שעון → שליחת וואטסאפ` armed cleanly and failed on its first
// fire. The only warning was a sentence of prose in the trigger's own panel.

import { describe, expect, it } from 'vitest';

import { findArmBlockers } from './arm-check';
import { assertCoversEveryNodeFolder, serverStepSources } from '../node-sources';
import {
  GUEST_SCOPED_NODE_TYPES,
  OWNER_WHATSAPP_MESSAGE_KINDS,
  triggerSuppliesGuestContext,
} from './types';

/** A minimal two-node diagram: one trigger, one action, one edge. */
function diagram(
  trigger: { type: string; properties?: Record<string, unknown> },
  action: { type: string; properties?: Record<string, unknown> },
) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        position: { x: 0, y: 0 },
        data: {
          type: trigger.type,
          properties: { label: 'טריגר', description: 'ת', ...trigger.properties },
        },
      },
      {
        id: 'action-1',
        position: { x: 0, y: 120 },
        data: {
          type: action.type,
          properties: { label: 'פעולה', description: 'ת', ...action.properties },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'action-1' }],
  };
}

/** Enough config that the FIELD checks pass, so only the guest rule can fire. */
const FILLED: Record<string, Record<string, unknown>> = {
  'action.update_guest_status': { rsvpStatus: 'attending' },
  'action.send_whatsapp': { body: 'שלום' },
  'action.send_template': { messageKey: 'reminder_1' },
  'action.set_guest_field': { field: 'meal_pref' },
  'action.create_callback_request': { topic: 'שאלה על האירוע' },
  'action.start_voice_call': { purposeKey: 'rsvp' },
  'action.start_rsvp_ai_callback': {},
};

describe('the guest-scoped list matches the handlers that enforce it', () => {
  it('is exactly the set of requireGuestContext call sites', () => {
    // Every server-side step file — the registry AND each node folder's
    // runtime — not just `steps/index.ts`: a handler that moved out would
    // otherwise vanish from this set and fail with a misleading diff, or worse,
    // move together with the list and pass while guarding nothing.
    const files = serverStepSources();
    expect(assertCoversEveryNodeFolder(files)).toEqual([]);
    const guarded = files.flatMap(({ source }) =>
      [...source.matchAll(/requireGuestContext\(\s*ctx,\s*'([\w.]+)'/g)].map((m) => m[1]!),
    );

    expect([...new Set(guarded)].sort()).toEqual([...GUEST_SCOPED_NODE_TYPES].sort());
  });
});

describe('triggerSuppliesGuestContext', () => {
  it('a WhatsApp trigger with no kinds means the four a guest sends', () => {
    expect(triggerSuppliesGuestContext('trigger.whatsapp_inbound', {})).toBe(true);
    expect(triggerSuppliesGuestContext('trigger.whatsapp_inbound', { messageKinds: [] })).toBe(true);
  });

  it('accepts both persisted shapes, because the control changed and old saves did not', () => {
    expect(
      triggerSuppliesGuestContext('trigger.whatsapp_inbound', { messageKinds: ['text'] }),
    ).toBe(true);
    expect(
      triggerSuppliesGuestContext('trigger.whatsapp_inbound', {
        messageKinds: [{ value: 'text' }],
      }),
    ).toBe(true);
  });

  it('is false when every selected kind is an owner sending us something', () => {
    expect(
      triggerSuppliesGuestContext('trigger.whatsapp_inbound', {
        messageKinds: OWNER_WHATSAPP_MESSAGE_KINDS.map((value) => ({ value })),
      }),
    ).toBe(false);
  });

  it('is true as soon as one guest kind is mixed in', () => {
    expect(
      triggerSuppliesGuestContext('trigger.whatsapp_inbound', {
        messageKinds: [{ value: 'document' }, { value: 'text' }],
      }),
    ).toBe(true);
  });

  it('is false for every other trigger type', () => {
    expect(triggerSuppliesGuestContext('trigger.webhook', { token: 't' })).toBe(false);
    expect(triggerSuppliesGuestContext('trigger.schedule', { time: '09:00' })).toBe(false);
  });
});

describe('findArmBlockers refuses a guest step under a guestless trigger', () => {
  for (const nodeType of GUEST_SCOPED_NODE_TYPES) {
    it(`${nodeType} is blocked under trigger.schedule`, () => {
      const blockers = findArmBlockers(
        diagram(
          { type: 'trigger.schedule', properties: { time: '09:00' } },
          { type: nodeType, properties: FILLED[nodeType] },
        ),
      );
      expect(blockers.some((b) => b.includes('אינו מתחיל מאורח'))).toBe(true);
    });
  }

  it('is blocked under trigger.webhook too', () => {
    const blockers = findArmBlockers(
      diagram(
        { type: 'trigger.webhook', properties: { token: 'abc' } },
        { type: 'action.send_whatsapp', properties: { body: 'שלום' } },
      ),
    );
    expect(blockers.some((b) => b.includes('אינו מתחיל מאורח'))).toBe(true);
  });

  it('is blocked under a WhatsApp trigger set to owner kinds only', () => {
    const blockers = findArmBlockers(
      diagram(
        {
          type: 'trigger.whatsapp_inbound',
          properties: { messageKinds: [{ value: 'document' }, { value: 'contacts' }] },
        },
        { type: 'action.send_whatsapp', properties: { body: 'שלום' } },
      ),
    );
    expect(blockers.some((b) => b.includes('אינו מתחיל מאורח'))).toBe(true);
  });

  it('is NOT blocked under a guest-bearing WhatsApp trigger', () => {
    const blockers = findArmBlockers(
      diagram(
        { type: 'trigger.whatsapp_inbound', properties: {} },
        { type: 'action.send_whatsapp', properties: { body: 'שלום' } },
      ),
    );
    expect(blockers).toEqual([]);
  });

  // A disabled step is skipped at run time and cannot throw, so refusing to arm
  // because of one would be stricter than the engine — the exact mistake the
  // rest of this module was written to avoid.
  it('does not block a DISABLED guest step', () => {
    const blockers = findArmBlockers(
      diagram(
        { type: 'trigger.schedule', properties: { time: '09:00' } },
        {
          type: 'action.send_whatsapp',
          properties: { body: 'שלום', status: 'disabled' },
        },
      ),
    );
    expect(blockers).toEqual([]);
  });

  it('a guestless trigger with no guest step arms fine', () => {
    const blockers = findArmBlockers(
      diagram(
        { type: 'trigger.schedule', properties: { time: '09:00' } },
        { type: 'action.notify_team', properties: { title: 'שלום' } },
      ),
    );
    expect(blockers).toEqual([]);
  });
});
