// `action.set_guest_field`: the pure contract, shared by the editor and the server.
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
export const type = 'action.set_guest_field' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * The guest fields a workflow may write, and the three that are deliberately absent.
 *
 * NOT `status` — `action.update_guest_status` owns it, and it goes through the
 * atomic `submit_rsvp` gate rather than a column write, so no RSVP rule is ever
 * reimplemented in a step.
 *
 * NOT the headcount columns (`expected_count`, `confirmed_adults`,
 * `confirmed_kids`, `confirmed_headcount`). They are derived together by the same
 * RPC; writing one of them directly produces a row whose numbers disagree with
 * each other, and nothing downstream would notice.
 *
 * NOT `phone` or `full_name` — identity. A workflow that could rewrite the phone
 * could silently redirect every future send for that guest.
 *
 * ⚠️ `note` AND `rsvp_note` ARE DIFFERENT FIELDS AND THE DIFFERENCE IS A PRIVACY
 * ONE. `guests.note` is the OWNER's internal annotation and is never shown to the
 * guest; `rsvp_note` is what the guest themself wrote, and the public RSVP page
 * renders it. Writing a guest's words into `note` hides them from the guest's own
 * view; writing an internal remark into `rsvp_note` shows the owner's private note
 * to the guest. Both labels in `schema.ts` (`guestFieldOptions`) say which is which.
 *
 * Declared here rather than beside the handler because the palette's Select
 * options, the handler's `readEnum` guard and the port the write crosses all have
 * to agree on it, and this module is the one they can all import (it pulls in
 * nothing, so the worker can bundle it). `catalogue/types.ts` re-exports both for
 * the `GuestActionsPort` in engine/ports.ts and every other existing reader.
 */
export const GUEST_FIELDS = ['meal_pref', 'rsvp_note', 'note'] as const;
export type GuestField = (typeof GUEST_FIELDS)[number];

/**
 * Set one guest field on the contact that started this run.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is what makes it a legal action node at all:
 * `StepClaim`'s lease can replay a step whose side effect completed, and writing
 * the same value to the same column twice is the same row. See engine/ports.ts.
 */
export type SetGuestFieldConfig = {
  field: GuestField;
  /** Free text, template-resolved — so it can carry `{{trigger.message.text}}`. */
  value: string;
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
export const requiredFields: string[] = ['label', 'description', 'field'];

/** The budget for one call of the handler: one guest-row write through `GuestActionsPort`. */
export const activityProfile = { timeoutMs: 20_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. `field` is a closed list compiled into
 * the app and `value` is an author's literal, so both mean the same thing in any
 * installation. Declaring `{}` rather than leaving the key out is what lets
 * `node-definitions.test.ts` tell "nothing to bind" from "forgot". Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
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
 * still writes the same `updated`, `field` and `guestId` keys by hand.
 */
export const outputFields = {
  updated: { type: 'boolean', label: 'עודכן', description: 'ריק כאשר למספר יותר מאורח אחד' },
  field: { type: 'string', label: 'השדה שעודכן' },
  guestId: { type: 'string', label: 'מזהה האורח' },
} as const;
