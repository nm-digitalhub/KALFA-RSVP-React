'use client';

// `action.notify_team` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { notifyLevelOptions, type NotifyTeamSchema } from './schema';

export const notifyTeamDefaultPropertiesData: NodeDataProperties<NotifyTeamSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'התראה לצוות',
  description: 'שולח הודעה לערוץ הצוות',
  title: '',
  detail: '',
  level: notifyLevelOptions.warn.value,
  errorPolicy: errorPolicyOptions.continue.value,
};
