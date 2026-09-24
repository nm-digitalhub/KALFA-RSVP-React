'use client';

// `action.create_callback_request` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { CallbackRequestSchema } from './schema';

const callbackRequestScope = getScope<CallbackRequestSchema>;

export const callbackRequestUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(callbackRequestScope('properties.label'), callbackRequestScope('properties.description')),
    { type: 'Select', scope: callbackRequestScope('properties.topic'), label: 'נושא הפנייה' },
    {
      type: 'VariableText',
      scope: callbackRequestScope('properties.note'),
      label: 'הערה למי שיחזור לאורח',
      placeholder: '{{trigger.guest_name}} כתב: {{trigger.message_text}}',
    },
    {
      // The dedupe is behaviour an owner should not discover from a support call.
      type: 'Label',
      text: 'אם כבר פתוחה בקשת חזרה לאותו מספר בשעתיים האחרונות — לא תיווצר בקשה נוספת.',
    },
    { type: 'Select', scope: callbackRequestScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
    statusControl(callbackRequestScope('properties.status')),
  ],
};
