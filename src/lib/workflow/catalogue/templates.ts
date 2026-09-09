'use client';

// Starter diagrams for the editor's template selector.
//
// CLIENT ONLY, for the same reason as ./schemas.ts: `TemplateModel` is a type,
// but this module sits beside the palette and is imported only by the editor.
//
// WHY THE `type` FIELD IS SPELLED OUT ON EVERY NODE
//
// A node dropped from the palette gets its React Flow type computed:
// `jb(paletteType, templateType, customTemplates)` runs inside the SDK's
// add-node handler and resolves `templateType` to 'start-node' /
// 'decision-node' / 'node'. A node loaded from a TEMPLATE takes a different
// path — `setDiagramModel` maps the nodes through `ja` (which only annotates
// validation errors) and `v1`, then writes them to the store as they are. It
// never calls `jb`. Verified against dist/index-CEBfv0NZ.js at 2.3.0.
//
// So a template that left `type: 'node'` on the condition would load a node
// with the DEFAULT body: one bare `source` handle, no branch rows, and the two
// edges below pointing at handles that are not on it. The template has to carry
// what the palette would have computed.
//
// WHY BOTH BRANCHES ARE WIRED
//
// Not tidiness. `propagate` in the vendored runner returns a dead end whenever
// a node names a port and no outgoing edge carries it, and a dead end ends the
// run `execution_incomplete`. Our condition ALWAYS names one of its two ports,
// so a diagram with only the "yes" branch drawn reports incomplete on every
// message that says no — while having done exactly what the owner intended.
// The first thing an owner sees should not teach that shape.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { CONDITION_BRANCH_HANDLES } from './types';

const TRIGGER_ID = 'tmpl-rsvp-trigger';
const CONDITION_ID = 'tmpl-rsvp-condition';
const ATTENDING_ID = 'tmpl-rsvp-attending';
const DECLINED_ID = 'tmpl-rsvp-declined';

// `sourceHandle` on a plain node's only output. The SDK spells the outer
// handles with the bare type name; `getHandleId({ handleType: 'source' })`
// returns exactly this string.
const SOURCE = 'source';
const TARGET = 'target';

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

/**
 * Built at MODULE SCOPE, the same requirement as `PALETTE_ITEMS`: upstream
 * documents `diagramTemplates` as needing a stable reference, and a fresh array
 * each render would remount the selector.
 */
export const DIAGRAM_TEMPLATES: TemplateModel[] = [
  {
    id: 1,
    name: 'אישור הגעה לפי תשובת האורח',
    value: rsvpByKeyword,
    icon: 'TreeStructure',
  },
  {
    id: 2,
    name: 'אישור הגעה עם תשובה לאורח',
    value: rsvpWithReply,
    icon: 'WhatsappLogo',
  },
];
