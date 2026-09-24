'use client';

// `action.set_guest_field` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { setGuestFieldDefaultPropertiesData } from './default-properties-data';
import * as setGuestFieldDefinition from './definition';
import { setGuestFieldSchema } from './schema';
import { setGuestFieldUiSchema } from './uischema';

export const setGuestFieldPaletteItem = {
  type: setGuestFieldDefinition.type,
  templateType: NodeType.DecisionNode,
  label: 'עדכון שדה אורח',
  description: 'כותב ערך לשדה אחד של האורח ששלח את ההודעה',
  icon: 'NotePencil',
  schema: setGuestFieldSchema,
  uischema: setGuestFieldUiSchema,
  outputSchema: {
    type: 'default',
    properties: setGuestFieldDefinition.outputFields,
  },
  defaultPropertiesData: setGuestFieldDefaultPropertiesData,
} satisfies PaletteItem<typeof setGuestFieldSchema>;
