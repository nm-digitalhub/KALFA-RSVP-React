'use client';

// `trigger.whatsapp_inbound` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held, and
// `buildPaletteItems` swaps its schema for one carrying the live numbers.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { whatsappInboundDefaultPropertiesData } from './default-properties-data';
import * as whatsappInboundDefinition from './definition';
import { whatsappInboundSchema } from './schema';
import { whatsappInboundUiSchema } from './uischema';

export const whatsappInboundPaletteItem = {
  type: whatsappInboundDefinition.type,
  label: 'הודעת וואטסאפ נכנסת',
  description: 'מתחיל את התהליך כשאורח שולח הודעה',
  icon: 'WhatsappLogo',
  // Renders with the SDK's start-node body, which draws ONE handle —
  // `type: 'source'` — where the default body draws a source AND a target.
  // The target dot on a trigger is an affordance for a connection rule 6
  // forbids and `isValidConnection` always rejects: the owner can aim at it,
  // and nothing lands. This removes the dot instead of refusing the drop, so
  // the rule is visible rather than merely enforced.
  //
  // Not `isStartNode: true` — that field does not exist in 2.3.0 (it is
  // queued in an unreleased changeset), and even once it does it is a data
  // marker the editor writes into `data`, which rule 3 forbids us to read.
  // `templateType` is only ever about the visual template, which upstream
  // states explicitly, so the two concerns stay separate.
  templateType: NodeType.StartNode,
  schema: whatsappInboundSchema,
  uischema: whatsappInboundUiSchema,
  // The trigger's output is the inbound message itself — see `outputFields` in
  // `definition.ts` for what the picker offers and the namespace caveat.
  outputSchema: {
    type: 'default',
    properties: whatsappInboundDefinition.outputFields,
  },
  defaultPropertiesData: whatsappInboundDefaultPropertiesData,
} satisfies PaletteItem<typeof whatsappInboundSchema>;
