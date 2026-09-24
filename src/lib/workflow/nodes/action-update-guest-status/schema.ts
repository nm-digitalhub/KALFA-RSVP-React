'use client';

// `action.update_guest_status` — the JSON schema of its properties panel.
// Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  rsvpStatusOptions,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

export const updateGuestStatusSchema = {
  type: 'object',
  // `rsvpStatus`, not `status`. The SDK reserves `status` for the node's own
  // Active/Draft/Disabled lifecycle — it is in `statusOptions` and drives the
  // status badge — and this node happened to have picked the same word for the
  // guest's RSVP. Two different meanings under one key in one object is a bug
  // waiting for whoever reads it next, so ours moved. The handler (`runtime.ts`)
  // still accepts the old key through `LEGACY_PROPERTY_ALIASES`, because
  // diagrams saved before this carry it.
  //
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    rsvpStatus: { ...requiredText, options: Object.values(rsvpStatusOptions) },
    // Surfaced on THIS node only. Upstream's guidance is to spread the fragment
    // "on node types that should surface the choice; omit it elsewhere — the
    // runner defaults to 'fail' when the field is absent."
    //
    // The trigger is excluded because a trigger that throws has produced no run
    // to continue. The condition is excluded for a sharper reason: under
    // 'continue' the runner schedules EVERY outgoing edge, so a condition that
    // failed would fire both branches at once and the guest would be marked
    // attending and declined in the same run.
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type UpdateGuestStatusSchema = typeof updateGuestStatusSchema;
