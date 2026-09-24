'use client';

// `logic.wait` — its palette entry. Editor side; `catalogue/schemas.ts` places it
// in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import type { PaletteItem } from '@workflowbuilder/sdk';

import { waitDefaultPropertiesData } from './default-properties-data';
import * as waitDefinition from './definition';
import { waitSchema } from './schema';
import { waitUiSchema } from './uischema';

export const waitPaletteItem = {
  type: waitDefinition.type,
  label: 'המתנה',
  description: 'עוצר את התהליך וממשיך אותו מאוחר יותר',
  icon: 'Hourglass',
  schema: waitSchema,
  uischema: waitUiSchema,
  outputSchema: {
    type: 'default',
    properties: waitDefinition.outputFields,
  },
  defaultPropertiesData: waitDefaultPropertiesData,
} satisfies PaletteItem<typeof waitSchema>;
