'use client';

// Starter template 2 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { CONDITION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

// ---------------------------------------------------------------------------
// Template 2 — the same branch, but the guest hears back
// ---------------------------------------------------------------------------

// The first template ends silently: the guest writes "כן", a row changes, and
// nothing reaches them. This one chains a reply onto each branch, which is the
// shape every real RSVP conversation has.
//
// The reply is a FREE-TEXT session message and that is only legal inside the
// 24-hour window a guest opens by writing in. Here the guest wrote moments ago —
// the run exists because they did — so the window is open by construction. The
// same diagram behind a scheduled trigger would not be legal, which is the
// reason `action.send_whatsapp` documents the rule on the handler rather than
// here.
const rsvpWithReply: DiagramModel = {
  name: 'אישור הגעה עם תשובה לאורח',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: 'tmpl2-trigger',
        type: 'start-node',
        position: { x: 0, y: 160 },
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
        id: 'tmpl2-condition',
        type: 'decision-node',
        position: { x: 360, y: 160 },
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
        id: 'tmpl2-attending',
        type: 'node',
        position: { x: 740, y: 40 },
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
        id: 'tmpl2-declined',
        type: 'node',
        position: { x: 740, y: 300 },
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
      {
        id: 'tmpl2-reply-yes',
        type: 'node',
        position: { x: 1120, y: 40 },
        data: {
          segments: [],
          type: 'action.send_whatsapp',
          icon: 'WhatsappLogo',
          properties: {
            label: 'אישור לאורח',
            description: 'משיב לאורח ששלח את ההודעה',
            body: 'תודה! רשמנו שאתם מגיעים 🎉 נתראה!',
            // 'continue': the status is already written by the time this runs,
            // and a WhatsApp hiccup must not paint that successful run as
            // failed. The failure still appears in the log as a skipped step.
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: 'tmpl2-reply-no',
        type: 'node',
        position: { x: 1120, y: 300 },
        data: {
          segments: [],
          type: 'action.send_whatsapp',
          icon: 'WhatsappLogo',
          properties: {
            label: 'תודה על העדכון',
            description: 'משיב לאורח ששלח את ההודעה',
            body: 'תודה שעדכנתם אותנו. נשמח לראותכם בשמחה הבאה 🙏',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: 'tmpl2-e1',
        source: 'tmpl2-trigger',
        sourceHandle: SOURCE,
        target: 'tmpl2-condition',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'tmpl2-e2',
        source: 'tmpl2-condition',
        sourceHandle: CONDITION_BRANCH_HANDLES.true,
        target: 'tmpl2-attending',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'כן' },
      },
      {
        id: 'tmpl2-e3',
        source: 'tmpl2-condition',
        sourceHandle: CONDITION_BRANCH_HANDLES.false,
        target: 'tmpl2-declined',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'לא' },
      },
      {
        id: 'tmpl2-e4',
        source: 'tmpl2-attending',
        sourceHandle: SOURCE,
        target: 'tmpl2-reply-yes',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'tmpl2-e5',
        source: 'tmpl2-declined',
        sourceHandle: SOURCE,
        target: 'tmpl2-reply-no',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const rsvpWithReplyTemplate: TemplateModel = {
  id: 2,
  name: 'אישור הגעה עם תשובה לאורח',
  value: rsvpWithReply,
  icon: 'WhatsappLogo',
};
