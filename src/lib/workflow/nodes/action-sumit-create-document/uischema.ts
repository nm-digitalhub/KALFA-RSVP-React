'use client';

// `action.sumit_create_document` — the layout of its properties panel. Editor
// side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SumitCreateDocumentSchema } from './schema';

const sumitCreateDocumentScope = getScope<SumitCreateDocumentSchema>;

// The four ARM-BLOCKING fields stay FLAT — the house rule recorded in
// `nodes/action-microsoft-send-email/uischema.ts`: a field `arm-check.ts`
// refuses to arm on must be visible without opening an accordion, or the owner
// meets it as a blocker instead of a form.
export const sumitCreateDocumentUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(
      sumitCreateDocumentScope('properties.label'),
      sumitCreateDocumentScope('properties.description'),
    ),
    {
      type: 'Select',
      scope: sumitCreateDocumentScope('properties.documentType'),
      label: 'סוג המסמך',
    },
    {
      type: 'VariableText',
      scope: sumitCreateDocumentScope('properties.customerName'),
      label: 'שם הלקוח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
    },
    {
      type: 'Accordion',
      label: 'פרטי הלקוח',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerEmail'),
          label: 'אימייל',
        },
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerPhone'),
          label: 'טלפון',
        },
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.customerExternalId'),
          label: 'מזהה חיצוני',
          placeholder: 'המזהה שלנו ללקוח — לצורך התאמה מול SUMIT',
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.customerNoVat'),
          label: 'הלקוח פטור ממע״מ',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'שורת פריט (אופציונלי)',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateDocumentScope('properties.itemName'),
          label: 'שם הפריט',
        },
        {
          type: 'Text',
          scope: sumitCreateDocumentScope('properties.itemQuantity'),
          label: 'כמות',
        },
        {
          type: 'Text',
          scope: sumitCreateDocumentScope('properties.itemUnitPrice'),
          label: 'מחיר ליחידה (₪)',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'אפשרויות המסמך',
      elements: [
        {
          type: 'VariableTextArea',
          scope: sumitCreateDocumentScope('properties.documentDescription'),
          label: 'תיאור שמודפס על המסמך',
          minRows: 2,
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.isDraft'),
          label: 'שמירה כטיוטה',
        },
        {
          type: 'Switch',
          scope: sumitCreateDocumentScope('properties.sendByEmail'),
          label: 'שליחת המסמך במייל ללקוח',
        },
      ],
    },
    // status and errorPolicy stay FLAT: accordion-classification.test.ts
    // refuses to let a node-level switch be folded away, and `status` is
    // what decides whether the step runs at all.
    statusControl(sumitCreateDocumentScope('properties.status')),
    {
      type: 'Select',
      scope: sumitCreateDocumentScope('properties.errorPolicy'),
      label: 'התנהגות בשגיאה',
    },
  ],
};
