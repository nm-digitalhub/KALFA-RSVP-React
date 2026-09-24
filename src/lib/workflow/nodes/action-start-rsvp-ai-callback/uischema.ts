'use client';

// `action.start_rsvp_ai_callback` — the layout of its properties panel. Editor
// side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { StartRsvpAiCallbackSchema } from './schema';

const startRsvpAiCallbackScope = getScope<StartRsvpAiCallbackSchema>;

export const startRsvpAiCallbackUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(startRsvpAiCallbackScope('properties.label'), startRsvpAiCallbackScope('properties.description')),
    {
      type: 'Label',
      text: 'מפעיל את סוכן RSVP הקולי הקיים דרך Voximplant ו-ElevenLabs. המודל, מאגר הידע והכלים מוגדרים בסוכן ואינם נשמרים בתהליך.',
    },
    {
      type: 'Label',
      text: 'השיחה אסינכרונית. הצעד מחזיר את תוצאת ההפעלה; ניתוח השיחה נשמר לאחר מכן דרך ה-webhook הקיים של ElevenLabs.',
    },
    {
      type: 'Select',
      scope: startRsvpAiCallbackScope('properties.errorPolicy'),
      label: 'אם הפעלת השיחה נכשלת',
    },
    statusControl(startRsvpAiCallbackScope('properties.status')),
  ],
};
