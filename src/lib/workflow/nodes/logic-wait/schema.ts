'use client';

// `logic.wait` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { numberRanges, requiredFields, WAIT_UNIT_VALUES } from './definition';

export const waitUnitOptions = {
  minutes: { label: 'דקות', value: WAIT_UNIT_VALUES[0] },
  hours: { label: 'שעות', value: WAIT_UNIT_VALUES[1] },
  days: { label: 'ימים', value: WAIT_UNIT_VALUES[2] },
} as const;

export const waitSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    // `minimum: 1` is the form's half of the guard; the handler refuses a
    // non-positive value again, because the schema constrains what can be TYPED
    // and not what is in the jsonb row.
    amount: { type: 'number', ...numberRanges.amount },
    unit: { ...requiredText, options: Object.values(waitUnitOptions) },
  },
} satisfies NodeSchema;

export type WaitSchema = typeof waitSchema;
