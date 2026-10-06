'use client';

// `logic.wait` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { WaitSchema } from './schema';

const waitScope = getScope<WaitSchema>;

export const waitUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(waitScope('properties.label'), waitScope('properties.description')),
    {
      type: 'HorizontalLayout',
      elements: [
        { type: 'Text', scope: waitScope('properties.amount'), label: 'כמה', inputType: 'number' },
        { type: 'Select', scope: waitScope('properties.unit'), label: 'יחידה' },
      ],
    },
    {
      // The two things an owner cannot see from the canvas and will otherwise
      // learn from a surprise.
      type: 'Label',
      text: 'ההרצה נעצרת כאן וחוזרת מעצמה. עד אז היא מופיעה כ"ממתינה" ולא כהושלמה.',
    },
    {
      type: 'Label',
      text: 'שימו לב: אם תערכו את התהליך בזמן ההמתנה, ההרצה תמשיך לפי הגרסה החדשה.',
    },
    statusControl(waitScope('properties.status')),
  ],
};
