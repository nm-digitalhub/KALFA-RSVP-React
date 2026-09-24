'use client';

// `action.ai_agent` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';

import type { AiAgentSchema } from './schema';

const aiAgentScope = getScope<AiAgentSchema>;

export const aiAgentUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(aiAgentScope('properties.label'), aiAgentScope('properties.description')),
    {
      type: 'Accordion',
      label: 'ההנחיה',
      elements: [
        {
          // `VariableTextArea`, the same control the vendor's own AI node uses —
          // so `{{nodes.<id>.<field>}}` from an earlier step can be named inside
          // the prompt, with the picker offering them.
          type: 'VariableTextArea',
          scope: aiAgentScope('properties.systemPrompt'),
          label: 'מה לבקש מהמודל',
          placeholder: 'כתבו כאן. השתמשו ב-{{ כדי להכניס ערך מצעד קודם.',
          minRows: 5,
        },
        {
          type: 'Label',
          text: 'התשובה זמינה לצעדים הבאים כ-{{nodes.<מזהה>.text}}. הצעד הזה אינו מחליט לבד — כדי להסתעף לפי התשובה, הוסיפו אחריו צומת "תנאי".',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'מודל ותקרה',
      elements: [
        { type: 'Select', scope: aiAgentScope('properties.model'), label: 'מודל' },
        {
          type: 'Text',
          scope: aiAgentScope('properties.maxTurns'),
          label: 'מקסימום סבבים',
          inputType: 'number',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'כלים',
      elements: [
        { type: 'AiTools', scope: aiAgentScope('properties.tools') },
        {
          type: 'Label',
          text: 'הכלים עדיין אינם פעילים — הצעד שואל את המודל ומחזיר טקסט בלבד, ומה שנכתב כאן אינו נשלח לשום מקום. אל תזינו מפתח בשדה ה-API Key: התרשים ניתן לייצוא, ומה שיוזן שם יימחק בייצוא.',
        },
      ],
    },
    statusControl(aiAgentScope('properties.status')),
    { type: 'Select', scope: aiAgentScope('properties.errorPolicy'), label: 'אם הצעד נכשל' },
  ],
};
