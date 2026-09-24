'use client';

// `action.webhook` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  conditionalRules,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import * as webhookDefinition from './definition';
import { HTTP_METHODS, requiredFields } from './definition';

// GET/DELETE carry no body — the port drops it rather than sending an empty one.
export const httpMethodOptions = {
  POST: { label: 'POST — שליחת נתונים', value: HTTP_METHODS[0] },
  GET: { label: 'GET — קריאת נתונים', value: HTTP_METHODS[1] },
  PUT: { label: 'PUT — החלפה', value: HTTP_METHODS[2] },
  PATCH: { label: 'PATCH — עדכון חלקי', value: HTTP_METHODS[3] },
  DELETE: { label: 'DELETE — מחיקה', value: HTTP_METHODS[4] },
} as const;

export const webhookSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    method: { type: 'string', options: Object.values(httpMethodOptions) },
    url: { ...requiredText },
    // The field the old design refused to have. See WebhookConfig for why it can
    // exist now: a value may be `{{secrets.<NAME>}}`, and the NAME is what is
    // stored — the secret itself is fetched at the socket and never comes back.
    headers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', label: 'שם', placeholder: 'Authorization' },
          value: { type: 'string', label: 'ערך', placeholder: 'Bearer {{secrets.ACME_API_KEY}}' },
        },
      },
    },
    // ⚠️ UNCONSTRAINED HERE ON PURPOSE. A GET or DELETE with an empty body is
    // correct — the runtime does not send one — so the floor cannot live at the
    // top level. `allOf` below raises it to `minLength: 1` for exactly the three
    // verbs that DO send a body.
    body: { type: 'string' },
    captureResponse: { type: 'boolean' },
    ...actionBranchesProperty,
  },
  // Built from the definition's `conditionalRequirements`, through the registry
  // `arm-check.ts` also reads — one declaration, both gates.
  allOf: conditionalRules(webhookDefinition.type),
} satisfies NodeSchema;

export type WebhookSchema = typeof webhookSchema;
