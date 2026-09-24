'use client';

// Starter template 1 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { CONDITION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

const TRIGGER_ID = 'tmpl-rsvp-trigger';
const CONDITION_ID = 'tmpl-rsvp-condition';
const ATTENDING_ID = 'tmpl-rsvp-attending';
const DECLINED_ID = 'tmpl-rsvp-declined';

const rsvpByKeyword: DiagramModel = {
  name: 'אישור הגעה לפי תשובת האורח',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'הודעת וואטסאפ נכנסת',
            description: 'מתחיל את התהליך כשאורח שולח הודעה',
            keyword: '',
          },
        },
      },
      {
        id: CONDITION_ID,
        type: 'decision-node',
        position: { x: 380, y: 140 },
        data: {
          segments: [],
          type: 'logic.condition',
          icon: 'GitBranch',
          properties: {
            label: 'האם ההודעה מאשרת הגעה?',
            description: 'מחפש את המילה "כן" בגוף ההודעה',
            field: 'message_text',
            operator: 'contains',
            value: 'כן',
            decisionBranches: [
              { id: 'true', sourceHandle: CONDITION_BRANCH_HANDLES.true, label: 'מתקיים' },
              { id: 'false', sourceHandle: CONDITION_BRANCH_HANDLES.false, label: 'לא מתקיים' },
            ],
          },
        },
      },
      {
        id: ATTENDING_ID,
        type: 'node',
        position: { x: 780, y: 40 },
        data: {
          segments: [],
          type: 'action.update_guest_status',
          icon: 'UserCheck',
          properties: {
            label: 'סמן כמגיע/ה',
            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
            rsvpStatus: 'attending',
            errorPolicy: 'fail',
          },
        },
      },
      {
        id: DECLINED_ID,
        type: 'node',
        position: { x: 780, y: 260 },
        data: {
          segments: [],
          type: 'action.update_guest_status',
          icon: 'UserCheck',
          properties: {
            label: 'סמן כלא מגיע/ה',
            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
            rsvpStatus: 'declined',
            errorPolicy: 'fail',
          },
        },
      },
    ],
    edges: [
      {
        id: `${TRIGGER_ID}->${CONDITION_ID}`,
        source: TRIGGER_ID,
        sourceHandle: SOURCE,
        target: CONDITION_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: `${CONDITION_ID}->${ATTENDING_ID}`,
        source: CONDITION_ID,
        sourceHandle: CONDITION_BRANCH_HANDLES.true,
        target: ATTENDING_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'כן' },
      },
      {
        id: `${CONDITION_ID}->${DECLINED_ID}`,
        source: CONDITION_ID,
        sourceHandle: CONDITION_BRANCH_HANDLES.false,
        target: DECLINED_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'לא' },
      },
    ],
    // `setDiagramModel` writes nodes and edges but never touches the viewport,
    // so this is only what a consumer reading the model would expect to find;
    // the canvas fits itself on load.
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const rsvpByKeywordTemplate: TemplateModel = {
  id: 1,
  name: 'אישור הגעה לפי תשובת האורח',
  value: rsvpByKeyword,
  icon: 'TreeStructure',
};
