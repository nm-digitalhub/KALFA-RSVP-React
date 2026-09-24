'use client';

// `action.send_whatsapp` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SendWhatsappSchema } from './schema';

const sendWhatsappScope = getScope<SendWhatsappSchema>;

export const sendWhatsappUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(sendWhatsappScope('properties.label'), sendWhatsappScope('properties.description')),
    {
      // `VariableTextArea`, and this is the control the SDK ships for exactly
      // this shape. Typing `{{` opens the variable picker; the picker writes
      // `{{nodes.<id>.<field>}}`; `activity-runner.ts` resolves it against the
      // live execution context before this handler ever sees the string.
      //
      // It was `TextArea` until the resolver was vendored, because the picker
      // would have written a reference the adapter then refused to run.
      type: 'VariableTextArea',
      scope: sendWhatsappScope('properties.body'),
      label: 'ההודעה שתישלח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
      minRows: 3,
    },
    {
      type: 'Label',
      text: 'ההודעה נשלחת לאורח ששלח את ההודעה הנכנסת, ורק לו. אין אפשרות לבחור נמען אחר.',
    },
    {
      type: 'Select',
      scope: sendWhatsappScope('properties.errorPolicy'),
      label: 'אם השליחה נכשלת',
    },
    statusControl(sendWhatsappScope('properties.status')),
  ],
};
