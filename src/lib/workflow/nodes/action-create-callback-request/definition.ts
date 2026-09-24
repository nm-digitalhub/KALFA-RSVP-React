// `action.create_callback_request`: the pure contract, shared by the editor and
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
export const type = 'action.create_callback_request' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * Ask a human to call this guest back.
 *
 * The escape hatch every automation needs: a workflow that cannot answer a guest
 * should put them in front of a person rather than guess. `action.notify_team`
 * tells the team something happened; this one creates a row in the queue they
 * actually work from, with the guest's name and number already on it.
 *
 * ⚠️ NOT IDEMPOTENT ON ITS OWN — a second row is a second phone call to a real
 * person. The implementation therefore dedupes on an OPEN request for the same
 * phone inside a window, the same rule `console-calls.ts` already applies to
 * missed inbound calls. Without it, a guest who writes twice gets called twice.
 */
export type CreateCallbackRequestConfig = {
  /** What the callback is about — shown to whoever picks it up. */
  topic: string;
  /** Free text, template-resolved. */
  note: string;
};

/**
 * What a guest's callback request is about.
 *
 * ⚠️ CLOSED, AND THE REASON IS WHO GETS CALLED. `topic` is not a label — it is
 * the ROUTER. `enqueueSalesCallDispatch` gates on `topic !== 'מכירות'` and
 * `enqueueMeetingConfirmDispatch` on `topic === 'מכירות'`, so the string decides
 * which ElevenLabs agent dials the person.
 *
 * The node is guest-scoped: `requireGuestContext` refuses it without an event
 * and a contact, and the port reads `guests.full_name` / `guests.phone`. So the
 * person on the other end is always an EVENT GUEST — and `'מכירות'` would put
 * "עומר", the sales-closing agent, on the phone to a wedding guest to sell them
 * KALFA. As free text that was one natural Hebrew word away.
 *
 * Every value here routes to the callback-confirm agent, which is the one whose
 * own prompt describes this exact call: "מתקשר בנוגע לבקשה שלך לשיחה חוזרת".
 * `'מכירות'` is deliberately ABSENT, and refused again in the handler and at
 * arming, because the field lives in a jsonb row that no form re-validates.
 *
 * Declared here, with the rest of the node's contract, because the palette's
 * Select options, the handler's blank-fallback and the portability check all
 * read it. `catalogue/types.ts` re-exports it for every existing reader.
 */
export const CALLBACK_TOPICS = [
  'שאלה על האירוע',
  'שינוי באישור ההגעה',
  'בקשה מיוחדת',
  'אחר',
] as const;
export type CallbackTopic = (typeof CALLBACK_TOPICS)[number];

/**
 * The topic that routes to the SALES agent — never valid from a guest node.
 *
 * Named rather than inlined so the two refusals and the router cannot drift:
 * this is the exact string `enqueueSalesCallDispatch` compares against.
 */
export const SALES_CALLBACK_TOPIC = 'מכירות';

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'topic'];

/** The budget for one call of the handler: one callback-row write through `GuestActionsPort`. */
export const activityProfile = { timeoutMs: 30_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `topic` is a key into a catalogue: the closed `CALLBACK_TOPICS` list compiled
 * into the app, so it travels wherever the same topic exists. Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  topic: 'catalogue',
};

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
 * still writes the same `created` and `reason` keys by hand.
 */
export const outputFields = {
  created: { type: 'boolean', label: 'נוצרה בקשה', description: 'ריק כאשר כבר קיימת בקשה פתוחה' },
  reason: { type: 'string', label: 'סיבה' },
} as const;
