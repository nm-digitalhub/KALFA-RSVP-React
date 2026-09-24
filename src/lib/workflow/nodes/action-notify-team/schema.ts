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

import { requiredFields, type NotifyLevel } from './definition';

// Keyed by `NotifyLevel`, so a level added to or removed from `NOTIFY_LEVELS`
// without a matching option here is a type error rather than a Select that
// silently disagrees with the handler's `readEnum` guard.
export const notifyLevelOptions = {
  info: { label: 'מידע', value: 'info' },
  warn: { label: 'אזהרה', value: 'warn' },
  error: { label: 'שגיאה', value: 'error' },
} as const satisfies Record<NotifyLevel, { label: string; value: NotifyLevel }>;

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
