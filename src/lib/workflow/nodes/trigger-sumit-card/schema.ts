'use client';

// `trigger.sumit_card` — the JSON schema of its properties panel. Editor side.
//
// The credential, plus the three OPTIONAL choices we register in SUMIT on the
// owner's behalf (folder, view, change type) — see `SumitCardTriggerConfig`.
// Blank means the owner creates the trigger in SUMIT's own screen, as before.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields, SUMIT_CHANGE_TYPES } from './definition';

export const sumitCardTriggerSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    tokenHash: requiredText,
    // Written by the folder picker (sumit-folder-control.tsx), which also writes
    // `viewId` beside it. Plain strings: SUMIT ids, not a list we own.
    folderId: { type: 'string' },
    viewId: { type: 'string' },
    changeType: {
      type: 'string',
      options: SUMIT_CHANGE_TYPES.map((t) => ({ value: t.value, label: t.label })),
    },
  },
} satisfies NodeSchema;

export type SumitCardTriggerSchema = typeof sumitCardTriggerSchema;
