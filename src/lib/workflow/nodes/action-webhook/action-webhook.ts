'use client';

// `action.webhook` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { webhookDefaultPropertiesData } from './default-properties-data';
import * as webhookDefinition from './definition';
import { webhookSchema } from './schema';
import { webhookUiSchema } from './uischema';

export const webhookPaletteItem = {
  type: webhookDefinition.type,
  // Decision node so the failure branch has a handle to leave from — the same
  // reason every other action node uses this renderer.
  templateType: NodeType.DecisionNode,
  label: 'קריאת HTTP',
  description: 'קורא למערכת חיצונית — עם אימות, אם צריך',
  icon: 'ShareNetwork',
  schema: webhookSchema,
  uischema: webhookUiSchema,
  outputSchema: {
    type: 'default',
    properties: webhookDefinition.outputFields,
  },
  defaultPropertiesData: webhookDefaultPropertiesData,
} satisfies PaletteItem<typeof webhookSchema>;
