'use client';

// `action.sumit_create_customer` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { sumitCreateCustomerDefaultPropertiesData } from './default-properties-data';
import * as sumitCreateCustomerDefinition from './definition';
import { sumitCreateCustomerSchema } from './schema';
import { sumitCreateCustomerUiSchema } from './uischema';

export const sumitCreateCustomerPaletteItem = {
  type: sumitCreateCustomerDefinition.type,
  label: 'יצירת לקוח ב-SUMIT',
  description: 'יוצר כרטיס לקוח. לא מבצע חיוב.',
  icon: 'UserPlus',
  templateType: NodeType.DecisionNode,
  schema: sumitCreateCustomerSchema,
  uischema: sumitCreateCustomerUiSchema,
  defaultPropertiesData: sumitCreateCustomerDefaultPropertiesData,
  outputSchema: {
    type: 'default',
    properties: sumitCreateCustomerDefinition.outputFields,
  },
} satisfies PaletteItem<typeof sumitCreateCustomerSchema>;
