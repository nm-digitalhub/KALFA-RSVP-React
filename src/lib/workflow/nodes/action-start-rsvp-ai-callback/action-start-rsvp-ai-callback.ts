'use client';

// `action.start_rsvp_ai_callback` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { startRsvpAiCallbackDefaultPropertiesData } from './default-properties-data';
import * as startRsvpAiCallbackDefinition from './definition';
import { startRsvpAiCallbackSchema } from './schema';
import { startRsvpAiCallbackUiSchema } from './uischema';

export const startRsvpAiCallbackPaletteItem = {
  type: startRsvpAiCallbackDefinition.type,
  templateType: NodeType.DecisionNode,
  label: 'הפעלת סוכן RSVP קולי',
  description: 'מפעיל שיחה חוזרת באמצעות סוכן ה-RSVP הקולי הקיים',
  icon: 'PhoneCall',
  schema: startRsvpAiCallbackSchema,
  uischema: startRsvpAiCallbackUiSchema,
  outputSchema: {
    type: 'default',
    properties: startRsvpAiCallbackDefinition.outputFields,
  },
  defaultPropertiesData: startRsvpAiCallbackDefaultPropertiesData,
} satisfies PaletteItem<typeof startRsvpAiCallbackSchema>;
