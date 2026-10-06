'use client';

// `action.import_guest_list` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { ImportGuestListSchema } from './schema';

const importGuestListScope = getScope<ImportGuestListSchema>;

export const importGuestListUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(importGuestListScope('properties.label'), importGuestListScope('properties.description')),
    {
      type: 'Label',
      text: 'קולט את הקובץ או את אנשי הקשר שהגיעו בוואטסאפ ומעלה אותם לסקירה. האורחים נוצרים רק אחרי אישור במסך הייבוא — הצעד הזה לא מוסיף אורחים בעצמו.',
    },
    {
      type: 'Label',
      text: 'דורש טריגר וואטסאפ שמסומן בו "קובץ" או "כרטיסי אנשי קשר".',
    },
    {
      type: 'Select',
      scope: importGuestListScope('properties.errorPolicy'),
      label: 'אם הקליטה נכשלת',
    },
    statusControl(importGuestListScope('properties.status')),
  ],
};
