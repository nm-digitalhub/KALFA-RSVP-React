'use client';

// `trigger.sumit_card` — the JSON schema of its properties panel. Editor side.
//
// ⚠️ ONE CREDENTIAL FIELD AND NOTHING ELSE TO CONFIGURE. Folder, view and change
// type are chosen in SUMIT's own "יצירת טריגר" screen, which is where the
// filtering happens — see `SumitCardTriggerConfig`. The panel explains what to
// pick THERE rather than offering copies here that would filter nothing.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

export const sumitCardTriggerSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

export type SumitCardTriggerSchema = typeof sumitCardTriggerSchema;
