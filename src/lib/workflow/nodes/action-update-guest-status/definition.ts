// `action.update_guest_status`: the pure contract, shared by the editor and the
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
export const type = 'action.update_guest_status' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * Set the RSVP of the guest behind this run's contact.
 *
 * `rsvpStatus` is `RsvpStatus` from `@/lib/constants`, spelled out here rather
 * than imported, because this file imports nothing. `catalogue/types.ts` pins
 * the two against each other at compile time, so they cannot drift apart.
 */
export type UpdateGuestStatusConfig = {
  // `rsvpStatus`, not `status`: the SDK reserves `status` for the node's own
  // Active / Draft / Disabled lifecycle. See the schema for the full note.
  rsvpStatus: 'attending' | 'declined' | 'maybe';
};

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'rsvpStatus'];

/** The budget for one call of the handler: one `submit_rsvp` through `GuestActionsPort`. */
export const activityProfile = { timeoutMs: 20_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. `rsvpStatus` is a closed list compiled
 * into the app, so it means the same thing in any installation. Declaring `{}`
 * rather than leaving the key out is what lets `node-definitions.test.ts` tell
 * "nothing to bind" from "forgot". Values are `'identifier' | 'secret' |
 * 'catalogue'` — spelled out here rather than imported, because this file
 * imports nothing.
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
 * still writes the same `guestId` and `status` keys by hand.
 */
export const outputFields = {
  guestId: { type: 'string', label: 'מזהה האורח', description: 'האורח שעודכן' },
  status: { type: 'string', label: 'הסטטוס שנקבע' },
} as const;
