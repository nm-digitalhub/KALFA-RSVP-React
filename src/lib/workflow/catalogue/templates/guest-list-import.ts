'use client';

// Starter template 5 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { ACTION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

// ---------------------------------------------------------------------------
// Guest import from WhatsApp — the flow that used to be hard-coded
// ---------------------------------------------------------------------------

const IMPORT_TRIGGER_ID = 'tmpl-import-trigger';
const IMPORT_STAGE_ID = 'tmpl-import-stage';
const IMPORT_ALERT_ID = 'tmpl-import-alert';
const IMPORT_FAILED_ID = 'tmpl-import-failed';

/**
 * An owner sends a guest list; it is staged for review and the team is told.
 *
 * ⚠️ WHAT IS DIFFERENT ABOUT THIS TEMPLATE. Every other one starts from a guest
 * answering. This starts from the OWNER sending us something — a CSV or a batch
 * of contact cards — which no workflow could see at all until `messageKinds`
 * existed: those messages are not billable, and the billing classifier was the
 * automation gate.
 *
 * THE TRIGGER MUST TICK THE TWO KINDS, and that is why `messageKinds` is spelled
 * out here rather than left to the default. A template that shipped with the
 * default would load, look right, and never fire once.
 *
 * NO GUEST NODES ANYWHERE IN IT, and none would work: the sender is the owner,
 * so the run carries no contact and `update_guest_status`, `send_whatsapp`,
 * `set_guest_field` and the rest all refuse inside it by design. `notify_team`
 * and `webhook` are the actions available here.
 *
 * IT DOES NOT REPLACE THE HARD-CODED IMPORT — both run, and they share one
 * idempotency key, so whichever stages first wins and the other reports
 * `created: false` with the same review link. The owner still gets the reply
 * they always got.
 */
const guestListImport: DiagramModel = {
  name: 'קליטת רשימת אורחים מוואטסאפ',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: IMPORT_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'הגיעה רשימת אורחים',
            description: 'קובץ או כרטיסי אנשי קשר שנשלחו בוואטסאפ',
            keyword: '',
            phoneNumberId: '',
            // THE FIELD THAT MAKES THIS TEMPLATE WORK AT ALL. Without it the
            // trigger falls back to the guest-message kinds and a file never
            // starts the flow.
            messageKinds: [{ value: 'document' }, { value: 'contacts' }],
          },
        },
      },
      {
        id: IMPORT_STAGE_ID,
        type: 'decision-node',
        position: { x: 380, y: 140 },
        data: {
          segments: [],
          type: 'action.import_guest_list',
          icon: 'UsersThree',
          properties: {
            label: 'קליטת הרשימה לסקירה',
            description: 'מעלה את השורות למסך האישור — לא מוסיף אורחים',
            errorPolicy: 'errorRoute',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'נקלט' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
      {
        id: IMPORT_ALERT_ID,
        type: 'node',
        position: { x: 780, y: 40 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'עדכון הצוות',
            description: 'כמה שורות נקלטו ולאן ללכת כדי לאשר',
            level: 'info',
            title: 'רשימת אורחים חדשה ממתינה לאישור',
            // The counts and the link come from the node above. `?` on the file
            // name because contact cards have none — a strict reference would
            // fail the whole alert on the commonest case.
            detail:
              'נקלטו {{nodes.tmpl-import-stage.rowCount}} שורות ({{nodes.tmpl-import-stage.errorCount}} עם שגיאות). קובץ: {{nodes.tmpl-import-stage.fileName?}}\nלאישור: {{nodes.tmpl-import-stage.reviewUrl}}',
          },
        },
      },
      {
        id: IMPORT_FAILED_ID,
        type: 'node',
        position: { x: 780, y: 260 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'WarningCircle',
          properties: {
            label: 'התראה על כישלון',
            description: 'הקובץ לא נקרא או לא נקלט',
            level: 'warn',
            title: 'רשימת אורחים לא נקלטה',
            detail: 'סיבה: {{nodes.tmpl-import-stage.reason?}} {{nodes.tmpl-import-stage.message?}}',
          },
        },
      },
    ],
    edges: [
      {
        id: `${IMPORT_TRIGGER_ID}->${IMPORT_STAGE_ID}`,
        source: IMPORT_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: IMPORT_STAGE_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      // BOTH branches wired. A node that names a port no edge carries is a dead
      // end, and a dead end ends the run `execution_incomplete` — so a template
      // with only the happy path would report incomplete on every bad file.
      {
        id: `${IMPORT_STAGE_ID}->${IMPORT_ALERT_ID}`,
        source: IMPORT_STAGE_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.ok,
        target: IMPORT_ALERT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'נקלט' },
      },
      {
        id: `${IMPORT_STAGE_ID}->${IMPORT_FAILED_ID}`,
        source: IMPORT_STAGE_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.error,
        target: IMPORT_FAILED_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'נכשל' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const guestListImportTemplate: TemplateModel = {
  id: 5,
  name: 'קליטת רשימת אורחים מוואטסאפ',
  value: guestListImport,
  icon: 'UsersThree',
};
