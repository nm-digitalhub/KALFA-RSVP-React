'use client';

// `action.ai_agent` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { aiAgentDefaultPropertiesData } from './default-properties-data';
import * as aiAgentDefinition from './definition';
import { aiAgentSchema } from './schema';
import { aiAgentUiSchema } from './uischema';

export const aiAgentPaletteItem = {
  type: aiAgentDefinition.type,
  label: 'סוכן AI',
  description: 'שואל מודל שפה ומעביר את התשובה לצעדים הבאים',
  icon: 'Sparkle',
  // The SDK's own visual template for an AI step. Not a cosmetic choice: the
  // guide warns that a `nodeTemplates` key colliding with a built-in name
  // ('node', 'start-node', 'ai-node', 'decision-node') OVERRIDES that
  // category's renderer — so declaring the template type is how we get the
  // vendor's AI body rather than accidentally replacing it.
  templateType: NodeType.AiNode,
  schema: aiAgentSchema,
  uischema: aiAgentUiSchema,
  outputSchema: {
    type: 'default',
    properties: aiAgentDefinition.outputFields,
  },
  defaultPropertiesData: aiAgentDefaultPropertiesData,
} satisfies PaletteItem<typeof aiAgentSchema>;
