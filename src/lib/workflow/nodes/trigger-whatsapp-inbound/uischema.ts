'use client';

// `trigger.whatsapp_inbound` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl, triggerSwitchElement } from '../../catalogue/editor-shared';
import { CHECKBOX_LIST_FORMAT } from '../../catalogue/ui-formats';

import { WHATSAPP_MESSAGE_KINDS } from './definition';
import type { WhatsappInboundSchema } from './schema';

const whatsappInboundScope = getScope<WhatsappInboundSchema>;

// "מה מפעיל את התהליך" — `triggerSwitchElement`, the switcher every trigger's
// uischema starts with, lives in `editor-shared.ts` so every trigger's node
// folder can spread it.
export const whatsappInboundUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(
      whatsappInboundScope('properties.label'),
      whatsappInboundScope('properties.description'),
    ),
    {
      type: 'Select',
      scope: whatsappInboundScope('properties.phoneNumberId'),
      label: 'המספר שאליו נשלחה ההודעה',
    },
    {
      // The warning the owner asked for. "כל המספרים" is the compatible default,
      // not the safe one: with two live lines an RSVP automation also fires on
      // messages sent to the import line.
      type: 'Label',
      text: 'כל המספרים: התהליך ירוץ גם על הודעות שנשלחו לקו הייבוא. בחרו מספר כדי לצמצם.',
    },
    {
      type: 'Text',
      scope: whatsappInboundScope('properties.keyword'),
      label: 'הפעל רק אם ההודעה מכילה',
    },
    {
      // ⚠️ AN ACCORDION IS COLLAPSIB-LE, NOT COLLAPSED — measured in the 2.3.0
      // bundle, and this comment used to claim the opposite. The renderer
      // (`GH`) passes the layout NOTHING but `label` and `children`; the
      // container (`Ag`) declares `defaultOpen = true` and is the only thing
      // that decides. `AccordionLayoutElement` has no `defaultOpen` field, so
      // the uischema cannot ask for closed — writing one here would be a silent
      // no-op, which `accordion-classification.test.ts` refuses.
      //
      // The container is still right: nine checkboxes are an ADVANCED filter
      // that the default already answers for almost every workflow, and the
      // owner can fold them away after reading them once. What it does not do
      // is spare them the first read.
      type: 'Accordion',
      label: 'סוגי הודעות שמפעילים את התהליך',
      elements: [
        {
          // A CUSTOM RENDERER — the SDK ships no multi-select. Declared as the
          // nearest allowed element type and outranked by ours, matched on
          // `options.format`. See checkbox-list-control.tsx.
          type: 'Text',
          scope: whatsappInboundScope('properties.messageKinds'),
          label: 'סוגי הודעות',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: WHATSAPP_MESSAGE_KINDS.map((k) => ({ ...k })),
            defaultNote:
              'ברירת מחדל: רק הודעות שאורח שולח — טקסט, כפתור, תפריט ותגובה. סמנו קובץ או אנשי קשר כדי לבנות תהליך שקולט רשימת אורחים.',
          },
        },
      ],
    },
    statusControl(whatsappInboundScope('properties.status')),
  ],
};
