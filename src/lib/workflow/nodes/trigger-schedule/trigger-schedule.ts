'use client';

// `trigger.schedule` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { scheduleDefaultPropertiesData } from './default-properties-data';
import * as scheduleDefinition from './definition';
import { scheduleSchema } from './schema';
import { scheduleUiSchema } from './uischema';

export const schedulePaletteItem = {
  type: scheduleDefinition.type,
  label: 'לפי שעון',
  description: 'מתחיל את התהליך בשעה קבועה',
  icon: 'Clock',
  // The SDK's start-node body draws one handle, no target dot — the same
  // reason the other triggers use it.
  templateType: NodeType.StartNode,
  schema: scheduleSchema,
  uischema: scheduleUiSchema,
  outputSchema: {
    type: 'default',
    properties: scheduleDefinition.outputFields,
  },
  defaultPropertiesData: scheduleDefaultPropertiesData,
} satisfies PaletteItem<typeof scheduleSchema>;
