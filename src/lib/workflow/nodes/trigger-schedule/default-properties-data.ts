'use client';

// `trigger.schedule` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import type { ScheduleSchema } from './schema';

export const scheduleDefaultPropertiesData: NodeDataProperties<ScheduleSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'לפי שעון',
  description: 'מתחיל את התהליך בשעה קבועה',
  time: '09:00',
  days: [],
};
