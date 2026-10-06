'use client';

// `trigger.schedule` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl, triggerSwitchElement } from '../../catalogue/editor-shared';
import { CHECKBOX_LIST_FORMAT } from '../../catalogue/ui-formats';

import { scheduleDayOptions, type ScheduleSchema } from './schema';

const scheduleScope = getScope<ScheduleSchema>;

export const scheduleUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(scheduleScope('properties.label'), scheduleScope('properties.description')),
    {
      type: 'Text',
      scope: scheduleScope('properties.time'),
      label: 'שעה (24 שעות)',
      placeholder: '09:00',
    },
    {
      type: 'Accordion',
      label: 'באילו ימים',
      elements: [
        {
          type: 'Text',
          scope: scheduleScope('properties.days'),
          label: 'ימים',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: scheduleDayOptions.map((d) => ({ ...d })),
            defaultNote: 'ברירת מחדל: כל יום.',
          },
        },
      ],
    },
    {
      // The two facts an owner cannot see from the canvas.
      type: 'Label',
      text: 'השעה היא לפי שעון ישראל, וממשיכה להיות נכונה גם אחרי מעבר שעון.',
    },
    {
      type: 'Label',
      text: 'הרצה מתוזמנת אינה מתחילה מאורח — צעדים שפועלים על אורח יסרבו בתוכה.',
    },
    statusControl(scheduleScope('properties.status')),
  ],
};
