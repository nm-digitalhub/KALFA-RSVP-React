'use client';

// Starter template 13 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { SOURCE, TARGET } from './shared';

const HOLD_TRIGGER_ID = 'tmpl-sumit-hold-trigger';
const HOLD_ALERT_ID = 'tmpl-sumit-hold-alert';

/**
 * SUMIT tells us a frame hold changed; a person is told.
 *
 * WHY THIS ONE EXISTS. `sumit-hold-reconcile.ts` discovers a manually released
 * hold by POLLING the "תפיסות מסגרת" folder (1076735289), because the comment
 * above `crm-holds.ts` believed SUMIT could not notify. It can: its trigger
 * module posts to a URL on a card change (`/triggers/triggers/subscribe/`,
 * "usually done by make.com/zapier, but can also be used directly"). This is
 * that notification, landing in the team channel.
 *
 * ⚠️ NO CONDITION NODE: the filtering stays where SUMIT documents it — the VIEW
 * chosen in SUMIT's trigger screen, filtered to released holds. The status shape
 * that once made a condition risky is now MEASURED: live releases on 2026-09-23
 * carried `Billing_Status: [3]`, a bare code, the same as `listentities`. The
 * alert shows it through the trigger's `holdStatus` — "שוחררה (3)" — which keeps
 * the code beside the name, so a wrong label cannot hide what SUMIT sent.
 *
 * ⚠️ AN ALERT AND NOTHING MORE. The payload is unsigned: anyone holding the
 * address can post a "released" hold. A notification to a person is safe to
 * trigger from that; a charge, a refund or a status write is not.
 *
 * ⚠️ THE TITLE CARRIES THE CARD ID. The alert layer suppresses a repeated title
 * inside its dedup window, so a fixed title would report the first release of
 * the hour and swallow the rest.
 */
const sumitHoldChanged: DiagramModel = {
  name: 'תפיסת מסגרת השתנתה ב-SUMIT — התראה לצוות',
  layoutDirection: 'RIGHT',
  diagram: {
    nodes: [
      {
        id: HOLD_TRIGGER_ID,
        type: 'start-node',
        position: { x: 0, y: 140 },
        data: {
          segments: [],
          type: 'trigger.sumit_card',
          icon: 'IdentificationCard',
          properties: {
            label: 'תפיסת מסגרת השתנתה ב-SUMIT',
            description: 'תיקיית "תפיסות מסגרת", בתצוגה שמסננת רק תפיסות ששוחררו',
            // Blank: a template is a draft. The address is minted in the editor,
            // shown once, and pasted into SUMIT's trigger screen.
            tokenHash: '',
          },
        },
      },
      {
        id: HOLD_ALERT_ID,
        type: 'node',
        position: { x: 400, y: 140 },
        data: {
          segments: [],
          type: 'action.notify_team',
          icon: 'Bell',
          properties: {
            label: 'התראה לצוות',
            description: 'מה ש-SUMIT שלחה, כדי שאדם יבדוק',
            level: 'warn',
            title: `תפיסת מסגרת {{nodes.${HOLD_TRIGGER_ID}.entityId}} השתנתה ב-SUMIT`,
            detail:
              `כרטיס {{nodes.${HOLD_TRIGGER_ID}.entityId}} בתיקייה {{nodes.${HOLD_TRIGGER_ID}.folder}} — ` +
              `סוג השינוי: {{nodes.${HOLD_TRIGGER_ID}.changeType}}.\n` +
              `סטטוס: {{nodes.${HOLD_TRIGGER_ID}.holdStatus}}\n` +
              // `?` on the amount: this is display text, not a condition, so the
              // text-typing it causes costs nothing — and a release whose view
              // lacks the column still alerts instead of failing the step.
              `סכום: {{nodes.${HOLD_TRIGGER_ID}.properties.Billing_Amount.0?}} {{nodes.${HOLD_TRIGGER_ID}.holdCurrency}}\n` +
              'הקריאה אינה חתומה — ודאו ב-SUMIT לפני כל פעולה.',
            // An alert that fails must not fail the run it reports on.
            errorPolicy: 'continue',
          },
        },
      },
    ],
    edges: [
      {
        id: `${HOLD_TRIGGER_ID}->${HOLD_ALERT_ID}`,
        source: HOLD_TRIGGER_ID,
        sourceHandle: SOURCE,
        target: HOLD_ALERT_ID,
        targetHandle: TARGET,
        type: 'labelEdge',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
};

export const sumitHoldChangedTemplate: TemplateModel = {
  id: 13,
  name: 'תפיסת מסגרת השתנתה ב-SUMIT — התראה לצוות',
  value: sumitHoldChanged,
  icon: 'IdentificationCard',
};
