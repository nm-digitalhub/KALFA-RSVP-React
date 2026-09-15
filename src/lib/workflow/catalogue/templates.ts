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

import {
  ACTION_BRANCH_HANDLES,
  CONDITION_BRANCH_HANDLES,
  switchBranchHandle,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
} from './types';

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

// ---------------------------------------------------------------------------
// Template 3 — guest-initiated RSVP voice callback
// ---------------------------------------------------------------------------

const rsvpAiVoiceCallback: DiagramModel = {
  name: 'בקשת שיחה עם סוכן RSVP קולי',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: 'voice-trigger',
        type: 'start-node',
        position: { x: 0, y: 120 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'בקשת שיחה נכנסת',
            description: 'מתחיל רק כשהודעת האורח מכילה את מילת ההפעלה',
            keyword: 'שיחה',
          },
        },
      },
      {
        id: 'voice-agent-call',
        type: 'decision-node',
        position: { x: 420, y: 120 },
        data: {
          segments: [],
          type: 'action.start_rsvp_ai_callback',
          icon: 'PhoneCall',
          properties: {
            label: 'הפעלת סוכן RSVP קולי',
            description: 'מפעיל שיחה חוזרת דרך Voximplant אל סוכן ה-RSVP הקיים ב-ElevenLabs',
            status: 'active',
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
        id: 'voice-e1',
        source: 'voice-trigger',
        sourceHandle: SOURCE,
        target: 'voice-agent-call',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};


// ---------------------------------------------------------------------------
// Template 4 — every answer has a route, including the one nobody planned for
// ---------------------------------------------------------------------------

// What the three templates above cannot express, and why this one exists.
//
// All of them branch on `logic.condition`, which names one of TWO ports and
// where both of them mean "the test". So "כן" is one route and everything else
// — "לא", "אולי", "מי זה?", a photo caption — is the other. A guest who answers
// "אולי" is recorded as DECLINED, which is worse than not answering: it is a
// wrong number in the headcount that nobody will question.
//
// `logic.switch` gives the unmatched answer its own port, so the shape on the
// canvas is the shape of the decision: three known answers and a default that
// goes to a human.
//
// IT ROUTES ON THE BUTTON PAYLOAD, NOT THE TEXT. A guest who taps a quick-reply
// button sends a payload — an exact, machine-chosen string — while the text body
// is a label that changes with the template's wording and language. Matching the
// payload is why the three cases are exact `equals` rather than the `contains`
// the keyword templates use. A guest who TYPES rather than taps has an empty
// payload and lands on the default, which is correct: free text is exactly the
// case a person should read.
const FULL_TRIGGER_ID = 'tmpl-full-trigger';
const FULL_SWITCH_ID = 'tmpl-full-switch';
const FULL_ATTENDING_ID = 'tmpl-full-attending';
const FULL_DECLINED_ID = 'tmpl-full-declined';
const FULL_MAYBE_ID = 'tmpl-full-maybe';
const FULL_UNKNOWN_ID = 'tmpl-full-unknown';
const FULL_REPLY_YES_ID = 'tmpl-full-reply-yes';
const FULL_REPLY_NO_ID = 'tmpl-full-reply-no';

const rsvpFullRouting: DiagramModel = {
  name: 'אישור הגעה — כל התשובות',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: FULL_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 260 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'הודעת וואטסאפ נכנסת',
            description: 'מתחיל את התהליך כשאורח שולח הודעה',
            keyword: '',
            // Left as "any number" on purpose. A STARTER must not pin itself to
            // one line: the id differs per account, and a template carrying a
            // stale one would silently never fire. The node's own dropdown is
            // where an owner narrows it.
            phoneNumberId: '',
          },
        },
      },
      {
        id: FULL_SWITCH_ID,
        type: 'decision-node',
        position: { x: 360, y: 260 },
        data: {
          segments: [],
          type: 'logic.switch',
          icon: 'ArrowsSplit',
          properties: {
            label: 'מה האורח ענה?',
            description: 'מנתב לפי הכפתור שנלחץ',
            // Kept as a note to the reader; the rows below each carry their
            // own `x`, which is what the handler evaluates.
            left: '{{trigger.button_payload}}',
            // ONE ROW PER BRANCH, in the SDK's `DynamicCondition` shape. The
            // `logicalOperator` is 'AND' on every row and inert on all but the
            // first — the control keeps one join per branch, not one per row —
            // and with a single row it decides nothing either way.
            //
            // Written as a template so an owner opening it sees what a filled-in
            // condition looks like, then edits the text instead of guessing the
            // shape from an empty card.
            decisionBranches: [
              {
                id: 'attending',
                sourceHandle: switchBranchHandle('attending'),
                label: 'מגיע/ה',
                conditions: [
                  {
                    x: '{{trigger.button_payload}}',
                    comparisonOperator: 'isEqual',
                    y: 'rsvp_attending',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'declined',
                sourceHandle: switchBranchHandle('declined'),
                label: 'לא מגיע/ה',
                conditions: [
                  {
                    x: '{{trigger.button_payload}}',
                    comparisonOperator: 'isEqual',
                    y: 'rsvp_declined',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'maybe',
                sourceHandle: switchBranchHandle('maybe'),
                label: 'אולי',
                conditions: [
                  {
                    x: '{{trigger.button_payload}}',
                    comparisonOperator: 'isEqual',
                    y: 'rsvp_maybe',
                    logicalOperator: 'AND',
                  },
                ],
              },
              // No conditions, and none wanted: the default is reached by
              // elimination.
              {
                id: SWITCH_DEFAULT_BRANCH_ID,
                sourceHandle: SWITCH_DEFAULT_HANDLE,
                label: 'תשובה חופשית',
                conditions: [],
              },
            ],
          },
        },
      },
      {
        id: FULL_ATTENDING_ID,
        type: 'node',
        position: { x: 760, y: 40 },
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
        id: FULL_REPLY_YES_ID,
        type: 'node',
        position: { x: 1120, y: 40 },
        data: {
          segments: [],
          type: 'action.send_whatsapp',
          icon: 'WhatsappLogo',
          properties: {
            label: 'אישור לאורח',
            description: 'משיב לאורח ששלח את ההודעה',
            // A session reply inside the 24-hour window the guest just opened by
            // writing in — legal by construction here, as template 2 documents.
            body: 'תודה {{trigger.guest_name | default:\'לך\'}}! רשמנו שאתם מגיעים ל{{trigger.event_name}} בתאריך {{trigger.event_date}}. נתראה!',
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: FULL_DECLINED_ID,
        type: 'node',
        position: { x: 760, y: 200 },
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
        id: FULL_REPLY_NO_ID,
        type: 'node',
        position: { x: 1120, y: 200 },
        data: {
          segments: [],
          type: 'action.send_whatsapp',
          icon: 'WhatsappLogo',
          properties: {
            label: 'תשובה לאורח',
            description: 'משיב לאורח ששלח את ההודעה',
            body: 'תודה שעדכנתם! רשמנו שלא תוכלו להגיע ל{{trigger.event_name}}. נשמח לראותכם בפעם הבאה.',
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: FULL_MAYBE_ID,
        type: 'node',
        position: { x: 760, y: 360 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'BellRinging',
          properties: {
            label: 'אולי — לבדיקה',
            description: 'שולח הודעה לערוץ הצוות',
            level: 'info',
            title: 'אורח ענה "אולי"',
            // NOT marked declined, and that is the whole point of the template:
            // guessing a status from an uncertain answer is a wrong headcount
            // nobody will question later.
            detail: '{{trigger.guest_name | default:\'אורח\'}} ב{{trigger.event_name}} טרם החליט. הסטטוס לא שונה.',
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: FULL_UNKNOWN_ID,
        type: 'node',
        position: { x: 760, y: 520 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'BellRinging',
          properties: {
            label: 'תשובה חופשית — לאדם',
            description: 'שולח הודעה לערוץ הצוות',
            level: 'warn',
            title: 'הודעה מאורח שלא זוהתה כתשובת RSVP',
            detail: '{{trigger.guest_name | default:\'אורח\'}} כתב: "{{trigger.message_text}}"',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: `${FULL_TRIGGER_ID}->${FULL_SWITCH_ID}`,
        source: FULL_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: FULL_SWITCH_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      // ALL FOUR branches wired. `propagate` returns a dead end when a node names
      // a port no edge carries, and a dead end ends the run `execution_incomplete`
      // — so a template with three of four drawn would teach the wrong shape by
      // reporting incomplete on the answer it forgot.
      {
        id: `${FULL_SWITCH_ID}->${FULL_ATTENDING_ID}`,
        source: FULL_SWITCH_ID,
        sourceHandle: switchBranchHandle('attending'),
        target: FULL_ATTENDING_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'מגיע/ה' },
      },
      {
        id: `${FULL_ATTENDING_ID}->${FULL_REPLY_YES_ID}`,
        source: FULL_ATTENDING_ID,
        sourceHandle: SOURCE,
        target: FULL_REPLY_YES_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: `${FULL_SWITCH_ID}->${FULL_DECLINED_ID}`,
        source: FULL_SWITCH_ID,
        sourceHandle: switchBranchHandle('declined'),
        target: FULL_DECLINED_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'לא מגיע/ה' },
      },
      {
        id: `${FULL_DECLINED_ID}->${FULL_REPLY_NO_ID}`,
        source: FULL_DECLINED_ID,
        sourceHandle: SOURCE,
        target: FULL_REPLY_NO_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: `${FULL_SWITCH_ID}->${FULL_MAYBE_ID}`,
        source: FULL_SWITCH_ID,
        sourceHandle: switchBranchHandle('maybe'),
        target: FULL_MAYBE_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'אולי' },
      },
      {
        id: `${FULL_SWITCH_ID}->${FULL_UNKNOWN_ID}`,
        source: FULL_SWITCH_ID,
        sourceHandle: SWITCH_DEFAULT_HANDLE,
        target: FULL_UNKNOWN_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'תשובה חופשית' },
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


// ---------------------------------------------------------------------------
// The clock, the wait, and the fan-out — the three capabilities added 13.9.2026
// ---------------------------------------------------------------------------
//
// Until now every template started from a guest speaking to us. These three do
// not, and they exist because a capability with no starting point is a capability
// nobody finds: `trigger.schedule`, `logic.wait`, `action.send_template` and
// `action.start_for_each_guest` appeared in ZERO templates the day after they
// shipped.
//
// ⚠️ WHY THEY ALL SEND A TEMPLATE RATHER THAN FREE TEXT. WhatsApp permits plain
// text only inside the 24-hour window a guest's own message opens. A flow started
// by a CLOCK has no such window — the guest has not written — so
// `action.send_whatsapp` would be refused by Meta for most recipients. An
// approved template may be sent at any time, which is what makes these flows
// deliverable at all.

const SWEEP_TRIGGER_ID = 'tmpl-sweep-trigger';
const SWEEP_FANOUT_ID = 'tmpl-sweep-fanout';
const SWEEP_ALERT_ID = 'tmpl-sweep-alert';
const SWEEP_FAILED_ID = 'tmpl-sweep-failed';

/**
 * Every Sunday at 10:00, nudge the guests who have not answered yet.
 *
 * THE FLOW THE WHOLE ENGINE PROJECT WAS FOR. It needs all three of the pieces
 * that did not exist yesterday: a clock to start it, a step that finds guests,
 * and a send that works outside the service window.
 *
 * ⚠️ WHY "WHO HAVE NOT ANSWERED" AND NOT "THANK EVERYONE WHO IS COMING" — the
 * single most important decision in this file.
 *
 * A scheduled fan-out RE-FIRES ON EVERY TICK. The child runs are deduped on
 * `fanout:${parentRunId}:${nodeId}:${contactId}`, and the parent run id is new
 * each time the clock fires, so nothing in the engine remembers that a guest was
 * already messaged yesterday. There is no "already sent" node, and no way to
 * express one with what exists today.
 *
 * So the template must be a flow where REPEATING IS THE CORRECT BEHAVIOUR and
 * the list empties itself. It is: a guest who answers stops being `pending` and
 * drops out of the filter on the next run. The reminder stops because the guest
 * responded — the stop condition is the product's own data, not a memory the
 * engine does not have.
 *
 * A thank-you has the opposite shape. "Everyone attending" does not shrink when
 * you thank them, so the same flow would thank the same guests every single
 * week, forever. That is why this is not the thank-you template — and KALFA
 * already sends thank-yous anyway, from `campaign-thankyou-sweep` in the worker.
 * A second path to the same message means a guest gets both.
 *
 * ⚠️ `days: [0]` IS SUNDAY, AND IT IS A CEILING, NOT A PREFERENCE. Empty means
 * every day, and a weekly nudge is the most anyone should send to someone who
 * has not replied. Widen it deliberately or not at all.
 *
 * ⚠️ IT SHIPS WITH `targetWorkflowId` EMPTY, on purpose. The fan-out starts
 * another workflow per guest, and only the owner knows which — pre-filling it
 * with a guess would either point at nothing or, worse, at the wrong flow. Paste
 * the child workflow's id into the node before using it.
 *
 * ⚠️ AND ARMING REFUSES UNTIL YOU DO. `setWorkflowActive` runs `findArmBlockers`
 * after the conversion contract, so pressing "arm" on this template answers
 * `הצעד "לכל אורח שטרם ענה": השדה "targetWorkflowId" ריק.` instead of flipping
 * the switch and failing silently on Sunday at 10:00.
 *
 * The template still LOADS and SAVES with the blank — that is the point of a
 * template — because the check lives at arming, not in the converter.
 *
 * `maxGuests: 10` is deliberately far below anyone's real guest list. A template
 * is a starting point someone presses "arm" on quickly, and the first press
 * should not reach three hundred people.
 */
const weeklyPendingSweep: DiagramModel = {
  name: 'תזכורת שבועית למי שטרם ענה',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: SWEEP_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.schedule',
          icon: 'Clock',
          properties: {
            label: 'כל יום ראשון ב-10:00',
            description: 'שעון ישראל, כולל מעברי שעון',
            time: '10:00',
            // Sunday. NOT empty — empty means every day, and this flow re-fires.
            days: [0],
          },
        },
      },
      {
        id: SWEEP_FANOUT_ID,
        type: 'decision-node',
        position: { x: 380, y: 140 },
        data: {
          segments: [],
          type: 'action.start_for_each_guest',
          icon: 'UsersThree',
          properties: {
            label: 'לכל אורח שטרם ענה',
            description: 'מתחיל תהליך נפרד לכל אחד — הדביקו את מזהה התהליך',
            // EMPTY BY DESIGN — see the note above.
            targetWorkflowId: '',
            // The self-emptying filter: answering removes the guest from it.
            statuses: [{ value: 'pending' }],
            requirePhone: true,
            maxGuests: 10,
            errorPolicy: 'errorRoute',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'התחיל' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
      {
        id: SWEEP_ALERT_ID,
        type: 'node',
        position: { x: 780, y: 40 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'סיכום לצוות',
            description: 'כמה הרצות התחילו, וכמה אורחים התאימו',
            level: 'info',
            title: 'תזכורות שבועיות נשלחו',
            // `capped` is the line worth reading: "everyone got one" and "the
            // first ten did" are different facts.
            detail:
              'התחילו {{nodes.tmpl-sweep-fanout.started}} הרצות מתוך {{nodes.tmpl-sweep-fanout.matched}} אורחים שהתאימו. נעצר בתקרה: {{nodes.tmpl-sweep-fanout.capped}}',
            // An alert that fails must not fail the run it reports on.
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: SWEEP_FAILED_ID,
        type: 'node',
        position: { x: 780, y: 260 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'WarningCircle',
          properties: {
            label: 'התראה על כישלון',
            description: 'הפיצול לא הצליח',
            level: 'warn',
            title: 'הפיצול לתזכורות נכשל',
            // `reason?` — safe navigation, because `reason` is NOT in the
            // fan-out's outputSchema: it appears only on the error branch. A
            // strict reference to an absent field fails the whole run.
            detail: 'סיבה: {{nodes.tmpl-sweep-fanout.reason?}}',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: `${SWEEP_TRIGGER_ID}->${SWEEP_FANOUT_ID}`,
        source: SWEEP_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: SWEEP_FANOUT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      // BOTH branches wired: a node that names a port no edge carries is a dead
      // end, and a dead end ends the run `execution_incomplete`.
      {
        id: `${SWEEP_FANOUT_ID}->${SWEEP_ALERT_ID}`,
        source: SWEEP_FANOUT_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.ok,
        target: SWEEP_ALERT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'התחיל' },
      },
      {
        id: `${SWEEP_FANOUT_ID}->${SWEEP_FAILED_ID}`,
        source: SWEEP_FANOUT_ID,
        sourceHandle: ACTION_BRANCH_HANDLES.error,
        target: SWEEP_FAILED_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'נכשל' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

const PERGUEST_TRIGGER_ID = 'tmpl-perguest-trigger';
const PERGUEST_SEND_ID = 'tmpl-perguest-send';

/**
 * The CHILD of a fan-out: one guest, one reminder.
 *
 * ⚠️ IT IS STARTED BY ANOTHER WORKFLOW, NOT BY ITS OWN TRIGGER, and that shapes
 * everything about it.
 *
 * Its trigger is a webhook whose token is left EMPTY. That is not an oversight:
 * every graph must declare exactly one start node (rule 1 of the conversion
 * contract), so a workflow needs a trigger even when nothing fires it — and an
 * empty token means the public endpoint cannot reach it either. A WhatsApp
 * trigger here would have been worse: armed, it would fire on every inbound
 * message as well as on the fan-out.
 *
 * It also must NOT be armed. Arming is about a workflow's own trigger; a
 * fan-out starts it regardless, which is why `startRunsForGuests` does not
 * require it.
 */
// ── voice call, waited on ─────────────────────────────────────────────────────
//
// The template that shows what `waitForOutcome` is FOR. Without it the feature
// is a switch in a properties panel: an owner can turn it on, but has no example
// of what the run then produces or how to branch on it.
//
// ⚠️ IT BRANCHES ON `outcome`, NOT ON `finishReason`. That is the whole point of
// the business-outcome layer — the raw reason is sometimes 'completed',
// sometimes 'Normal termination', and sometimes `sip_486`, and nobody drawing a
// diagram should have to know that 486 is Busy Here. The switch rows below read
// `{{nodes.voice-wait-call.outcome}}`, which is always one of four words.
//
// `purposeKey` ships EMPTY on purpose, exactly as the WhatsApp templates ship
// without a number: the list is a live table, the owner picks from the dropdown
// on first edit, and the handler refuses a blank rather than guessing. A template
// that named a purpose would name one that may not exist on this account.
const voiceCallWithOutcome: DiagramModel = {
  name: 'שיחה קולית עם המתנה לתוצאה',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: 'voice-wait-trigger',
        type: 'start-node',
        position: { x: 0, y: 260 },
        data: {
          segments: [],
          type: 'trigger.whatsapp_inbound',
          icon: 'WhatsappLogo',
          properties: {
            label: 'האורח ביקש שיחה',
            description: 'מתחיל כשהודעת האורח מכילה את מילת ההפעלה',
            keyword: 'שיחה',
          },
        },
      },
      {
        id: 'voice-wait-call',
        type: 'decision-node',
        position: { x: 380, y: 260 },
        data: {
          segments: [],
          type: 'action.start_voice_call',
          icon: 'PhoneOutgoing',
          properties: {
            label: 'שיחה עם סוכן קולי',
            description: 'מחייג, ואז עוצר עד שהשיחה מסתיימת ומדווחת',
            status: 'active',
            // The owner picks from the live `voice_purposes` list on first edit.
            purposeKey: '',
            // ⚠️ THE FIELD THIS TEMPLATE EXISTS TO DEMONSTRATE. Off by default on
            // the node itself, because every graph drawn before it existed must
            // keep dialling and carrying on; on here, because a template whose
            // next step reads the call's result has to wait for one.
            waitForOutcome: true,
            // ⚠️ 'errorRoute', NOT 'continue' — and the difference is that the
            // error branch declared below only EXISTS under this policy.
            // `graph-runner` fires an error edge when `nextPort` is the reserved
            // error handle, which only happens under 'errorRoute'; under
            // 'continue' every error edge is pruned, so this node used to declare
            // a branch that could never fire.
            //
            // A refused dial is still not an error — it returns a completed step
            // carrying `outcome: 'failed'`, and flows to the switch like any
            // other answer. What reaches the error edge is the node THROWING: a
            // missing purpose, an unavailable capability, a step that ran out of
            // time. Those are worth waking someone for.
            errorPolicy: 'errorRoute',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'הצליח' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'נכשל' },
            ],
          },
        },
      },
      {
        id: 'voice-wait-switch',
        type: 'decision-node',
        position: { x: 760, y: 260 },
        data: {
          segments: [],
          type: 'logic.switch',
          icon: 'ArrowsSplit',
          properties: {
            label: 'איך הסתיימה השיחה?',
            description: 'מנתב לפי תוצאת השיחה, לא לפי קוד הטלפוניה',
            // ⚠️ THE `?` IS LOAD-BEARING — it is the difference between this
            // flow reporting a problem and this flow DYING of one.
            //
            // `resolve-template` throws `Unresolved template reference` on a
            // missing path rather than resolving to '' (resolve-template.ts:127),
            // and `resolveConfigTemplates` walks EVERY string in a node's config
            // — `left` and each branch's `x` alike — so one missing value fails
            // the whole step, permanently.
            //
            // And the call node really can complete without an `outcome`, in two
            // cases that are nobody's mistake: a rolling deploy where the read
            // port vanished between parking and waking (steps/index.ts:684), and
            // a replay collision whose re-read came back empty, leaving an empty
            // `attemptId` (voice-purpose-dispatch.ts:172 → steps/index.ts:747).
            // In both the owner ticked "wait for the outcome" and did everything
            // right, and an infrastructure blip would have killed the run.
            //
            // `?` and NOT `| default: 'failed'`, which the resolver also
            // supports: '' is the absence of an answer, and 'failed' is a claim
            // that the call did not happen — which nobody can make here, since
            // it may well have. This is the same reasoning `toBusinessOutcome`
            // gives for mapping an unreported call to `no_answer` rather than
            // `failed`. '' matches no branch, so it lands on the catch-all and a
            // person is told.
            left: '{{nodes.voice-wait-call.outcome?}}',
            decisionBranches: [
              {
                id: 'completed',
                sourceHandle: switchBranchHandle('completed'),
                label: 'השיחה הושלמה',
                conditions: [
                  {
                    x: '{{nodes.voice-wait-call.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'completed',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'no_answer',
                sourceHandle: switchBranchHandle('no_answer'),
                label: 'לא ענו',
                conditions: [
                  {
                    x: '{{nodes.voice-wait-call.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'no_answer',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'failed',
                sourceHandle: switchBranchHandle('failed'),
                label: 'השיחה נכשלה',
                conditions: [
                  {
                    x: '{{nodes.voice-wait-call.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'failed',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                // ⚠️ THE CATCH-ALL, because the three above do not cover the
                // vocabulary. `follow_up_required` is a real member of
                // VoiceBusinessOutcome that nothing maps to yet, and a run whose
                // value matches no branch stops with nowhere to go — an
                // `incomplete` outcome an owner reads as "it just stopped".
                id: SWITCH_DEFAULT_BRANCH_ID,
                sourceHandle: SWITCH_DEFAULT_HANDLE,
                label: 'אחרת',
                conditions: [],
              },
            ],
          },
        },
      },
      {
        // ⚠️ NOT `action.send_whatsapp`, AND THAT IS THE LESSON OF THIS TEMPLATE.
        //
        // A free-text WhatsApp reply is legal only inside the 24-hour window the
        // guest opens by writing to us, and `send_whatsapp`'s own comment says
        // the reasoning "is tied to the trigger, not to this node — a scheduled
        // trigger or A DELAY STEP would break it", returning 131047. A voice call
        // this flow WAITS for is exactly such a delay: the park runs to the
        // attempt's token TTL, which is hours.
        //
        // An approved template still works there. The `delayedNudge` template in
        // this same file exists to teach the same distinction after a two-day
        // wait; this is the same rule after a phone call.
        //
        // `reminder_1` and not `thankyou`: `thankyou` is MARKETING, routes
        // through MM Lite, and resolves to nothing on a non-brit event — which
        // reports a COMPLETED step while the guest gets nothing.
        id: 'voice-wait-nudge',
        type: 'node',
        position: { x: 1140, y: 260 },
        data: {
          segments: [],
          type: 'action.send_template',
          icon: 'ChatCircleText',
          properties: {
            label: 'תזכורת למי שלא ענה',
            description: 'תבנית מאושרת — חוקית גם אחרי שחלון 24 השעות נסגר',
            status: 'active',
            messageKey: 'reminder_1',
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: 'voice-wait-done',
        type: 'node',
        position: { x: 1140, y: 60 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'השיחה הושלמה',
            description: 'הסוכן דיבר עם האורח והשיחה דיווחה',
            status: 'active',
            level: 'info',
            title: 'שיחה קולית הושלמה',
            errorPolicy: 'continue',
          },
        },
      },
      {
        id: 'voice-wait-alert',
        type: 'node',
        position: { x: 1140, y: 460 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'התראה לצוות',
            // Reached from three places: the `failed` outcome, the catch-all
            // branch, and the call node's own error port. All three mean "a
            // person should look", and none of them should message the guest.
            description: 'השיחה לא יצאה לדרך, או שהתוצאה לא מוכרת',
            status: 'active',
            level: 'warn',
            title: 'שיחה קולית נכשלה או החזירה תוצאה לא מוכרת',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: 'voice-wait-e1',
        source: 'voice-wait-trigger',
        sourceHandle: SOURCE,
        target: 'voice-wait-call',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'voice-wait-e2',
        source: 'voice-wait-call',
        sourceHandle: ACTION_BRANCH_HANDLES.ok,
        target: 'voice-wait-switch',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'voice-wait-e3',
        source: 'voice-wait-switch',
        sourceHandle: switchBranchHandle('completed'),
        target: 'voice-wait-done',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'voice-wait-e4',
        source: 'voice-wait-switch',
        sourceHandle: switchBranchHandle('no_answer'),
        target: 'voice-wait-nudge',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'voice-wait-e5',
        source: 'voice-wait-switch',
        sourceHandle: switchBranchHandle('failed'),
        target: 'voice-wait-alert',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        // The call node declares an `error` branch; without this edge the branch
        // is drawn, fires, and leads nowhere. `errorPolicy: 'errorRoute'` routes
        // a THROWN node here — a missing purpose, an unavailable capability, a
        // step that ran out of time — none of which reach the switch, because
        // there is no outcome to switch on.
        id: 'voice-wait-e6',
        source: 'voice-wait-call',
        sourceHandle: ACTION_BRANCH_HANDLES.error,
        target: 'voice-wait-alert',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        // Same reasoning for the switch's catch-all: a declared branch with no
        // edge leaves the run `incomplete` instead of telling anyone.
        id: 'voice-wait-e7',
        source: 'voice-wait-switch',
        sourceHandle: SWITCH_DEFAULT_HANDLE,
        target: 'voice-wait-alert',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

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
            // a token. Both are the intent.
            token: '',
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

/**
 * A call the owner CONFIGURES, rather than one a persona hardcodes.
 *
 * ⚠️ WHAT MAKES THIS DIFFERENT FROM `voiceCallWithOutcome`, which also dials and
 * also waits. That one teaches the WAIT — park on the call, branch on how it
 * ended. This one teaches WHO CALLS WHOM: the four dial parameters the node
 * gained on 2026-09-15 (the number it goes out from, the routing rule that picks
 * the scenario, the ElevenLabs agent that answers, and the destination), all of
 * which used to live inside a deployed scenario's source.
 *
 * ⚠️ AND EVERY ONE OF THEM SHIPS EMPTY, WHICH IS THE POINT AND NOT AN OMISSION.
 * A template that arrived carrying an agent id or a caller id would be doing the
 * exact thing this work removed — hardcoding an account's values into source.
 * Empty means "the default": the purpose's own rule, the account's configured
 * caller id, the contact's own phone, the agent the scenario names. The owner
 * fills them from LIVE lists on first edit, and the arm gate refuses the
 * workflow until the one that matters — a rule, from either place — exists.
 *
 * ⚠️ `toOverride` IS LEFT EMPTY RATHER THAN DEMONSTRATED. It accepts
 * `{{nodes.<id>.<output>}}`, and showing that off here would be a trap: no
 * trigger in this catalogue declares an `outputSchema` (checked, all three), so
 * a reference to one resolves to nothing — and `resolve-template` THROWS on an
 * unresolved path rather than falling back to empty, which would fail the step
 * permanently the first time this template ran.
 */
const configuredPurposeCall: TemplateModel['value'] = {
  name: 'שיחת ייעוד — עם בחירת סוכן ומספר',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: 'purpose-call-trigger',
        type: 'start-node',
        position: { x: 0, y: 200 },
        data: {
          segments: [],
          type: 'trigger.schedule',
          icon: 'Clock',
          properties: {
            label: 'כל יום ב-11:00',
            description: 'שעון ישראל. שעה בתוך חלון החיוג המותר, לא בקצה שלו',
            time: '11:00',
            // Empty = every day, and here that is deliberate: a purpose call is
            // not tied to a weekday the way the weekly sweep is.
            days: [],
          },
        },
      },
      {
        id: 'purpose-call-dial',
        type: 'decision-node',
        position: { x: 380, y: 200 },
        data: {
          segments: [],
          type: 'action.start_voice_call',
          icon: 'PhoneOutgoing',
          properties: {
            label: 'שיחה עם הסוכן שתבחרו',
            description: 'בחרו ייעוד, ואז פתחו "פרמטרי החיוג" כדי לבחור סוכן ומספר',
            status: 'active',
            // ⚠️ ALL FIVE EMPTY. See the note above this template: the lists are
            // live (voice_purposes rows, the account's numbers, Voximplant's
            // rules, ElevenLabs' agents) and none of them belongs in source.
            purposeKey: '',
            callerId: '',
            ruleId: '',
            agentId: '',
            toOverride: '',
            // The next step reads how the call ended, so this one has to wait
            // for it to end.
            waitForOutcome: true,
            // 'errorRoute' is what makes the error branch below real — under
            // 'continue' the graph-runner prunes every error edge.
            errorPolicy: 'errorRoute',
            decisionBranches: [
              { id: 'ok', sourceHandle: ACTION_BRANCH_HANDLES.ok, label: 'חויג' },
              { id: 'error', sourceHandle: ACTION_BRANCH_HANDLES.error, label: 'לא יצא לדרך' },
            ],
          },
        },
      },
      {
        id: 'purpose-call-switch',
        type: 'decision-node',
        position: { x: 760, y: 200 },
        data: {
          segments: [],
          type: 'logic.switch',
          icon: 'ArrowsSplit',
          properties: {
            label: 'איך הסתיימה השיחה?',
            description: 'מנתב לפי תוצאת השיחה, לא לפי קוד הטלפוניה',
            // The `?` is load-bearing for the same reason it is in
            // `voiceCallWithOutcome`: a waited-for call can still complete
            // without an outcome (a rolling deploy, a replay collision), and a
            // strict reference would kill the run instead of landing on the
            // catch-all. Read that template's note for the full argument.
            left: '{{nodes.purpose-call-dial.outcome?}}',
            decisionBranches: [
              {
                id: 'completed',
                sourceHandle: switchBranchHandle('completed'),
                label: 'השיחה התקיימה',
                conditions: [
                  {
                    x: '{{nodes.purpose-call-dial.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'completed',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'no_answer',
                sourceHandle: switchBranchHandle('no_answer'),
                label: 'לא ענו',
                conditions: [
                  {
                    x: '{{nodes.purpose-call-dial.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'no_answer',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                id: 'failed',
                sourceHandle: switchBranchHandle('failed'),
                label: 'לא יצאה לדרך',
                conditions: [
                  {
                    x: '{{nodes.purpose-call-dial.outcome?}}',
                    comparisonOperator: 'isEqual',
                    y: 'failed',
                    logicalOperator: 'AND',
                  },
                ],
              },
              {
                // Without it, a value no branch matches stops the run with
                // nowhere to go — which an owner reads as "it just stopped".
                id: SWITCH_DEFAULT_BRANCH_ID,
                sourceHandle: SWITCH_DEFAULT_HANDLE,
                label: 'אחרת',
                conditions: [],
              },
            ],
          },
        },
      },
      {
        id: 'purpose-call-done',
        type: 'node',
        position: { x: 1140, y: 60 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'השיחה התקיימה',
            description: 'הסוכן דיבר, והשיחה דיווחה בחזרה',
            status: 'active',
            level: 'info',
            title: 'שיחת ייעוד הושלמה',
            errorPolicy: 'continue',
          },
        },
      },
      {
        // ⚠️ ONE DESTINATION FOR EVERY OUTCOME THAT IS NOT SUCCESS, including the
        // dial node's own error branch. They differ in cause — nobody answered,
        // the dispatcher refused, the node threw — and not in what a person does
        // next, which is look. Splitting them into three alerts would be three
        // places to notice the same thing.
        //
        // ⚠️ AND `no_agent_configured` LANDS HERE. Until a purpose names an agent
        // the generic scenario refuses to dial rather than connecting a guest to
        // silence, and it reports that refusal as a failure — so the first thing
        // an owner sees when the agent is missing is this alert, not a strange
        // call.
        id: 'purpose-call-attention',
        type: 'node',
        position: { x: 1140, y: 340 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'השיחה דורשת בדיקה',
            description: 'לא ענו, לא יצאה לדרך, או שהצעד נכשל',
            status: 'active',
            level: 'warn',
            title: 'שיחת ייעוד לא הושלמה',
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: 'purpose-call-trigger->purpose-call-dial',
        source: 'purpose-call-trigger',
        sourceHandle: SOURCE,
        target: 'purpose-call-dial',
        targetHandle: TARGET,
        type: 'labelEdge',
      },
      {
        id: 'purpose-call-dial->purpose-call-switch',
        source: 'purpose-call-dial',
        // ⚠️ THE CONSTANT, NOT THE LITERAL. `types.ts` mirrors the SDK's
        // `getHandleId({ handleType:'source', innerId })` output deliberately —
        // it is server-side and must not import SDK runtime values (the
        // PALETTE_ITEMS client-reference incident) — so the named constant is the
        // sanctioned spelling and a raw 'source:inner:ok' is a second source of
        // truth for the same string.
        sourceHandle: ACTION_BRANCH_HANDLES.ok,
        target: 'purpose-call-switch',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'חויג' },
      },
      {
        id: 'purpose-call-dial->purpose-call-attention',
        source: 'purpose-call-dial',
        sourceHandle: ACTION_BRANCH_HANDLES.error,
        target: 'purpose-call-attention',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'נכשל' },
      },
      {
        id: 'purpose-call-switch-completed->purpose-call-done',
        source: 'purpose-call-switch',
        sourceHandle: switchBranchHandle('completed'),
        target: 'purpose-call-done',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'התקיימה' },
      },
      {
        id: 'purpose-call-switch-no_answer->purpose-call-attention',
        source: 'purpose-call-switch',
        sourceHandle: switchBranchHandle('no_answer'),
        target: 'purpose-call-attention',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'לא ענו' },
      },
      {
        id: 'purpose-call-switch-failed->purpose-call-attention',
        source: 'purpose-call-switch',
        sourceHandle: switchBranchHandle('failed'),
        target: 'purpose-call-attention',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'לא יצאה' },
      },
      {
        id: 'purpose-call-switch-default->purpose-call-attention',
        source: 'purpose-call-switch',
        sourceHandle: SWITCH_DEFAULT_HANDLE,
        target: 'purpose-call-attention',
        targetHandle: TARGET,
        type: 'labelEdge',
        data: { label: 'אחרת' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

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
  {
    id: 3,
    name: 'בקשת שיחה עם סוכן RSVP קולי',
    value: rsvpAiVoiceCallback,
    icon: 'PhoneCall',
  },
  {
    id: 4,
    name: 'אישור הגעה — כל התשובות',
    value: rsvpFullRouting,
    icon: 'ArrowsSplit',
  },
  {
    id: 5,
    name: 'קליטת רשימת אורחים מוואטסאפ',
    value: guestListImport,
    icon: 'UsersThree',
  },
  {
    id: 6,
    name: 'תזכורת יומיים אחרי "אחזור אליכם"',
    value: delayedNudge,
    icon: 'Hourglass',
  },
  {
    id: 7,
    name: 'תזכורת שבועית למי שטרם ענה',
    value: weeklyPendingSweep,
    icon: 'Clock',
  },
  {
    id: 8,
    name: 'תזכורת לאורח אחד (תהליך-בן)',
    value: perGuestReminder,
    icon: 'ChatCircleText',
  },
  {
    id: 9,
    name: 'שיחה קולית עם המתנה לתוצאה',
    value: voiceCallWithOutcome,
    icon: 'PhoneOutgoing',
  },
  {
    id: 10,
    name: 'שיחת ייעוד — עם בחירת סוכן ומספר',
    value: configuredPurposeCall,
    icon: 'UserSound',
  },
];
