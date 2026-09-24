'use client';

// `action.sumit_create_document` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { sumitCreateDocumentDefaultPropertiesData } from './default-properties-data';
import * as sumitCreateDocumentDefinition from './definition';
import { sumitCreateDocumentSchema } from './schema';
import { sumitCreateDocumentUiSchema } from './uischema';

export const sumitCreateDocumentPaletteItem = {
  type: sumitCreateDocumentDefinition.type,
  label: 'הפקת מסמך ב-SUMIT',
  description: 'מפיק קבלה, הצעת מחיר או מסמך אחר. לא מבצע חיוב.',
  icon: 'FileText',
  templateType: NodeType.DecisionNode,
  schema: sumitCreateDocumentSchema,
  uischema: sumitCreateDocumentUiSchema,
  defaultPropertiesData: sumitCreateDocumentDefaultPropertiesData,
  outputSchema: {
    type: 'default',
    properties: sumitCreateDocumentDefinition.outputFields,
  },
} satisfies PaletteItem<typeof sumitCreateDocumentSchema>;
