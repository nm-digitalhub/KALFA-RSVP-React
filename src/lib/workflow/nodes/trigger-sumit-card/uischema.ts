'use client';

// `trigger.sumit_card` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl, triggerSwitchElement } from '../../catalogue/editor-shared';
import { SUMIT_FOLDER_FORMAT, WEBHOOK_TOKEN_FORMAT } from '../../catalogue/ui-formats';

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
      // Folder AND view in one control: the view list depends on the folder, so
      // the control loads both from SUMIT on demand and writes `viewId` beside it.
      // 'Select', so that once this renderer strips its format marker the SDK's
      // own Select draws the field (see sumit-folder-control.tsx).
      type: 'Select',
      scope: sumitCardTriggerScope('properties.folderId'),
      label: 'תיקייה ב-SUMIT',
      options: { format: SUMIT_FOLDER_FORMAT },
    },
    {
      type: 'Select',
      scope: sumitCardTriggerScope('properties.changeType'),
      label: 'השינוי שמפעיל את התהליך',
    },
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
      // Two ways in, said plainly: we register the trigger (folder + view above,
      // then the button under the address), or the owner does it in SUMIT.
      type: 'RichText',
      text:
        '**רישום אוטומטי:** בחרו תיקייה, תצוגה ושינוי, צרו כתובת ולחצו **רישום ב-SUMIT**. ' +
        'הטריגר נרשם כשהתהליך פעיל, ומבוטל כשמכבים אותו.\n\n' +
        '**רישום ידני (אם לא בחרתם תיקייה):** ב-SUMIT, מודול טריגרים ← **יצירת טריגר** — בחרו תיקייה ותצוגה, ' +
        'את השינוי, ובשלבים לביצוע קריאת HTTP עם הכתובת ובסוג קריאה **JSON**.',
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
