'use client';

// `action.send_whatsapp` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { sendWhatsappDefaultPropertiesData } from './default-properties-data';
import * as sendWhatsappDefinition from './definition';
import { sendWhatsappSchema } from './schema';
import { sendWhatsappUiSchema } from './uischema';

export const sendWhatsappPaletteItem = {
  type: sendWhatsappDefinition.type,
  // Rendered as a decision node so the failure branch has a handle to leave
  // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
  // which is a guaranteed dead end — the reason the option was withheld.
  templateType: NodeType.DecisionNode,
  label: 'שליחת הודעת וואטסאפ',
  description: 'משיב לאורח ששלח את ההודעה',
  icon: 'WhatsappLogo',
  schema: sendWhatsappSchema,
  uischema: sendWhatsappUiSchema,
  outputSchema: {
    type: 'default',
    properties: sendWhatsappDefinition.outputFields,
  },
  defaultPropertiesData: sendWhatsappDefaultPropertiesData,
} satisfies PaletteItem<typeof sendWhatsappSchema>;
