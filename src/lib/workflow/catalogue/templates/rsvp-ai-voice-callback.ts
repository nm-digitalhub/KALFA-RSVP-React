'use client';

// Starter template 3 of 13 — its diagram and its selector entry. Editor
// side; `./index.ts` places it in `DIAGRAM_TEMPLATES` at the position the
// inline entry held.
import type { DiagramModel, TemplateModel } from '@workflowbuilder/sdk';

import { ACTION_BRANCH_HANDLES } from '../types';
import { SOURCE, TARGET } from './shared';

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

export const rsvpAiVoiceCallbackTemplate: TemplateModel = {
  id: 3,
  name: 'בקשת שיחה עם סוכן RSVP קולי',
  value: rsvpAiVoiceCallback,
  icon: 'PhoneCall',
};
