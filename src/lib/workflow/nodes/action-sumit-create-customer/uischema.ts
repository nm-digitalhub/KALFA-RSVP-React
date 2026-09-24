'use client';

// `action.sumit_create_customer` — the layout of its properties panel. Editor
// side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { SumitCreateCustomerSchema } from './schema';

const sumitCreateCustomerScope = getScope<SumitCreateCustomerSchema>;

export const sumitCreateCustomerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(
      sumitCreateCustomerScope('properties.label'),
      sumitCreateCustomerScope('properties.description'),
    ),
    {
      type: 'VariableText',
      scope: sumitCreateCustomerScope('properties.customerName'),
      label: 'שם הלקוח',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
    },
    {
      type: 'Accordion',
      label: 'פרטי קשר',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.customerEmail'),
          label: 'אימייל',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.customerPhone'),
          label: 'טלפון',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.city'),
          label: 'עיר',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.address'),
          label: 'כתובת',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'פרטים עסקיים',
      elements: [
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.companyNumber'),
          label: 'ח.פ. / ע.מ.',
        },
        {
          type: 'VariableText',
          scope: sumitCreateCustomerScope('properties.externalId'),
          label: 'מזהה חיצוני',
        },
        {
          type: 'Switch',
          scope: sumitCreateCustomerScope('properties.noVat'),
          label: 'הלקוח פטור ממע״מ',
        },
      ],
    },
    // status and errorPolicy stay FLAT: accordion-classification.test.ts
    // refuses to let a node-level switch be folded away, and `status` is
    // what decides whether the step runs at all.
    statusControl(sumitCreateCustomerScope('properties.status')),
    {
      type: 'Select',
      scope: sumitCreateCustomerScope('properties.errorPolicy'),
      label: 'התנהגות בשגיאה',
    },
  ],
};
