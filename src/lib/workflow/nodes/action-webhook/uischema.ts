'use client';

// `action.webhook` — the layout of its properties panel. Editor side.
import { getScope } from '@workflowbuilder/sdk';
import type { UISchema } from '@workflowbuilder/sdk';

import { identityControls, statusControl } from '../../catalogue/editor-shared';
import { HEADER_ROWS_FORMAT } from '../../catalogue/ui-formats';

import { HTTP_METHODS_WITH_BODY } from './definition';
import type { WebhookSchema } from './schema';

const webhookScope = getScope<WebhookSchema>;

export const webhookUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(webhookScope('properties.label'), webhookScope('properties.description')),
    { type: 'Select', scope: webhookScope('properties.method'), label: 'סוג הבקשה' },
    {
      // Plain Text, not VariableText: the DESTINATION must not be assembled from
      // guest data. A URL built at run time is a URL nobody reviewed, and the
      // https/private-space check would then be passing judgement on a string
      // that did not exist when the owner saved the diagram.
      type: 'Text',
      scope: webhookScope('properties.url'),
      label: 'כתובת היעד (https בלבד)',
      placeholder: 'https://example.com/hooks/kalfa',
    },
    {
      type: 'VariableTextArea',
      scope: webhookScope('properties.body'),
      label: 'גוף הבקשה',
      placeholder: '{"name":"{{trigger.guest_name}}","text":"{{trigger.message_text}}"}',
      minRows: 3,
      // ⚠️ THE RUNTIME ALREADY DROPS IT, SILENTLY. `sendOutboundWebhook` attaches
      // the body only when the verb is in `HTTP_METHODS_WITH_BODY`; on GET or
      // DELETE it is built, resolved, secret-checked — and then not sent. So the
      // panel offered a three-row editor for a field that went nowhere, with no
      // error and no run-log entry to learn from.
      //
      // ⚠️ SHOW ON THE WITH-BODY LIST, NOT HIDE ON ITS COMPLEMENT, and the two
      // are not equivalent here. `enum` is derived from the SAME constant
      // `outbound-webhook.ts` branches on, so a verb added to one side is
      // automatically handled on the other; a hand-written `['GET','DELETE']`
      // would go stale the first time a verb is added to `HTTP_METHODS`.
      //
      // ⚠️ AND NO `failWhenUndefined`, deliberately. A diagram saved before
      // `method` existed carries no value, `readMethod` falls back to
      // `DEFAULT_HTTP_METHOD` — 'POST', which IS in the with-body list — so that
      // diagram really does send its body and the box must stay visible.
      // Failing on undefined would hide a field that is in use.
      rule: {
        effect: 'SHOW',
        condition: {
          scope: webhookScope('properties.method'),
          schema: { enum: [...HTTP_METHODS_WITH_BODY] },
        },
      },
    },
    // ⚠️ THIS COMMENT USED TO BE WRONG TWICE, and both halves are worth keeping
    // as a record. It said "collapsed by default" — the renderer opens it, see
    // the trigger's message-kinds accordion for the measurement — and it said
    // the alternative was "an always-open list of empty rows to scroll past",
    // when `defaultPropertiesData` sets `headers: []` with its own comment
    // saying no empty row is seeded. The stated harm could not occur.
    //
    // The container survives its own justification: headers and secrets are a
    // genuinely advanced concern that most calls never touch, which is the case
    // an Accordion is for. It groups and it folds; it does not hide.
    {
      type: 'Accordion',
      label: 'כותרות ואימות',
      elements: [
        {
          // A CUSTOM RENDERER, and the SDK has no built-in that could do this.
          //
          // `UISchemaControlElement` is a closed union — Text, Switch, Select,
          // DatePicker, TextArea, DynamicConditions, AiTools, DecisionBranches,
          // VariableText, VariableTextArea, MessageOnError — and not one of them
          // edits an arbitrary array of objects. So the element is declared as
          // the nearest allowed type and OUTRANKED by our own renderer, which is
          // the mechanism upstream documents on `rankWith` itself: "rank above
          // the built-ins to override a control".
          //
          // The match is on `options.format`, not on the scope: a scope-based
          // tester would silently capture any future field that happened to end
          // in the same word, while this says out loud which control is wanted.
          // See header-rows-control.tsx.
          type: 'Text',
          scope: webhookScope('properties.headers'),
          label: 'כותרות HTTP',
          options: { format: HEADER_ROWS_FORMAT },
        },
        {
          // The instruction that makes the whole secrets design usable. Without
          // it an owner types the key itself, which is exactly what this node
          // spent a release refusing to allow.
          type: 'Label',
          text: 'לעולם אל תקלידו מפתח API כאן. כתבו {{secrets.SHEM_HASOD}} — הערך עצמו נשמר בשרת ואינו נשמר בתרשים, אינו מוצג בדפדפן ואינו נרשם ביומן ההרצה.',
        },
      ],
    },
    {
      type: 'Switch',
      scope: webhookScope('properties.captureResponse'),
      label: 'שמירת התשובה לשימוש בצעדים הבאים',
    },
    {
      type: 'Select',
      scope: webhookScope('properties.errorPolicy'),
      label: 'אם הצעד נכשל',
    },
    {
      // Same warning the other action nodes carry: 'continue' does not retry and
      // does not recover. The external system simply never heard from us, and
      // only the run's own verdict changes.
      type: 'Label',
      text: 'המשך ללא עצירה: הפנייה לא תישלח שוב, והמערכת החיצונית פשוט לא תקבל אותה.',
    },
    statusControl(webhookScope('properties.status')),
  ],
};
