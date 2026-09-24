// `action.microsoft_send_email`: the pure contract, shared by the editor and the
// server.
//
// ⚠️ IMPORTS NOTHING, not even a type. `catalogue/types.ts` imports this file to
// build `NODE_TYPES`, `NODE_REQUIRED_FIELDS` and `KalfaNodeConfig`, so an import
// back into types.ts (even a type-only one, which `no-circular` counts) would
// close a cycle. It is also read by the pg-boss worker, so it must stay SDK-free.
// `server-code-must-not-reach-the-editor-sdk` in .dependency-cruiser.cjs enforces
// the second half.

/**
 * The node type, stored verbatim in the diagram's `data.type`.
 *
 * A persistence contract: renaming it orphans every saved workflow that used it.
 */
export const type = 'action.microsoft_send_email' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * How Graph is told to read the body. Graph's own default is `Text`, which is
 * exactly what every diagram saved before this field existed meant — so an
 * absent value and an explicit `Text` produce the same mail.
 */
export const MICROSOFT_MAIL_CONTENT_TYPES = ['Text', 'HTML'] as const;
export type MicrosoftMailContentType = (typeof MICROSOFT_MAIL_CONTENT_TYPES)[number];

/** Graph's own `message.importance`. `normal` is its default, for the same reason. */
export const MICROSOFT_MAIL_IMPORTANCES = ['low', 'normal', 'high'] as const;
export type MicrosoftMailImportance = (typeof MICROSOFT_MAIL_IMPORTANCES)[number];

/**
 * Sends an email through a KALFA-managed Microsoft 365 connection.
 *
 * The workflow stores the connection identifier and message data only.
 * OAuth access/refresh tokens and client secrets never belong to diagram JSON.
 *
 * ⚠️ ONLY `connectionId`, `to`, `subject` AND `body` ARE REQUIRED, and the split
 * is deliberate: `NODE_REQUIRED_FIELDS` is the ARMING contract — what a step
 * cannot run without — while everything else here is an option the editor offers
 * and the transport defaults. A diagram saved before these fields existed
 * carries none of them and keeps sending exactly the mail it always did,
 * because every default below is Graph's own.
 *
 * ⚠️ `to` IS ONE ADDRESS; `cc`, `bcc` AND `replyTo` ARE LISTS. That asymmetry is
 * a decision, not an oversight (2026-09-17). Widening the primary recipient from
 * one address to many changes what an existing node means at run time, and it
 * deserves its own change with its own test rather than arriving as a side
 * effect of adding carbon copies. The three new fields are stored as one string
 * each and split on `,` or `;` by the transport — neither character can appear
 * in a legal address, so nothing that parsed as one address stops doing so.
 *
 * Addresses are not validated HERE, and that follows the rule every other field
 * follows: `resolveConfigTemplates` rewrites `{{trigger.…}}` before the handler
 * ever sees the config, so at save time a field may legitimately look like
 * nothing at all. The shape check belongs at the transport, where the value is
 * final.
 */
export type MicrosoftSendEmailConfig = {
  connectionId: string;
  /** One address. See the note above for why this one is not a list. */
  to: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  cc?: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  bcc?: string;
  /** Zero or more addresses, separated by `,` or `;`. */
  replyTo?: string;
  subject: string;
  body: string;
  contentType?: MicrosoftMailContentType;
  importance?: MicrosoftMailImportance;
  saveToSentItems?: boolean;
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 *
 * `cc`, `bcc`, `replyTo` and the three mail options are deliberately absent —
 * see the note on `MicrosoftSendEmailConfig`.
 */
export const requiredFields: string[] = ['label', 'description', 'connectionId', 'to', 'subject', 'body'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `connectionId` is an `integration_connections.id` uuid: a pointer to a row
 * here, which resolves to nothing anywhere else. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  connectionId: 'identifier',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `accepted` key by hand.
 */
export const outputFields = {
  accepted: {
    type: 'boolean',
    label: 'התקבל אצל Microsoft Graph',
    description: 'האם Microsoft Graph קיבל את בקשת השליחה; אין בכך אישור מסירה',
  },
} as const;
