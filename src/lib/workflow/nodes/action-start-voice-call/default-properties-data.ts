'use client';

// `action.start_voice_call` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { actionBranches, errorPolicyOptions, nodeStatusOptions } from '../../catalogue/editor-shared';

import type { VoiceCallSchema } from './schema';

export const voiceCallDefaultPropertiesData: NodeDataProperties<VoiceCallSchema> = {
  decisionBranches: actionBranches.map((branch) => ({ ...branch })),
  status: nodeStatusOptions.active.value,
  label: 'שיחה עם סוכן קולי',
  description: 'מתקשר לאורח עם אחד הסוכנים הקוליים שהוגדרו',
  purposeKey: '',
  // Blank = "whatever dialled before this field existed". See the schema's
  // own note: an override that defaults to set would change live diagrams.
  callerId: '',
  ruleId: '',
  toOverride: '',
  agentId: '',
  waitForOutcome: false,
  errorPolicy: errorPolicyOptions.continue.value,
};
