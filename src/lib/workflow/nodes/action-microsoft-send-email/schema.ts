'use client';

// `action.microsoft_send_email` — the JSON schema of its properties panel, and
// the factory that offers the installation's own connections. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields, type MicrosoftMailContentType, type MicrosoftMailImportance } from './definition';

export type MicrosoftConnectionOption = {
  /** Human-readable connection name; display-only and never persisted. */
  label: string;
  /** integration_connections.id — the value persisted in connectionId. */
  value: string;
};

export const microsoftContentTypeOptions = {
  Text: { label: 'טקסט רגיל', value: 'Text' },
  HTML: { label: 'HTML', value: 'HTML' },
} as const satisfies Record<MicrosoftMailContentType, { label: string; value: string }>;

export const microsoftImportanceOptions = {
  normal: { label: 'רגילה', value: 'normal' },
  high: { label: 'גבוהה', value: 'high' },
  low: { label: 'נמוכה', value: 'low' },
} as const satisfies Record<MicrosoftMailImportance, { label: string; value: string }>;

export const microsoftSendEmailSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    ...actionBranchesProperty,
    connectionId: { ...requiredText },
    to: { ...requiredText },
    cc: { type: 'string' },
    bcc: { type: 'string' },
    replyTo: { type: 'string' },
    subject: { ...requiredText },
    body: { ...requiredText },
    contentType: { type: 'string', options: Object.values(microsoftContentTypeOptions) },
    importance: { type: 'string', options: Object.values(microsoftImportanceOptions) },
    saveToSentItems: { type: 'boolean' },
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
  },
} satisfies NodeSchema;

export type MicrosoftSendEmailSchema = typeof microsoftSendEmailSchema;

/**
 * The same schema with the installation's OWN connections offered on
 * `connectionId`.
 *
 * ⚠️ THE MODULE-LEVEL SCHEMA MUST NOT CARRY AN `options` KEY AT ALL, and that is
 * why this takes an OPTIONAL argument rather than defaulting to `[]`. The two
 * are not the same thing: an absent key means "this list is supplied at build
 * time", while `options: []` is a rendered dropdown that is genuinely empty —
 * an owner opening the panel would see a picker offering nothing, with no way to
 * tell a missing lookup from an account they have not connected yet.
 * `microsoft-connection.test.ts` asserts the module-level schema leaves it
 * `undefined`, so a default of `[]` here fails a test rather than shipping that
 * dropdown.
 */
export function microsoftSendEmailSchemaFor(
  connections?: readonly MicrosoftConnectionOption[],
): NodeSchema {
  return {
    ...microsoftSendEmailSchema,
    properties: {
      ...microsoftSendEmailSchema.properties,
      connectionId: {
        ...requiredText,
        ...(connections ? { options: connections.map(({ label, value }) => ({ label, value })) } : {}),
      },
    },
  } as NodeSchema;
}
