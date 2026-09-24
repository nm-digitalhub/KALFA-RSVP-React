'use client';

// `action.start_for_each_guest` — the JSON schema of its properties panel.
// Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { numberRanges, requiredFields } from './definition';

export const forEachGuestSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    targetWorkflowId: requiredText,
    statuses: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
    requirePhone: { type: 'boolean' },
    // `minimum: 1` is the form's half. The handler refuses a missing or
    // non-positive cap again, and the implementation clamps to FAN_OUT_HARD_CAP
    // on top — three ceilings, because this is the node that can reach hundreds
    // of people from one press.
    maxGuests: {
      type: 'number',
      ...numberRanges.maxGuests,
    },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

export type ForEachGuestSchema = typeof forEachGuestSchema;
