'use client';

// Starter template 4 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { switchBranchHandle, SWITCH_DEFAULT_BRANCH_ID, SWITCH_DEFAULT_HANDLE } from '../types';
import { SOURCE, TARGET } from './shared';

// ---------------------------------------------------------------------------
// Template 4 — every answer has a route, including the one nobody planned for
// ---------------------------------------------------------------------------

// What the three templates before it (ids 1–3) cannot express, and why this one
// exists.
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

export const rsvpFullRoutingTemplate: TemplateModel = {
  id: 4,
  name: 'אישור הגעה — כל התשובות',
  value: rsvpFullRouting,
  icon: 'ArrowsSplit',
};
