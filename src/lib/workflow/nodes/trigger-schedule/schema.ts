'use client';

// `trigger.schedule` — the JSON schema of its properties panel, and the day
// options its uischema offers. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

// Sunday = 0, matching `Date.getDay()` and Israel's own week.
export const scheduleDayOptions = [
  { value: '0', label: 'ראשון' },
  { value: '1', label: 'שני' },
  { value: '2', label: 'שלישי' },
  { value: '3', label: 'רביעי' },
  { value: '4', label: 'חמישי' },
  { value: '5', label: 'שישי' },
  { value: '6', label: 'שבת' },
] as const;

export const scheduleSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    // `pattern` is the form's half; `matchesSchedule` refuses a bad value again,
    // because the schema constrains what can be TYPED and not what is in the row.
    time: { ...requiredText, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', placeholder: '09:00' },
    days: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

export type ScheduleSchema = typeof scheduleSchema;
