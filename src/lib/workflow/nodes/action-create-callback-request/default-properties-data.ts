'use client';

// `action.create_callback_request` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import { CALLBACK_TOPICS } from './definition';
import type { CallbackRequestSchema } from './schema';

export const callbackRequestDefaultPropertiesData: NodeDataProperties<CallbackRequestSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'בקשת חזרה לאורח',
  description: 'מוסיף את האורח לתור שיחות החזרה של הצוות',
  // ⚠️ AN OFFERED VALUE, NOT AN INTERNAL LABEL. This used to seed
  // 'פנייה מתהליך אוטומטי', which is not in `CALLBACK_TOPICS` — so the Select
  // rendered a value absent from its own options, and a node dropped and never
  // opened created a callback whose topic the team reads in the queue and the
  // agent is handed as `{{topic_he}}`. The handler's blank-fallback was fixed to
  // `CALLBACK_TOPICS[0]` (`runtime.ts`) and this was not: the default is
  // non-blank, so the fallback never sees it.
  topic: CALLBACK_TOPICS[0],
  note: '',
  errorPolicy: errorPolicyOptions.fail.value,
};
