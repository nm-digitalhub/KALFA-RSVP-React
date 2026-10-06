'use client';

// `logic.switch` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SwitchSchema } from './schema';

const switchScope = getScope<SwitchSchema>;

export const switchUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(switchScope('properties.label'), switchScope('properties.description')),
    // Kept as a convenience, NOT as the thing branches compare against: each row
    // carries its own `x`. An owner who wants one value routed several ways can
    // paste it here and reference it, and one who does not can ignore it. The
    // handler never reads it, which is why it left `required`.
    {
      type: 'VariableText',
      scope: switchScope('properties.left'),
      label: 'הערך לניתוב (לא חובה)',
      placeholder: 'למשל {{trigger.button_payload}}',
    },
    // THE control. Renders one card per branch — rename, reorder, delete — each
    // opening the SDK's condition editor with its ten operators and the variable
    // picker fed by every upstream node's `outputSchema`.
    { type: 'DecisionBranches', scope: switchScope('properties.decisionBranches') },
    statusControl(switchScope('properties.status')),
  ],
};
