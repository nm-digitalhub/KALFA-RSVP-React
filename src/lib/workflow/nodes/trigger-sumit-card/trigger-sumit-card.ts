'use client';

// `trigger.sumit_card` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns. For a workflow SUMIT has already
// called, `buildPaletteItems` swaps them for the fields that call carried.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { sumitCardTriggerDefaultPropertiesData } from './default-properties-data';
import * as sumitCardTriggerDefinition from './definition';
import { sumitCardTriggerSchema } from './schema';
import { sumitCardTriggerUiSchema } from './uischema';

export const sumitCardTriggerPaletteItem = {
  type: sumitCardTriggerDefinition.type,
  label: 'שינוי בכרטיס SUMIT',
  description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
  icon: 'IdentificationCard',
  templateType: NodeType.StartNode,
  schema: sumitCardTriggerSchema,
  uischema: sumitCardTriggerUiSchema,
  // Exactly what the handler returns — `sumitCardTrigger` in `runtime.ts`. Why
  // the list is flat, and how the "תפיסות מסגרת" fields were measured, is
  // recorded with the data in `definition.ts`.
  outputSchema: {
    type: 'default',
    properties: sumitCardTriggerDefinition.outputFields,
  },
  defaultPropertiesData: sumitCardTriggerDefaultPropertiesData,
} satisfies PaletteItem<typeof sumitCardTriggerSchema>;
