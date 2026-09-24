'use client';

// Starter template 6 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { SOURCE, TARGET } from './shared';

const NUDGE_TRIGGER_ID = 'tmpl-nudge-trigger';
const NUDGE_WAIT_ID = 'tmpl-nudge-wait';
const NUDGE_SEND_ID = 'tmpl-nudge-send';

/**
 * A guest asks for time; two days later they get one reminder.
 *
 * THE SMALLEST HONEST USE OF `logic.wait`, and the one worth shipping first
 * because it is verifiable in minutes: shorten the wait, send the keyword, watch
 * the run sit at "ממתינה" and then finish.
 *
 * ⚠️ THE REMINDER IS A TEMPLATE, NOT FREE TEXT. Two days after the guest wrote,
 * the 24-hour window that made a free-text reply legal has closed. This is the
 * distinction the two send nodes exist for, and the template is the half that
 * still works.
 *
 * ⚠️ AND EDITING THIS FLOW WHILE A RUN IS PARKED CHANGES THAT RUN. Steps that
 * already finished are replayed from the ledger and never re-run, but a node
 * ADDED before the wait will execute on resume — a known limitation recorded in
 * the engine plan, pending a second migration.
 *
 * One of the clock / wait / fan-out trio; the note on the trio is in
 * `./weekly-pending-sweep.ts`.
 */
const delayedNudge: DiagramModel = {
  name: 'תזכורת יומיים אחרי "אחזור אליכם"',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: NUDGE_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'האורח ביקש זמן',
            description: 'מופעל כשההודעה מכילה את מילת ההפעלה',
            keyword: 'אחזור',
            phoneNumberId: '',
          },
        },
      },
      {
        id: NUDGE_WAIT_ID,
        type: 'node',
        position: { x: 380, y: 140 },
        data: {
          segments: [],
          type: 'logic.wait',
          icon: 'Hourglass',
          properties: {
            label: 'המתנה יומיים',
            description: 'ההרצה נעצרת כאן וחוזרת מעצמה',
            amount: 2,
            unit: 'days',
          },
        },
      },
      {
        id: NUDGE_SEND_ID,
        type: 'node',
        position: { x: 760, y: 140 },
        data: {
          segments: [],
          type: 'action.send_template',
          icon: 'ChatCircleText',
          properties: {
            label: 'תזכורת',
            description: 'תבנית — חלון 24 השעות כבר נסגר',
            messageKey: 'reminder_1',
          },
        },
      },
    ],
    edges: [
      {
        id: `${NUDGE_TRIGGER_ID}->${NUDGE_WAIT_ID}`,
        source: NUDGE_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: NUDGE_WAIT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: `${NUDGE_WAIT_ID}->${NUDGE_SEND_ID}`,
        source: NUDGE_WAIT_ID,
        sourceHandle: SOURCE,
        target: NUDGE_SEND_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const delayedNudgeTemplate: TemplateModel = {
  id: 6,
  name: 'תזכורת יומיים אחרי "אחזור אליכם"',
  value: delayedNudge,
  icon: 'Hourglass',
};
