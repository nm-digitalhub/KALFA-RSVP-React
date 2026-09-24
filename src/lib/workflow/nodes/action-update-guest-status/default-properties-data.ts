'use client';

// `action.update_guest_status` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import {
  actionBranches,
  errorPolicyOptions,
  nodeStatusOptions,
  rsvpStatusOptions,
} from '../../catalogue/editor-shared';

import type { UpdateGuestStatusSchema } from './schema';

export const updateGuestStatusDefaultPropertiesData: NodeDataProperties<UpdateGuestStatusSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'עדכון סטטוס אורח',
  description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
  rsvpStatus: rsvpStatusOptions.attending.value,
  errorPolicy: errorPolicyOptions.fail.value,
};
