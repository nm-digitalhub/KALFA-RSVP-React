'use client';

// Starter template 11 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { ACTION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

const RECEIPT_TRIGGER_ID = 'tmpl-receipt-trigger';
const RECEIPT_DOCUMENT_ID = 'tmpl-receipt-document';
const RECEIPT_ALERT_ID = 'tmpl-receipt-alert';

/**
 * Webhook → issue a receipt → alert the team if it failed.
 *
 * WHY THIS SHAPE AND NOT A ONE-NODE TEMPLATE. A document node has an error
 * branch (`ACTION_BRANCH_HANDLES`), and a template that drew only the success
 * edge would teach the shape that costs a run: `propagate` in the vendored
 * runner returns a dead end whenever a node names a port and no outgoing edge
 * carries it, so a rejected document would end the run `execution_incomplete`
 * with nobody told. Both branches are wired, for the same reason the RSVP
 * template wires both sides of its condition.
 *
 * The document is a DRAFT and its customer fields are blank — a template is a
 * valid draft the owner has not filled in yet (see arm-check.ts's own note), and
 * a starter that issued a FINAL document to a real customer on its first run
 * would be the worst possible default for a bookkeeping record.
 */
const sumitReceiptOnWebhook: DiagramModel = {
  name: 'הפקת קבלה לפי קריאת webhook',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: RECEIPT_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.webhook',
          icon: 'Plugs',
          properties: {
            label: 'קריאת webhook',
            description: 'מתחיל את התהליך כשמערכת חיצונית קוראת לכתובת',
            // Both blank: a template is a draft, and the address is minted in the
            // editor together with the secret. arm-check refuses until then.
            endpointId: '',
            tokenHash: '',
          },
        },
      },
      {
        id: RECEIPT_DOCUMENT_ID,
        type: 'decision-node',
        position: { x: 400, y: 140 },
        data: {
          segments: [],
          type: 'action.sumit_create_document',
          icon: 'FileText',
          properties: {
            label: 'הפקת קבלה',
            description: 'מפיק קבלה ב-SUMIT. לא מבצע חיוב.',
            documentType: 'Receipt',
            // Blank on purpose — the owner fills it, usually with a {{…}}
            // reference to the trigger payload.
            customerName: '',
            customerEmail: '',
            isDraft: true,
            sendByEmail: false,
            errorPolicy: 'errorRoute',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
      {
        id: RECEIPT_ALERT_ID,
        type: 'node',
        position: { x: 820, y: 260 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'התראה לצוות',
            description: 'מודיע שהפקת הקבלה נכשלה',
            title: 'הפקת קבלה ב-SUMIT נכשלה',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: 'tmpl-receipt-e1',
        source: RECEIPT_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: RECEIPT_DOCUMENT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'tmpl-receipt-e2',
        source: RECEIPT_DOCUMENT_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.error,
        target: RECEIPT_ALERT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'נכשל' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const sumitReceiptOnWebhookTemplate: TemplateModel = {
  id: 11,
  name: 'הפקת קבלה לפי קריאת webhook',
  value: sumitReceiptOnWebhook,
  icon: 'FileText',
};
