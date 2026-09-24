'use client';

// `action.start_for_each_guest` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { forEachGuestDefaultPropertiesData } from './default-properties-data';
import * as startForEachGuestDefinition from './definition';
import { forEachGuestSchema } from './schema';
import { forEachGuestUiSchema } from './uischema';

export const forEachGuestPaletteItem = {
  type: startForEachGuestDefinition.type,
  // Decision node so a failure has a handle to leave from — a fan-out that
  // could not read the guest list is exactly the case worth routing.
  templateType: NodeType.DecisionNode,
  label: 'הרצה לכל אורח',
  description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
  icon: 'UsersThree',
  schema: forEachGuestSchema,
  uischema: forEachGuestUiSchema,
  outputSchema: {
    type: 'default',
    properties: startForEachGuestDefinition.outputFields,
  },
  defaultPropertiesData: forEachGuestDefaultPropertiesData,
} satisfies PaletteItem<typeof forEachGuestSchema>;
