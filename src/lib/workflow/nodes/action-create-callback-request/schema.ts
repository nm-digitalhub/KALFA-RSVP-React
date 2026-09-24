'use client';

// `action.create_callback_request` — the JSON schema of its properties panel.
// Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { errorPolicyOptions, identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { CALLBACK_TOPICS, requiredFields } from './definition';

const callbackTopicOptions = CALLBACK_TOPICS.map((value) => ({ label: value, value }));

export const callbackRequestSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    topic: { ...requiredText, options: callbackTopicOptions },
    note: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, sourceHandle: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
} satisfies NodeSchema;

export type CallbackRequestSchema = typeof callbackRequestSchema;
