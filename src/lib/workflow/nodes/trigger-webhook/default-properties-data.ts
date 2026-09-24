'use client';

// `trigger.webhook` — what a node dropped from the palette starts with.
//
// Annotated with `NodeDataProperties`, not the vendor starter's
// `Required<NodeDataProperties<…>>`: `armNotice` is in the schema and is
// deliberately never seeded (see `identityProperties`). The annotation on a
// fresh literal keeps the excess-property check the inline entry had, so an
// undeclared key here is still a compile error.
import type { NodeDataProperties } from '@workflowbuilder/sdk';

import { nodeStatusOptions } from '../../catalogue/editor-shared';

import type { WebhookTriggerSchema } from './schema';

export const webhookTriggerDefaultPropertiesData: NodeDataProperties<WebhookTriggerSchema> = {
  status: nodeStatusOptions.active.value,
  label: 'קריאת Webhook נכנסת',
  description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
  // ⚠️ `header` EXPLICITLY, NOT LEFT ABSENT. `readWebhookAuthMode` reads an
  // absent value as `header` anyway, so this changes no behaviour — it is
  // here because `palette-defaults.test.ts` requires a conditional rule's
  // decider to be a member of its own `whenIn`, and a node born with the
  // field set is a node whose mode is visible in the panel from the first
  // render rather than implied.
  auth: 'header',
  // Both halves start blank and are minted together by the control. A
  // diagram with one and not the other is the state `arm-check` refuses.
  // In `address` mode this one stays blank forever — the path is never
  // stored, only its hash.
  endpointId: '',
  // Empty means POST only. See `webhookAllowsMethod` — an absent value must
  // never widen a live public endpoint.
  methods: [],
  // ⚠️ `tokenHash`, NOT `token` — this key must match `webhookTriggerSchema`
  // and the uischema's `properties.tokenHash` scope, or a node dragged from
  // the palette is born carrying a field the schema does not declare AND
  // missing its only required one. That was live until 2026-09-22 and no
  // gate saw it: the key is a plain string in three files that never get
  // compared. `palette-defaults.test.ts` now compares them.
  //
  // EMPTY, never a value minted here. This module runs in the BROWSER, and a
  // token from `Math.random`/`crypto` on a page is a token whose entropy
  // nobody audited. `webhook-token-control.tsx` generates it and stores only
  // its sha256.
  tokenHash: '',
};
