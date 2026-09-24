'use client';

// `action.microsoft_send_email` — the layout of its properties panel. Editor
// side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';
import { INTEGRATION_CONNECTION_FORMAT } from '../../catalogue/ui-formats';

import type { MicrosoftSendEmailSchema } from './schema';

const microsoftSendEmailScope = getScope<MicrosoftSendEmailSchema>;

// ⚠️ THE FOUR REQUIRED FIELDS STAY FLAT, AND THAT IS THE HOUSE RULE, NOT A
// PREFERENCE. `accordion-classification.test.ts` measured the 2.3.0 renderer and
// settled it: `Group` belongs to the identity block alone, and an `Accordion` is
// what a grouping BECOMES — genuinely collapsible, with no way for a uischema to
// ask for closed. So wrapping `connectionId`, `to`, `subject` or `body` in either
// container would be wrong twice over: a second `Group` breaks the rule outright,
// and an `Accordion` offers to fold away fields that arming refuses without.
//
// What the two Accordions below hold is exactly what the rule permits — optional
// recipients and options almost nobody changes.
//
// ⚠️ `connectionId` KEEPS ITS `format`. That is not a layout choice: it is the
// dispatch key that replaces the SDK's Select with our own control, and that
// control is what draws the "connect an account" button inside the panel.
// Dropping it would leave an owner with no connection and no way to make one
// without leaving the editor. `microsoft-connection.test.ts` pins all three
// values.
export const microsoftSendEmailUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(microsoftSendEmailScope('properties.label'), microsoftSendEmailScope('properties.description')),
    {
      type: 'Select',
      scope: microsoftSendEmailScope('properties.connectionId'),
      label: 'חיבור Microsoft 365',
      options: {
        // The custom renderer adds the OAuth entry point around the SDK's own
        // Select. These three values are catalogue configuration, not workflow
        // data, and therefore never enter the persisted node properties.
        format: INTEGRATION_CONNECTION_FORMAT,
        provider: 'microsoft',
        capability: 'mail.send',
      },
    },
    {
      type: 'VariableText',
      scope: microsoftSendEmailScope('properties.to'),
      label: 'נמען',
      placeholder: 'name@example.com',
    },
    {
      type: 'VariableText',
      scope: microsoftSendEmailScope('properties.subject'),
      label: 'נושא',
    },
    {
      type: 'VariableTextArea',
      scope: microsoftSendEmailScope('properties.body'),
      label: 'תוכן ההודעה',
      placeholder: 'הקלידו {{ כדי לשלב ערך מצעד קודם',
      minRows: 5,
    },
    {
      type: 'Accordion',
      label: 'נמענים נוספים',
      elements: [
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.cc'),
          label: 'עותק',
          placeholder: 'כמה כתובות — הפרידו בפסיק או בנקודה-פסיק',
        },
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.bcc'),
          label: 'עותק מוסתר',
          placeholder: 'כמה כתובות — הפרידו בפסיק או בנקודה-פסיק',
        },
        {
          type: 'VariableText',
          scope: microsoftSendEmailScope('properties.replyTo'),
          label: 'כתובת לתשובה',
          placeholder: 'reply@example.com',
        },
        {
          // The one thing an owner cannot discover from the fields themselves.
          type: 'Label',
          text: 'בשדה "אל" ניתן לרשום כתובת אחת בלבד. שלושת השדות כאן מקבלים כמה כתובות.',
        },
      ],
    },
    {
      type: 'Accordion',
      label: 'אפשרויות מתקדמות',
      elements: [
        {
          type: 'Select',
          scope: microsoftSendEmailScope('properties.contentType'),
          label: 'סוג התוכן',
        },
        {
          type: 'Select',
          scope: microsoftSendEmailScope('properties.importance'),
          label: 'חשיבות',
        },
        {
          type: 'Switch',
          scope: microsoftSendEmailScope('properties.saveToSentItems'),
          label: 'שמירת עותק בתיבת "נשלחו"',
        },
      ],
    },
    { type: 'Select', scope: microsoftSendEmailScope('properties.errorPolicy'), label: 'אם השליחה נכשלת' },
    statusControl(microsoftSendEmailScope('properties.status')),
  ],
};
