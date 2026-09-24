'use client';

// `action.set_guest_field` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SetGuestFieldSchema } from './schema';

const setGuestFieldScope = getScope<SetGuestFieldSchema>;

export const setGuestFieldUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(setGuestFieldScope('properties.label'), setGuestFieldScope('properties.description')),
    { type: 'Select', scope: setGuestFieldScope('properties.field'), label: 'השדה לעדכון' },
    {
      type: 'VariableText',
      scope: setGuestFieldScope('properties.value'),
      label: 'הערך',
      placeholder: 'למשל {{trigger.message_text}}',
    },
    {
      type: 'Label',
      text: 'ריק מוחק את הערך הקיים. לא ניתן לשנות מכאן סטטוס או מספר מוזמנים — לאלה יש צעד משלהם.',
    },
    { type: 'Select', scope: setGuestFieldScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
    statusControl(setGuestFieldScope('properties.status')),
  ],
};
