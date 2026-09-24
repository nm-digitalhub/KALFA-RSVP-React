'use client';

// Starter template 7 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { ACTION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

// ---------------------------------------------------------------------------
// The clock, the wait, and the fan-out — the three capabilities added 13.9.2026
// ---------------------------------------------------------------------------
//
// Until now every template started from a guest speaking to us. These three —
// this one, `./per-guest-reminder.ts` and `./delayed-nudge.ts` — do
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

export const weeklyPendingSweepTemplate: TemplateModel = {
  id: 7,
  name: 'תזכורת שבועית למי שטרם ענה',
  value: weeklyPendingSweep,
  icon: 'Clock',
};
