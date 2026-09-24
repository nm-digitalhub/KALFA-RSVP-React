'use client';

// `action.send_template` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SendTemplateSchema } from './schema';

const sendTemplateScope = getScope<SendTemplateSchema>;

export const sendTemplateUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(sendTemplateScope('properties.label'), sendTemplateScope('properties.description')),
    { type: 'Select', scope: sendTemplateScope('properties.messageKey'), label: 'איזו תבנית' },
    {
      // The distinction that decides which of the two send nodes to use, said
      // plainly — it is not visible from the canvas and gets discovered the hard
      // way otherwise.
      type: 'Label',
      text: 'תבנית אפשר לשלוח בכל זמן. "שליחת וואטסאפ" (טקסט חופשי) מותרת רק עד 24 שעות אחרי שהאורח כתב — לכן תהליך שמתחיל לפי שעון חייב תבנית.',
    },
    {
      type: 'Label',
      text: 'הטקסט עצמו מגיע מהתבנית המאושרת ולא נערך כאן. אורח שביקש הסרה לא יקבל.',
    },
    statusControl(sendTemplateScope('properties.status')),
  ],
};
