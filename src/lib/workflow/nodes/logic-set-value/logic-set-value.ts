'use client';

// `logic.set_value` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import type { PaletteItem } from '@workflowbuilder/sdk';

import { setValueDefaultPropertiesData } from './default-properties-data';
import * as setValueDefinition from './definition';
import { setValueSchema } from './schema';
import { setValueUiSchema } from './uischema';

export const setValuePaletteItem = {
  type: setValueDefinition.type,
  label: 'קביעת ערך',
  description: 'מחשב ערך אחד לשימוש בצעדים הבאים',
  icon: 'Tag',
  schema: setValueSchema,
  uischema: setValueUiSchema,
  outputSchema: {
    type: 'default',
    properties: setValueDefinition.outputFields,
  },
  defaultPropertiesData: setValueDefaultPropertiesData,
} satisfies PaletteItem<typeof setValueSchema>;
