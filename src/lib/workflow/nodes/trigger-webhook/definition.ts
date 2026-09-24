// `trigger.webhook`: the pure contract, shared by the editor and the server.
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
export const type = 'trigger.webhook' as const;

/**
 * A trigger: an inbound HTTP call may begin a flow. The catalogue reads this
 * flag, and it — not the stored JSON — is what decides who may start.
 */
export const isTrigger = true;

/**
 * The HTTP methods an inbound webhook may be called with.
 *
 * ⚠️ NOT AN ARBITRARY LIST. n8n's Webhook node offers exactly DELETE / GET /
 * HEAD / PATCH / POST / PUT (its README §HTTP Method, read in full 2026-09-22),
 * and a caller that can only send one of those is the whole reason this field
 * exists — before it, every non-POST call was refused with a 405 and the
 * integration simply could not be built.
 *
 * HEAD is omitted: it is defined to return no body, so a run started by one
 * could never answer anything, and Next would dispatch it to GET regardless.
 */
export const WEBHOOK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** Which methods carry a request body at all. */
export const WEBHOOK_METHODS_WITH_BODY: readonly WebhookMethod[] = ['POST', 'PUT', 'PATCH'];

/**
 * An external system calls in, and a run starts.
 *
 * THE DYNAMIC TRIGGER. It declares no field list: whatever JSON the caller POSTs
 * is published as `{{trigger.body.<path>}}`. A new caller with a different shape
 * needs no code change, no migration and no new node type — which is exactly the
 * difference between this and a trigger whose fields someone has to hard-code.
 *
 * ⚠️ THE TOKEN IS THE ONLY THING STANDING IN FRONT OF A PUBLIC ENDPOINT.
 * It lives in the diagram rather than in a column, the same way n8n shows a
 * webhook URL in its editor — it is an ADDRESS for this workflow, not a
 * credential to somebody else's system, and whoever can open the workflow is
 * exactly who needs to copy it. It is generated server-side (never in the
 * browser) and a workflow with an empty token cannot be armed.
 *
 * The endpoint it unlocks starts a run and nothing else: it cannot read a guest,
 * cannot name an event, and every guest-touching node refuses in a run that came
 * from here (`requireGuestContext`). The blast radius of a leaked token is
 * "someone can make this workflow run", not "someone can reach our data".
 */
export type WebhookTriggerConfig = {
  /**
   * The PUBLIC half of the address, in `header` mode. Safe to show, copy and
   * export — it proves nothing on its own.
   *
   * ⚠️ ABSENT IN `address` MODE, on purpose. There the path segment is the
   * credential, so storing it would put the credential back in the diagram —
   * and from there into every run's `definitionSnapshot`. Only `tokenHash`
   * is kept, and the path is hashed on the way in.
   */
  endpointId?: string;
  /**
   * sha256 of whichever half is the credential: the header secret in `header`
   * mode, the path segment in `address` mode. The value itself is never stored.
   * See `webhook-token.ts`.
   */
  tokenHash: string;
  /** Empty means POST only — see `webhookAllowsMethod` (`match.ts`). */
  methods?: readonly { value: string }[] | readonly string[];
  /**
   * Absent means `header` — see `readWebhookAuthMode`.
   *
   * The union is `WebhookAuthMode` from `catalogue/types.ts`, spelled out
   * rather than imported because this file imports nothing. The auth modes stay
   * there because `authModeFor` answers for `trigger.sumit_card` too; types.ts
   * pins the two spellings against each other at compile time.
   */
  auth?: 'header' | 'address';
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ `endpointId` IS NOT HERE — it moved to the conditional table
 * (`conditionalRequirements` below). It exists only in `header` mode; in
 * `address` mode the path segment is the credential and is never stored, so
 * requiring it would make that mode unarmable. `tokenHash` stays: BOTH modes
 * have one, it is just a hash of a different half.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'tokenHash'];

/**
 * The budget for one call of the handler: the 120s default, stated explicitly.
 * `NODE_ACTIVITY_PROFILES` has no entry for this node and never had one.
 */
export const activityProfile = 'default' as const;

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `tokenHash` is a HASH, not the token, and `endpointId` is the public id — so
 * neither is a secret that must not travel, but both authenticate to THIS
 * installation and resolve to nothing anywhere else. See webhook-token.ts for
 * why the value moved out. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  endpointId: 'identifier',
  tokenHash: 'identifier',
};

/**
 * The field that is required only in one auth mode —
 * `NODE_CONDITIONAL_REQUIRED_FIELDS` reads this, and through it `arm-check.ts`.
 *
 * The address half is required in `header` mode and MUST NOT exist in
 * `address` mode — see `WebhookTriggerConfig.endpointId`. `fallback: 'header'`
 * is what keeps every diagram saved before the field behaving exactly as it
 * did, and it is inside `whenIn` as the type's own warning requires.
 *
 * The element shape is `ConditionalRequirement` from `catalogue/types.ts`,
 * spelled out rather than imported because this file imports nothing; the
 * registry's own type checks the assignment.
 */
export const conditionalRequirements: readonly {
  readonly decidedBy: string;
  readonly whenIn: readonly string[];
  readonly fallback: string;
  readonly require: string;
  readonly message: string;
}[] = [
  {
    decidedBy: 'auth',
    whenIn: ['header'],
    fallback: 'header',
    require: 'endpointId',
    message:
      'לא נוצרה כתובת. לחצו על יצירת סוד — הכתובת תיווצר יחד איתו ותישאר גלויה.',
  },
];

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The whole JSON the caller sent, under one key. Declared as an object with
 * no properties BECAUSE the shape is the caller's: a fixed field list here
 * would be the hard-coding this node exists to avoid. The picker offers
 * `{{trigger.body}}` and an owner types the path they know they send.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `body` and `query` keys by hand; `references.test.ts` is
 * what catches a template naming a key this list does not declare.
 */
export const outputFields = {
  body: {
    type: 'object',
    label: 'גוף הבקשה',
    description: 'כל מה שנשלח — ניתן לפנות אליו כ-{{trigger.body.שם_השדה}}',
  },
  // Published SEPARATELY rather than folded into `body`. A GET carries no
  // body, and merging its query string into one would make
  // `{{trigger.body.x}}` mean two different things depending on the verb —
  // the confusion n8n avoids by exposing `{ body, headers, params, query }`
  // as distinct members.
  query: {
    type: 'object',
    label: 'פרמטרים בכתובת',
    description: 'ה-query string — ניתן לפנות אליו כ-{{trigger.query.שם_השדה}}',
  },
} as const;
