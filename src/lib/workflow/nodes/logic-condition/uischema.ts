'use client';

// `logic.condition` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import { UNARY_CONDITION_OPERATORS } from './definition';
import type { ConditionSchema } from './schema';

const conditionScope = getScope<ConditionSchema>;

export const conditionUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(conditionScope('properties.label'), conditionScope('properties.description')),
    { type: 'Select', scope: conditionScope('properties.field'), label: 'בדוק את' },
    {
      // The escape hatch from the dropdown, and the reason the dropdown is no
      // longer a ceiling. `nodes/conditional.md` describes both sides of a
      // comparison as free values that may reference earlier nodes; this is that
      // side. Left blank, the dropdown above is used — which is how every
      // diagram saved before this keeps behaving.
      type: 'VariableText',
      scope: conditionScope('properties.left'),
      label: 'או השוו ערך משלכם (גובר על הבחירה למעלה)',
      placeholder: "למשל {{nodes.<id>.value}} או {{trigger.guest_name}}",
    },
    { type: 'Select', scope: conditionScope('properties.operator'), label: 'התנאי' },
    {
      // Also a VariableText: the right-hand side is as free as the left, so a
      // condition can compare one node's output against another's.
      type: 'VariableText',
      scope: conditionScope('properties.value'),
      label: 'ערך',
      // The unary operators take no operand. Hiding the box is the difference
      // between a form that explains itself and one that invites a value it will
      // ignore. Spelled as an enum rather than a const because there are now two
      // such operators and a `const` rule would only ever hide for one of them.
      rule: {
        effect: 'HIDE',
        condition: {
          scope: conditionScope('properties.operator'),
          schema: { enum: [...UNARY_CONDITION_OPERATORS] },
        },
      },
    },
    statusControl(conditionScope('properties.status')),
  ],
};
