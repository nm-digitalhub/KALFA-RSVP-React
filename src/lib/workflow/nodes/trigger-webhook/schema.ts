'use client';

// `trigger.webhook` — the JSON schema of its properties panel, and the method
// options its uischema offers. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, requiredText, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields, WEBHOOK_METHODS } from './definition';

export const webhookMethodOptions = WEBHOOK_METHODS.map((value) => ({ value, label: value }));

export const webhookTriggerSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    // WHERE the caller proves itself. See `WEBHOOK_AUTH_MODES`: `header` is the
    // default and what every diagram saved before this field means, `address`
    // exists for a caller that can be handed a URL and nothing else.
    auth: {
      type: 'string',
      options: [
        { value: 'header', label: 'סוד בכותרת (מומלץ)' },
        { value: 'address', label: 'הכתובת עצמה היא הסוד' },
      ],
    },
    // ⚠️ THE PUBLIC HALF OF THE ADDRESS, AND SAFE TO EXPORT — IN `header` MODE.
    // `/api/workflows/hook/<endpointId>` identifies WHICH webhook and proves
    // nothing, so the panel shows it always and a diagram may carry it anywhere.
    //
    // ⚠️ NOT `requiredText`, AND NOT BECAUSE IT IS OPTIONAL. It is required in
    // `header` mode and forbidden in `address` mode, which is a CONDITIONAL
    // contract — declared once in `NODE_CONDITIONAL_REQUIRED_FIELDS` and applied
    // to this schema by the same `allOf` machinery `action.webhook` uses. A
    // `required` here would fire in both modes and make `address` unarmable.
    endpointId: { type: 'string' },
    // WHICH HTTP METHODS open this address. Objects, not bare strings, for the
    // reason `messageKinds` records at length: the SDK's `ArrayFieldSchema`
    // cannot describe an array of strings at all.
    methods: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' } } } },
    // ⚠️ THE HASH, NOT THE SECRET. The diagram used to hold the credential
    // itself — and the editor's own Export menu puts a diagram in a copyable
    // box. See `webhook-token.ts`: the value is shown once at generation and
    // only its sha256 is ever stored.
    //
    // Named `tokenHash` rather than `secretHash` deliberately: it is accurate
    // either way, and renaming it would migrate a stored field without adding a
    // bit of clarity. What CHANGED is where the secret travels — a header, not
    // the path.
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

export type WebhookTriggerSchema = typeof webhookTriggerSchema;
