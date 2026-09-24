'use client';

// `action.send_template` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields, templateKeyOptions } from './definition';

export const sendTemplateSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    messageKey: { ...requiredText, options: templateKeyOptions.map((o) => ({ ...o })) },
  },
} satisfies NodeSchema;

export type SendTemplateSchema = typeof sendTemplateSchema;
