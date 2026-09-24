'use client';

// `action.start_rsvp_ai_callback` — the JSON schema of its properties panel.
// Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

export const startRsvpAiCallbackSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type StartRsvpAiCallbackSchema = typeof startRsvpAiCallbackSchema;
