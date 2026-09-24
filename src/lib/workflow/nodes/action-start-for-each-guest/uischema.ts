'use client';

// `action.start_for_each_guest` — the layout of its properties panel. Editor
// side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, rsvpStatusOptions, statusControl } from '../../catalogue/editor-shared';
import { CHECKBOX_LIST_FORMAT } from '../../catalogue/ui-formats';

import type { ForEachGuestSchema } from './schema';

const forEachGuestScope = getScope<ForEachGuestSchema>;

export const forEachGuestUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(forEachGuestScope('properties.label'), forEachGuestScope('properties.description')),
    {
      // ⚠️ THE WARNING BELONGS WHERE THE DAMAGE IS CONFIGURED. This node starts
      // one run per matching guest — a single press reaches hundreds of real
      // people — and until now the only thing saying so was the node's
      // `description`, which is a subtitle on a card and is read once.
      //
      // `RichText` renders Markdown, so the number an owner is about to choose
      // can be emphasised in the sentence that explains it. It binds to no
      // property and changes no data.
      type: 'RichText',
      text:
        '**כל אורח שתואם יקבל הרצה משלו.** לחיצה אחת יכולה להגיע למאות אנשים אמיתיים. ' +
        'המספר שתגדירו כאן הוא התקרה שלכם — ומעליה יש תקרה נוספת בקוד שאי אפשר לעקוף מהמסך הזה.',
    },
    {
      type: 'Text',
      scope: forEachGuestScope('properties.targetWorkflowId'),
      label: 'מזהה התהליך שירוץ לכל אורח',
      placeholder: 'הדביקו את המזהה מכתובת העורך',
    },
    {
      // Label beside the field rather than above it, with the `*` on the LABEL —
      // the shape the SDK's own Delay node uses for its required numeric field,
      // paired with `errorIndicatorEnabled: false` so one problem draws one
      // marker. The wait node's amount/unit row already reads this way; this
      // field did not, and it is the one with the largest blast radius.
      type: 'HorizontalLayout',
      layoutColumns: '1fr 1fr',
      elements: [
        { type: 'Label', text: 'עד כמה אורחים', required: true },
        {
          type: 'Text',
          scope: forEachGuestScope('properties.maxGuests'),
          inputType: 'number',
          errorIndicatorEnabled: false,
        },
      ],
    },
    {
      // The warning this node exists to carry. One press, hundreds of people.
      type: 'Label',
      text: 'שימו לב: הצעד הזה מתחיל הרצה נפרדת לכל אורח שמתאים. הריצו הרצת ניסיון לפני הפעלה — היא תראה לכמה אורחים זה יגיע.',
    },
    {
      type: 'Accordion',
      label: 'אילו אורחים',
      elements: [
        {
          type: 'Text',
          scope: forEachGuestScope('properties.statuses'),
          label: 'סטטוסים',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: Object.values(rsvpStatusOptions).map((o) => ({ value: o.value, label: o.label })),
            defaultNote: 'ברירת מחדל: כל הסטטוסים.',
          },
        },
        {
          type: 'Switch',
          scope: forEachGuestScope('properties.requirePhone'),
          label: 'רק אורחים עם טלפון',
        },
      ],
    },
    {
      type: 'Select',
      scope: forEachGuestScope('properties.errorPolicy'),
      label: 'אם הפיצול נכשל',
    },
    statusControl(forEachGuestScope('properties.status')),
  ],
};
