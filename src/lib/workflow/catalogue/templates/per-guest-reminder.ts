'use client';

// Starter template 8 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { SOURCE, TARGET } from './shared';

const PERGUEST_TRIGGER_ID = 'tmpl-perguest-trigger';
const PERGUEST_SEND_ID = 'tmpl-perguest-send';

/**
 * The CHILD of a fan-out: one guest, one reminder.
 *
 * ⚠️ IT IS STARTED BY ANOTHER WORKFLOW, NOT BY ITS OWN TRIGGER, and that shapes
 * everything about it.
 *
 * Its trigger is a webhook whose token hash is left EMPTY. That is not an
 * oversight:
 * every graph must declare exactly one start node (rule 1 of the conversion
 * contract), so a workflow needs a trigger even when nothing fires it — and an
 * empty hash means the public endpoint cannot reach it either. A WhatsApp
 * trigger here would have been worse: armed, it would fire on every inbound
 * message as well as on the fan-out.
 *
 * It also must NOT be armed. Arming is about a workflow's own trigger; a
 * fan-out starts it regardless, which is why `startRunsForGuests` does not
 * require it.
 *
 * One of the clock / wait / fan-out trio; why all three send an approved
 * template rather than free text is noted once, in `./weekly-pending-sweep.ts`.
 */
const perGuestReminder: DiagramModel = {
  name: 'תזכורת לאורח אחד (תהליך-בן)',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: PERGUEST_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.webhook',
          icon: 'Plugs',
          properties: {
            label: 'מופעל מתהליך אחר',
            description: 'לא להפעיל — תהליך-בן של "תזכורת שבועית למי שטרם ענה"',
            // EMPTY: no public endpoint, and a workflow cannot be armed without
            // a generated token. Both are the intent. The field holds the HASH
            // of a token (see webhook-token.ts) — blank means none was ever
            // generated, which is what makes the address unreachable.
            tokenHash: '',
          },
        },
      },
      {
        id: PERGUEST_SEND_ID,
        type: 'node',
        position: { x: 380, y: 140 },
        data: {
          segments: [],
          type: 'action.send_template',
          icon: 'ChatCircleText',
          properties: {
            label: 'שליחת תבנית תזכורת',
            // ⚠️ A UTILITY TEMPLATE, AND THAT IS A CHOICE. `thankyou` is
            // MARKETING: it routes through MM Lite, and on a non-brit event it
            // resolves to nothing — which this node reports as a COMPLETED step
            // with `template_not_available`, so the run says "completed" and the
            // guest gets nothing. A reminder has neither problem.
            description: 'תבנית מאושרת — אפשרית גם ימים אחרי שהאורח כתב',
            messageKey: 'reminder_1',
          },
        },
      },
    ],
    edges: [
      {
        id: `${PERGUEST_TRIGGER_ID}->${PERGUEST_SEND_ID}`,
        source: PERGUEST_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: PERGUEST_SEND_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const perGuestReminderTemplate: TemplateModel = {
  id: 8,
  name: 'תזכורת לאורח אחד (תהליך-בן)',
  value: perGuestReminder,
  icon: 'ChatCircleText',
};
