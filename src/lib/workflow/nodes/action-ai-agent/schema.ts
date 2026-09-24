'use client';

// `action.ai_agent` — the JSON schema of its properties panel. Editor side.
import { errorPolicyProperty } from '@workflowbuilder/sdk';
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

const aiAgentModelOptions = [
  { value: 'haiku', label: 'מהיר (haiku)' },
  { value: 'sonnet', label: 'חזק (sonnet)' },
];

export const aiAgentSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...errorPolicyProperty,
    systemPrompt: { ...requiredText },
    model: { ...requiredText, options: aiAgentModelOptions.map((o) => ({ ...o })) },
    maxTurns: { type: 'number' },
    // ⚠️ THE VENDOR'S FIXED ROW SHAPE, AND `apiKey` IS DELIBERATELY UNUSED.
    // `AiTools` is a repeater bound to `{ id, sourceHandle, tool, description,
    // apiKey }` and its own docs say the surface is "specific to the demo's
    // AI-agent node" — the shape cannot be changed. Our tools are KALFA
    // capabilities reached through the settings file the port passes, so none
    // of them has a per-tool key; and a diagram is exportable, which is why
    // nothing would justify putting one there. The handler reads `tool` only.
    tools: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceHandle: { type: 'string' },
          tool: { type: 'string' },
          description: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
    },
  },
} satisfies NodeSchema;

export type AiAgentSchema = typeof aiAgentSchema;
