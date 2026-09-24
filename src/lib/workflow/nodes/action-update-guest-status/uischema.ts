'use client';

// `action.update_guest_status` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { UpdateGuestStatusSchema } from './schema';

const updateGuestStatusScope = getScope<UpdateGuestStatusSchema>;

export const updateGuestStatusUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(updateGuestStatusScope('properties.label'), updateGuestStatusScope('properties.description')),
    {
      type: 'Select',
      scope: updateGuestStatusScope('properties.rsvpStatus'),
      label: 'הסטטוס החדש',
    },
    {
      type: 'Select',
      scope: updateGuestStatusScope('properties.errorPolicy'),
      label: 'אם הצעד נכשל',
    },
    // The label above says what is chosen; this says what it costs. 'continue'
    // does not retry and does not recover — the guest's status stays unwritten
    // and only the run's own verdict changes. Without this line the option
    // reads like a safety net.
    {
      type: 'Label',
      text: 'בחירה ב"המשך" לא כותבת את הסטטוס — היא רק מונעת מהכשל לסמן את ההרצה ככושלת. הכשל עצמו עדיין נרשם ביומן.',
    },
    statusControl(updateGuestStatusScope('properties.status')),
  ],
};
