'use client';

// `action.import_guest_list` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { importGuestListDefaultPropertiesData } from './default-properties-data';
import * as importGuestListDefinition from './definition';
import { importGuestListSchema } from './schema';
import { importGuestListUiSchema } from './uischema';

export const importGuestListPaletteItem = {
  type: importGuestListDefinition.type,
  // Decision node so the failure branch has a handle to leave from — a file
  // that will not parse is the case an owner most wants to route somewhere.
  templateType: NodeType.DecisionNode,
  label: 'קליטת רשימת אורחים',
  description: 'מעלה לסקירה קובץ או אנשי קשר שהגיעו בוואטסאפ',
  icon: 'UsersThree',
  schema: importGuestListSchema,
  uischema: importGuestListUiSchema,
  outputSchema: {
    type: 'default',
    properties: importGuestListDefinition.outputFields,
  },
  defaultPropertiesData: importGuestListDefaultPropertiesData,
} satisfies PaletteItem<typeof importGuestListSchema>;
