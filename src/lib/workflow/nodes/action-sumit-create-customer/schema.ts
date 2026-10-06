'use client';

// `action.sumit_create_customer` — the JSON schema of its properties panel.
// Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

export const sumitCreateCustomerSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    customerName: { ...requiredText },
    customerEmail: { type: 'string' },
    customerPhone: { type: 'string' },
    city: { type: 'string' },
    address: { type: 'string' },
    companyNumber: { type: 'string' },
    externalId: { type: 'string' },
    noVat: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type SumitCreateCustomerSchema = typeof sumitCreateCustomerSchema;
