'use client';

// `action.set_guest_field` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { errorPolicyOptions, identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields, type GuestField } from './definition';

export const guestFieldOptions = {
  meal_pref: { value: 'meal_pref' satisfies GuestField, label: 'העדפת מנה' },
  // The two note fields are NOT interchangeable and the labels have to say so:
  // `rsvp_note` is the guest's own note and the public RSVP page renders it;
  // `note` is the owner's private annotation and the guest never sees it.
  rsvp_note: { value: 'rsvp_note' satisfies GuestField, label: 'הערת האורח (האורח רואה)' },
  note: { value: 'note' satisfies GuestField, label: 'הערה פנימית (האורח לא רואה)' },
} as const;

export const setGuestFieldSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    field: { ...requiredText, options: Object.values(guestFieldOptions) },
    value: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, sourceHandle: { type: 'string' }, label: { type: 'string' } },
      },
    },
  },
} satisfies NodeSchema;

export type SetGuestFieldSchema = typeof setGuestFieldSchema;
