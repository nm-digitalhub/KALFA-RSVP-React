'use client';

// `logic.set_value` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SetValueSchema } from './schema';

const setValueScope = getScope<SetValueSchema>;

export const setValueUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(setValueScope('properties.label'), setValueScope('properties.description')),
    {
      type: 'VariableTextArea',
      scope: setValueScope('properties.value'),
      label: 'הערך',
      placeholder: 'למשל: שלום {{trigger.guest_name}}, מה שלומך?',
      minRows: 2,
    },
    {
      type: 'Label',
      text: 'הצעד לא שולח ולא כותב דבר — הוא מחשב ערך אחד שצעדים אחרי־כן יכולים לצטט.',
    },
    statusControl(setValueScope('properties.status')),
  ],
};
