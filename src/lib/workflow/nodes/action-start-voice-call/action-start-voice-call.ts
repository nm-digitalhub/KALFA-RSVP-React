'use client';

// `action.start_voice_call` — its palette entry. Editor side;
// `catalogue/schemas.ts` places it in `PALETTE_ITEMS` at the index the inline
// entry held, and `buildPaletteItems` swaps in `voiceCallSchemaFor` with the
// installation's live purposes and dial lists.
//
// The output fields come from the definition, so the variable picker reads one
// declaration of what this node returns.
import { NodeType } from '@workflowbuilder/sdk';
import type { PaletteItem } from '@workflowbuilder/sdk';

import { voiceCallDefaultPropertiesData } from './default-properties-data';
import * as startVoiceCallDefinition from './definition';
import { voiceCallSchema } from './schema';
import { voiceCallUiSchema } from './uischema';

export const voiceCallPaletteItem = {
  type: startVoiceCallDefinition.type,
  label: 'שיחה עם סוכן קולי',
  description: 'מתקשר לאורח עם אחד הסוכנים הקוליים שהוגדרו',
  icon: 'PhoneOutgoing',
  templateType: NodeType.DecisionNode,
  schema: voiceCallSchema,
  uischema: voiceCallUiSchema,
  outputSchema: {
    type: 'default',
    properties: startVoiceCallDefinition.outputFields,
  },
  defaultPropertiesData: voiceCallDefaultPropertiesData,
} satisfies PaletteItem<typeof voiceCallSchema>;
