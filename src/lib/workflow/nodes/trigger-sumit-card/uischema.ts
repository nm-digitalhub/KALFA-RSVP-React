'use client';

// `trigger.sumit_card` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl, triggerSwitchElement } from '../../catalogue/editor-shared';
import { WEBHOOK_TOKEN_FORMAT } from '../../catalogue/ui-formats';

import type { SumitCardTriggerSchema } from './schema';

const sumitCardTriggerScope = getScope<SumitCardTriggerSchema>;

export const sumitCardTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(
      sumitCardTriggerScope('properties.label'),
      sumitCardTriggerScope('properties.description'),
    ),
    {
      // The same control as the webhook trigger's. It asks `authModeFor`, which
      // answers `address` for this type whatever the row says — so it mints one
      // address, shows it once, and stores only the hash.
      type: 'Text',
      scope: sumitCardTriggerScope('properties.tokenHash'),
      label: 'הכתובת להדבקה ב-SUMIT',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },

    {
      // SUMIT's own help article, step for step (10442304), because every
      // choice that decides what fires is made there and not here.
      type: 'RichText',
      text:
        '**איך מחברים:** ב-SUMIT, מודול טריגרים ← **יצירת טריגר**.\n\n' +
        '1. **תיקייה ותצוגה** — התיקייה שעליה התהליך יעבוד, ותצוגה שבה הפילטרים בוחרים רק את הכרטיסים הרלוונטיים.\n' +
        '2. **השינוי שיוזם את הטריגר** — יצירה, עדכון, העברה לארכיון או מחיקה.\n' +
        '3. **שלבים לביצוע** — יצירת קריאת HTTP. הדביקו את הכתובת מלמעלה ובחרו סוג קריאה **JSON**.',
    },
    {
      type: 'Label',
      text: 'דורש ב-SUMIT מסלול "צמיחה" ומעלה, ומודולי טריגרים, API וניהול תצוגות מותקנים.',
    },
    {
      // Data minimisation, said where the choice is made: the VIEW's columns are
      // what SUMIT sends, and the whole body is stored with the run.
      type: 'Label',
      text: 'העמודות בתצוגה קובעות אילו שדות נשלחים, והכול נשמר עם ההרצה — השאירו בתצוגה רק את מה שהתהליך צריך. שדות מקושרים מתיקייה אחרת (למשל מייל מכרטיס הלקוח) לא נשלחים.',
    },
    {
      type: 'Label',
      text: 'הקריאה מ-SUMIT אינה חתומה: מי שמחזיק בכתובת יכול לשלוח כל תוכן. השתמשו בה להתראה ולבדיקה — לעולם לא כבסיס לפעולה כספית.',
    },
    {
      // The two ways this node goes quiet that nothing on the canvas shows.
      type: 'Label',
      text: 'אחרי ההדבקה, ודאו במסך "פעולות אוטומציה" ב-SUMIT שהקריאה הראשונה התקבלה. כשהתהליך כבוי הכתובת מחזירה שגיאה, ואחרי חמש שגיאות SUMIT משהה את הטריגר אצלה.',
    },
    {
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(sumitCardTriggerScope('properties.status')),
  ],
};
