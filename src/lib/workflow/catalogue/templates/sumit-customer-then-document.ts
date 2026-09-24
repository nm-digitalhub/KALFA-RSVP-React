'use client';

// Starter template 12 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { ACTION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

const CUSTDOC_TRIGGER_ID = 'tmpl-custdoc-trigger';
const CUSTDOC_CUSTOMER_ID = 'tmpl-custdoc-customer';
const CUSTDOC_DOCUMENT_ID = 'tmpl-custdoc-document';

/**
 * Create the customer, then issue the document TO THAT CUSTOMER.
 *
 * WHAT THIS TEMPLATE IS FOR, and why it is not the same starter as the receipt
 * one: it is the only place the editor shows an owner that a node's OUTPUT is
 * addressable. The document's customer field holds
 * `{{nodes.<customer node id>.customerId}}` — `customerId` is on the create-customer
 * node's `outputSchema`, so the variable picker offers it by name, and
 * `resolveConfigTemplates` substitutes it before the document handler runs.
 *
 * Nothing in the two nodes had to be written for this to work: the resolver
 * serves "node types nobody has written yet" (activity-runner). A starter that
 * only ever wired trigger → action would leave that capability invisible.
 *
 * ⚠️ THE REFERENCE IS TO A NODE ID, so it survives import: the id travels with
 * the diagram. That is the reason the customer is chained by its SUMIT id
 * rather than by re-typing the same name into both nodes — two copies of a name
 * drift, and the second document would then be issued to a customer that is not
 * the one just created.
 */
const sumitCustomerThenDocument: DiagramModel = {
  name: 'יצירת לקוח והפקת מסמך עבורו',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: CUSTDOC_TRIGGER_ID,
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
        id: CUSTDOC_CUSTOMER_ID,
        type: 'decision-node',
        position: { x: 400, y: 140 },
        data: {
          segments: [],
          type: 'action.sumit_create_customer',
          icon: 'UserPlus',
          properties: {
            label: 'יצירת לקוח',
            description: 'יוצר כרטיס לקוח ב-SUMIT ומחזיר את מזהה הלקוח',
            customerName: '',
            customerEmail: '',
            errorPolicy: 'fail',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
      {
        id: CUSTDOC_DOCUMENT_ID,
        type: 'decision-node',
        position: { x: 820, y: 140 },
        data: {
          segments: [],
          type: 'action.sumit_create_document',
          icon: 'FileText',
          properties: {
            label: 'הפקת מסמך ללקוח',
            description: 'מפיק את המסמך עבור הלקוח שנוצר בצעד הקודם',
            documentType: 'Receipt',
            // The chain itself. The name stays blank — SUMIT resolves the
            // customer from the id, and typing a name here as well would let
            // the two drift apart.
            customerName: '',
            customerExternalId: `{{nodes.${CUSTDOC_CUSTOMER_ID}.customerId}}`,
            isDraft: true,
            sendByEmail: false,
            errorPolicy: 'fail',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
    ],
    edges: [
      {
        id: 'tmpl-custdoc-e1',
        source: CUSTDOC_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: CUSTDOC_CUSTOMER_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'tmpl-custdoc-e2',
        source: CUSTDOC_CUSTOMER_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.ok,
        target: CUSTDOC_DOCUMENT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'הצליח' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const sumitCustomerThenDocumentTemplate: TemplateModel = {
  id: 12,
  name: 'יצירת לקוח והפקת מסמך עבורו',
  value: sumitCustomerThenDocument,
  icon: 'UserPlus',
};
