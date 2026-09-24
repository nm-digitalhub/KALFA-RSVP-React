'use client';

// `action.microsoft_send_email` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held, and `buildPaletteItems` swaps in `microsoftSendEmailSchemaFor`
// with the installation's live connections.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { microsoftSendEmailDefaultPropertiesData } from './default-properties-data';
import * as microsoftSendEmailDefinition from './definition';
import { microsoftSendEmailSchema } from './schema';
import { microsoftSendEmailUiSchema } from './uischema';

export const microsoftSendEmailPaletteItem = {
  type: microsoftSendEmailDefinition.type,
  templateType: NodeType.DecisionNode,
  label: 'שליחת דוא״ל ב-Microsoft 365',
  description: 'שולח הודעת דוא״ל באמצעות חיבור Microsoft 365 מנוהל',
  icon: 'EnvelopeSimple',
  schema: microsoftSendEmailSchema,
  uischema: microsoftSendEmailUiSchema,
  outputSchema: {
    type: 'default',
    properties: microsoftSendEmailDefinition.outputFields,
  },
  defaultPropertiesData: microsoftSendEmailDefaultPropertiesData,
} satisfies PaletteItem<typeof microsoftSendEmailSchema>;
