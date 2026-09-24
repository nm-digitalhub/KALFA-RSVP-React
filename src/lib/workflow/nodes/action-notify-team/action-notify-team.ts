'use client';

// `action.notify_team` — its palette entry. Editor side; `catalogue/schemas.ts`
// places it in `PALETTE_ITEMS` at the index the inline entry held.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { notifyTeamDefaultPropertiesData } from './default-properties-data';
import * as notifyTeamDefinition from './definition';
import { notifyTeamSchema } from './schema';
import { notifyTeamUiSchema } from './uischema';

export const notifyTeamPaletteItem = {
  type: notifyTeamDefinition.type,
  // Rendered as a decision node so the failure branch has a handle to leave
  // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
  // which is a guaranteed dead end — the reason the option was withheld.
  templateType: NodeType.DecisionNode,
  label: 'התראה לצוות',
  description: 'שולח הודעה לערוץ הצוות',
  icon: 'Bell',
  schema: notifyTeamSchema,
  uischema: notifyTeamUiSchema,
  outputSchema: {
    type: 'default',
    properties: notifyTeamDefinition.outputFields,
  },
  defaultPropertiesData: notifyTeamDefaultPropertiesData,
} satisfies PaletteItem<typeof notifyTeamSchema>;
