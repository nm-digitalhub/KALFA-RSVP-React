'use client';

// `action.notify_team` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { NotifyTeamSchema } from './schema';

const notifyTeamScope = getScope<NotifyTeamSchema>;

export const notifyTeamUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(notifyTeamScope('properties.label'), notifyTeamScope('properties.description')),
    {
      // VariableText, matching `detail` below rather than differing from it.
      //
      // The runtime resolves `{{…}}` in EVERY config field — `resolveConfigTemplates`
      // walks the whole object — so this field already accepted references; what it
      // did not do was offer the picker. An owner typing `{{` here got no
      // suggestions on a field that would have resolved them, which reads as
      // "references do not work here" and is the opposite of the truth.
      //
      // ⚠️ NOT extended to `action.webhook`'s url. That one is plain Text
      // deliberately — see the note there: a destination assembled at run time is
      // a destination nobody reviewed, and the https/private-space check would be
      // judging a string that did not exist when the diagram was saved.
      type: 'VariableText',
      scope: notifyTeamScope('properties.title'),
      label: 'כותרת ההתראה',
      placeholder: 'למשל: אורח {{trigger.guest_name}} כתב משהו שלא זוהה',
    },
    {
      type: 'VariableTextArea',
      scope: notifyTeamScope('properties.detail'),
      label: 'פירוט',
      placeholder: 'הקלידו {{ כדי לצטט ערך מהצעדים הקודמים',
      minRows: 3,
    },
    { type: 'Select', scope: notifyTeamScope('properties.level'), label: 'רמה' },
    {
      type: 'Label',
      // Not a caveat — a fact an owner needs before writing the title. Slack
      // suppresses a repeated title inside the dedup window, so a per-message
      // alert with a fixed title arrives once and then goes quiet.
      text: 'ההתראה נשלחת לערוץ הצוות בלבד ולא לאורח. כותרת זהה שחוזרת נדחסת לפי חלון הכיווץ של ההתראות.',
    },
    { type: 'Select', scope: notifyTeamScope('properties.errorPolicy'), label: 'אם ההתראה נכשלת' },
    statusControl(notifyTeamScope('properties.status')),
  ],
};
