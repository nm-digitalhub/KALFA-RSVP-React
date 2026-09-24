'use client';

// Starter template 10 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { TemplateModel } from '@workflowbuilder/sdk';

import {
  ACTION_BRANCH_HANDLES,
  switchBranchHandle,
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
} from '../types';
import { SOURCE, TARGET } from './shared';

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

export const configuredPurposeCallTemplate: TemplateModel = {
  id: 10,
  name: 'שיחת ייעוד — עם בחירת סוכן ומספר',
  value: configuredPurposeCall,
  icon: 'UserSound',
};
