// `action.start_rsvp_ai_callback`: the pure contract, shared by the editor and
// the server.
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
export const type = 'action.start_rsvp_ai_callback' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

// Starts the existing RSVP voice agent through KALFA's production dispatcher.
// Agent/provider/model/knowledge configuration deliberately lives outside the diagram.
export type StartRsvpAiCallbackConfig = Record<string, unknown>;

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description'];

/**
 * The budget for one call of the handler: one dispatch through
 * `GuestActionsPort`. It starts the call and returns; the conversation itself
 * is asynchronous and reported later through the ElevenLabs webhook.
 */
export const activityProfile = { timeoutMs: 60_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. The node carries no business fields: the
 * agent, provider, model and knowledge base are configured outside the diagram,
 * so nothing here names a row or a resource. Declaring `{}` rather than leaving
 * the key out is what lets `node-definitions.test.ts` tell "nothing to bind" from
 * "forgot". Values are `'identifier' | 'secret' | 'catalogue'` — spelled out here
 * rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * Refuses to run outside a run about a GUEST: the handler calls
 * `requireGuestContext`, and `GUEST_SCOPED_NODE_TYPES` lists this type so arming
 * refuses it under a trigger that never supplies one.
 */
export const guestScoped = true;

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * writes `started`, `status`, `attemptId` and `callSessionHistoryId` by hand
 * (the last two only when the dispatcher returns them). `reason` is declared
 * but never produced: a refused dispatch throws instead of returning. It stays
 * declared because removing it would change what the variable picker offers.
 */
export const outputFields = {
  started: { type: 'boolean', label: 'הופעלה' },
  status: { type: 'string', label: 'סטטוס הפעלה' },
  reason: { type: 'string', label: 'סיבה' },
  attemptId: { type: 'string', label: 'מזהה ניסיון שיחה' },
  callSessionHistoryId: { type: 'number', label: 'מזהה שיחת Voximplant' },
} as const;
