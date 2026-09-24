'use client';

// `action.notify_team` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

export const notifyLevelOptions = {
  info: { label: 'מידע', value: 'info' },
  warn: { label: 'אזהרה', value: 'warn' },
  error: { label: 'שגיאה', value: 'error' },
} as const;

export const notifyTeamSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    title: { ...requiredText },
    detail: { type: 'string' },
    level: { type: 'string', options: Object.values(notifyLevelOptions) },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type NotifyTeamSchema = typeof notifyTeamSchema;
