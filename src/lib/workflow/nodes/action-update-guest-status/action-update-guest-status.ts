'use client';

// `action.update_guest_status` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { updateGuestStatusDefaultPropertiesData } from './default-properties-data';
import * as updateGuestStatusDefinition from './definition';
import { updateGuestStatusSchema } from './schema';
import { updateGuestStatusUiSchema } from './uischema';

export const updateGuestStatusPaletteItem = {
  type: updateGuestStatusDefinition.type,
  // Rendered as a decision node so the failure branch has a handle to leave
  // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
  // which is a guaranteed dead end — the reason the option was withheld.
  templateType: NodeType.DecisionNode,
  label: 'עדכון סטטוס אורח',
  description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
  icon: 'UserCheck',
  schema: updateGuestStatusSchema,
  uischema: updateGuestStatusUiSchema,
  outputSchema: {
    type: 'default',
    properties: updateGuestStatusDefinition.outputFields,
  },
  defaultPropertiesData: updateGuestStatusDefaultPropertiesData,
} satisfies PaletteItem<typeof updateGuestStatusSchema>;
