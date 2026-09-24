'use client';

// `trigger.webhook` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { webhookTriggerDefaultPropertiesData } from './default-properties-data';
import * as webhookTriggerDefinition from './definition';
import { webhookTriggerSchema } from './schema';
import { webhookTriggerUiSchema } from './uischema';

export const webhookTriggerPaletteItem = {
  type: webhookTriggerDefinition.type,
  label: 'קריאת Webhook נכנסת',
  description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
  icon: 'Plugs',
  // The SDK's start-node body draws one handle, no target dot — the same
  // reason the other triggers use it.
  templateType: NodeType.StartNode,
  schema: webhookTriggerSchema,
  uischema: webhookTriggerUiSchema,
  outputSchema: {
    type: 'default',
    properties: webhookTriggerDefinition.outputFields,
  },
  defaultPropertiesData: webhookTriggerDefaultPropertiesData,
} satisfies PaletteItem<typeof webhookTriggerSchema>;
