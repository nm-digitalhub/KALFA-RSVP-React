'use client';

// `action.import_guest_list` — the JSON schema of its properties panel. Editor
// side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

// NO BUSINESS FIELDS, and that is the design — see `ImportGuestListConfig` in
// ./definition.ts. The only properties are the ones every node carries: a name,
// a description, the on/off switch, the failure policy and the two branch
// handles.
export const importGuestListSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

export type ImportGuestListSchema = typeof importGuestListSchema;
