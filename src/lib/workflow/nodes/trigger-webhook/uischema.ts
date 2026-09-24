'use client';

// `trigger.webhook` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl, triggerSwitchElement } from '../../catalogue/editor-shared';
import { CHECKBOX_LIST_FORMAT, WEBHOOK_TOKEN_FORMAT } from '../../catalogue/ui-formats';

import { webhookMethodOptions, type WebhookTriggerSchema } from './schema';

const webhookTriggerScope = getScope<WebhookTriggerSchema>;

export const webhookTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(webhookTriggerScope('properties.label'), webhookTriggerScope('properties.description')),
    {
      // ⚠️ ABOVE THE ADDRESS CONTROL, because it decides what that control is
      // for. Changing it CLEARS whatever was generated — see the control — so an
      // owner who flips it after generating has to press the button again, and
      // arming refuses until they do.
      type: 'Select',
      scope: webhookTriggerScope('properties.auth'),
      label: 'איך הקורא מזדהה',
    },
    {
      // ONE renderer for every shape this takes — the public address and the
      // secret in `header` mode, the single once-shown address in `address`
      // mode. They are created together and must never drift apart, so one
      // control creates, displays and rotates them. It binds to `tokenHash`
      // because that is the field JsonForms writes through and the one field
      // BOTH modes have; it reaches `auth` and `endpointId` on the same node.
      type: 'Text',
      scope: webhookTriggerScope('properties.tokenHash'),
      label: 'כתובת וסוד',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },
    {
      type: 'Label',
      text: 'אימות בכותרת: הכתובת גלויה וניתנת להעתקה בכל עת, והסוד נשלח ב-x-kalfa-webhook-secret ומוצג פעם אחת בלבד. יצירת סוד חדש אינה משנה את הכתובת.',
    },
    {
      // ⚠️ THE COST OF THE OTHER MODE, SPELLED OUT WHERE IT IS CHOSEN. An owner
      // who picks it is giving up exactly the thing the 2026-09-22 split was
      // built to give them back — a recoverable address — and finding that out
      // later, from a lost integration, is the failure this sentence prevents.
      type: 'Label',
      text: 'אימות לפי כתובת: הכתובת עצמה היא הסוד, מוצגת פעם אחת בלבד ואינה ניתנת לשחזור — נשמר רק גיבוב שלה. בחרו באפשרות הזו רק כשהמערכת הקוראת אינה יודעת לשלוח כותרת (למשל SUMIT). קריאת GET לא תעבוד במצב הזה.',
    },
    {
      type: 'Accordion',
      label: 'באילו שיטות אפשר לקרוא',
      elements: [
        {
          type: 'Text',
          scope: webhookTriggerScope('properties.methods'),
          label: 'שיטות HTTP',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: webhookMethodOptions.map((o) => ({ ...o })),
            defaultNote: 'ברירת מחדל: POST בלבד.',
          },
        },
        {
          type: 'Label',
          text: 'GET ו-DELETE אינם נושאים גוף. בקריאה כזו {{trigger.body}} יהיה ריק, והערכים יגיעו ב-{{trigger.query.<שם>}} מתוך הכתובת.',
        },
      ],
    },
    {
      // The limitation an owner would otherwise discover from a failed run.
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(webhookTriggerScope('properties.status')),
  ],
};
