'use client';

// `action.create_callback_request` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { callbackRequestDefaultPropertiesData } from './default-properties-data';
import * as callbackRequestDefinition from './definition';
import { callbackRequestSchema } from './schema';
import { callbackRequestUiSchema } from './uischema';

export const callbackRequestPaletteItem = {
  type: callbackRequestDefinition.type,
  templateType: NodeType.DecisionNode,
  label: 'בקשת חזרה לאורח',
  description: 'מוסיף את האורח לתור שיחות החזרה של הצוות',
  icon: 'PhoneCall',
  schema: callbackRequestSchema,
  uischema: callbackRequestUiSchema,
  outputSchema: {
    type: 'default',
    properties: callbackRequestDefinition.outputFields,
  },
  defaultPropertiesData: callbackRequestDefaultPropertiesData,
} satisfies PaletteItem<typeof callbackRequestSchema>;
