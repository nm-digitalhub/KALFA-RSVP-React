'use client';

// `logic.switch` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { switchDefaultPropertiesData } from './default-properties-data';
import * as switchDefinition from './definition';
import { switchSchema } from './schema';
import { switchUiSchema } from './uischema';

export const switchPaletteItem = {
  type: switchDefinition.type,
  label: 'ניתוב לפי תנאים',
  description: 'מפצל את התהליך לכמה מסלולים — מסלול לכל תנאי, ועוד ברירת מחדל',
  icon: 'ArrowsSplit',
  // Same renderer as the condition, and REQUIRED rather than cosmetic: without
  // it the N branches render as no handles at all, because the default node
  // body draws exactly one bare 'source'.
  templateType: NodeType.DecisionNode,
  schema: switchSchema,
  uischema: switchUiSchema,
  outputSchema: {
    type: 'default',
    properties: switchDefinition.outputFields,
  },
  defaultPropertiesData: switchDefaultPropertiesData,
} satisfies PaletteItem<typeof switchSchema>;
