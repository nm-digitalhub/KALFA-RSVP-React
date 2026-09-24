'use client';

// `action.set_guest_field` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { guestFieldOptions, type SetGuestFieldSchema } from './schema';

export const setGuestFieldDefaultPropertiesData: NodeDataProperties<SetGuestFieldSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'עדכון שדה אורח',
  description: 'כותב ערך לשדה אחד של האורח ששלח את ההודעה',
  field: guestFieldOptions.meal_pref.value,
  value: '',
  errorPolicy: errorPolicyOptions.fail.value,
};
