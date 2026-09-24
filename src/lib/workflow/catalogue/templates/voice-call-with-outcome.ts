'use client';

// Starter template 9 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import {
  ACTION_BRANCH_HANDLES,
  switchBranchHandle,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
} from '../types';
import { SOURCE, TARGET } from './shared';

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
            // port vanished between parking and waking (the `!readOutcome`
            // resume fallback in nodes/action-start-voice-call/runtime.ts), and
            // a replay collision whose re-read came back empty, leaving an
            // empty `attemptId` (the 23505 re-read in voice-purpose-dispatch.ts
            // that returns `existing?.id ?? ''` → the `!outcome.attemptId`
            // "nothing to wait on" guard in the same runtime.ts).
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
        // An approved template still works there. The `delayedNudge` template
        // (`./delayed-nudge.ts`) exists to teach the same distinction after a two-day
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

export const voiceCallWithOutcomeTemplate: TemplateModel = {
  id: 9,
  name: 'שיחה קולית עם המתנה לתוצאה',
  value: voiceCallWithOutcome,
  icon: 'PhoneOutgoing',
};
