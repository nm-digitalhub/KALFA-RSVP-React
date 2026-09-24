'use client';

// `action.send_template` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import type { PaletteItem } from '@workflowbuilder/sdk';

import { sendTemplateDefaultPropertiesData } from './default-properties-data';
import * as sendTemplateDefinition from './definition';
import { sendTemplateSchema } from './schema';
import { sendTemplateUiSchema } from './uischema';

export const sendTemplatePaletteItem = {
  type: sendTemplateDefinition.type,
  label: 'שליחת תבנית',
  description: 'שולח לאורח תבנית מאושרת — אפשרי בכל זמן',
  icon: 'ChatCircleText',
  schema: sendTemplateSchema,
  uischema: sendTemplateUiSchema,
  outputSchema: {
    type: 'default',
    properties: sendTemplateDefinition.outputFields,
  },
  defaultPropertiesData: sendTemplateDefaultPropertiesData,
} satisfies PaletteItem<typeof sendTemplateSchema>;
