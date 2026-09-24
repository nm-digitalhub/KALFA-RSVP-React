'use client';

// `trigger.whatsapp_inbound` — the JSON schema of its properties panel, and the
// factory that fills the receiving-number dropdown in. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

/**
 * One of OUR WhatsApp numbers, as the trigger's dropdown offers it.
 *
 * The VALUE is Meta's `phone_number_id`, because that is what arrives on the
 * webhook and what `matchesNumber` compares. The label is for the human.
 */
export type WhatsAppNumberOption = {
  /** Meta's phone_number_id — the stored value. */
  providerRef: string;
  /** e.g. "+972 3-721-9347 — מספר אישורי הגעה". */
  label: string;
};

// The only entry whose options are not knowable at module scope: the account's
// WhatsApp numbers are rows, and they change without a deploy. `buildPaletteItems`
// in `catalogue/schemas.ts` takes them; `PALETTE_ITEMS` is the empty-list case.
export const whatsappInboundSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    keyword: { type: 'string', placeholder: 'השאירו ריק כדי להפעיל על כל הודעה' },
    phoneNumberId: { type: 'string' },
    // WHICH KINDS of message start this workflow. An OPEN array of Meta's own
    // `type` strings — not an enum — so a kind Meta adds later needs a catalogue
    // entry rather than a migration. Absent means the four a guest actually
    // speaks with, which is what every diagram saved before this field did.
    // ⚠️ OBJECTS, NOT BARE STRINGS, and the shape is forced on us.
    //
    // The SDK's `ArrayFieldSchema` is `{ type:'array', items:{ type:'object',
    // properties } }` — it cannot describe an array of strings at all. The first
    // version declared this shape and had the control write plain strings, so
    // every saved trigger carried a validation error on the node
    // ("Instance type \"string\" is invalid. Expected \"object\"") and showed a
    // "!" the owner could not act on.
    //
    // So the control stores `[{ value: 'document' }, …]`. `matchesKind` accepts
    // BOTH shapes, which is what keeps a workflow saved under the string version
    // matching without a migration.
    messageKinds: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

export type WhatsappInboundSchema = typeof whatsappInboundSchema;

export function whatsappInboundSchemaFor(numbers: readonly WhatsAppNumberOption[]): NodeSchema {
  return {
    ...whatsappInboundSchema,
    properties: {
      ...whatsappInboundSchema.properties,
      phoneNumberId: {
        type: 'string',
        // '' first, and it is the default: empty means ANY number, which keeps
        // every diagram saved before this field firing exactly as it did.
        options: [
          { value: '', label: 'כל המספרים' },
          ...numbers.map((n) => ({ value: n.providerRef, label: n.label })),
        ],
      },
    },
  } as NodeSchema;
}
