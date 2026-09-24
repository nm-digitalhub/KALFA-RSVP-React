// `action.start_for_each_guest`: the pure contract, shared by the editor and the
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
export const type = 'action.start_for_each_guest' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `action.start_for_each_guest` — fan a run out, one per matching guest.
 *
 * ⚠️ CHILD RUNS, NOT A LOOP, and that is the design decision worth defending.
 * A loop inside one run would need a nested executor the vendored `runGraph`
 * does not have. A run per guest reuses the engine exactly as it stands: each
 * child gets its own step ledger, its own retries and its own log, so one guest
 * whose message fails does not stop the other 299 — and each child is already
 * a run that guest-touching nodes work inside, because it carries a contact.
 *
 * ⚠️ AND IT IS THE MOST DANGEROUS NODE IN THE PALETTE. One press can start
 * hundreds of runs that each message a real person. `maxGuests` is therefore
 * REQUIRED with no generous default, and the dry run prints the number before
 * anything is armed.
 */
export const GUEST_FILTER_STATUSES = ['pending', 'attending', 'declined', 'maybe'] as const;
export type GuestFilterStatus = (typeof GUEST_FILTER_STATUSES)[number];

export type ForEachGuestConfig = {
  /** The workflow to start for each guest. Must be a different workflow. */
  targetWorkflowId: string;
  /** RSVP statuses to include. Empty or absent: every status. */
  statuses?: GuestFilterStatus[];
  /** Only guests who have a phone. Default true — a run about a guest we cannot reach is noise. */
  requirePhone?: boolean;
  /** Hard ceiling. Required; the node refuses without it. */
  maxGuests: number;
};

/**
 * The most guests one fan-out may ever start runs for, whatever the config says.
 *
 * A SECOND ceiling above the owner's own, because `maxGuests` is a field in a
 * jsonb row: the form constrains what can be typed and not what is there. This
 * one is in code and cannot be edited from a browser.
 */
export const FAN_OUT_HARD_CAP = 500;

/**
 * How many fan-outs deep a chain may go before the next generation is refused.
 *
 * ⚠️ WHY A DEPTH CAP AND NOT ONLY A SELF-CHECK. Refusing a workflow that fans
 * out to ITSELF stops the obvious shape and nothing else: W1 → W2 → W1 is the
 * same exponential with one more hop, and no single node in it points at its own
 * workflow. Depth is the property that actually bounds the tree; "self" is just
 * its shortest cycle.
 *
 * The arithmetic is the reason this matters. `FAN_OUT_HARD_CAP` bounds the
 * WIDTH of one generation, never the number of generations — and the child
 * dedupe key is `fanout:${parentRunId}:${nodeId}:${contactId}`, whose parent run
 * id is NEW in every generation, so it does not stop the next one either. With a
 * cap of 10 per level an unbounded chain is 10 → 100 → 1,000 → 10,000 runs, and
 * every leaf may message a real guest.
 *
 * A run nobody fanned out to is depth 0, so 3 permits three generations of
 * children and refuses the fourth. Chosen with the owner on 2026-09-14; no real
 * flow needs more, and a chain that does is better stopped and read than run.
 */
export const MAX_FANOUT_DEPTH = 3;

/**
 * The properties this node cannot run without.
 *
 * ⚠️ ONE ARRAY, TWO READERS, AND IT MUST STAY THE SAME OBJECT. The editor's
 * `schema.ts` uses it as the JSON schema's `required`, and `NODE_REQUIRED_FIELDS`
 * uses it as the arming contract. `arm-check.test.ts` asserts the two are
 * identical with `toBe`, so both point here rather than holding a copy.
 * Mutable (`string[]`), because that is the type `NODE_REQUIRED_FIELDS` declares.
 */
export const requiredFields: string[] = ['label', 'description', 'targetWorkflowId', 'maxGuests'];

/**
 * Numeric bounds — `NODE_NUMBER_RANGES` reads this, and through it both the
 * editor schema (`schema.ts` spreads `maxGuests`) and `arm-check.ts`.
 *
 * `maxGuests` is the one that matters: a cap of zero reaches nobody and a cap
 * above the hard cap is clamped anyway, so the form, the arming gate and the
 * handler all say the same thing.
 *
 * The value shape is `NODE_NUMBER_RANGES`' own, spelled out rather than
 * imported because this file imports nothing; the registry's type checks the
 * assignment.
 */
export const numberRanges: { maxGuests: { minimum?: number; maximum?: number } } = {
  maxGuests: { minimum: 1, maximum: FAN_OUT_HARD_CAP },
};

/**
 * The budget for one call of the handler. It walks a guest list and writes many
 * rows — minutes, legitimately.
 */
export const activityProfile = { timeoutMs: 300_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * `targetWorkflowId` is a `workflows.id` uuid, which resolves to nothing in
 * any other installation. Values are `'identifier' | 'secret' | 'catalogue'` —
 * spelled out here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {
  targetWorkflowId: 'identifier',
};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * writes these keys by hand: `started`, `matched` and `capped` on success,
 * `started` and `reason` on the error branch.
 */
export const outputFields = {
  started: { type: 'number', label: 'כמה הרצות התחילו' },
  matched: { type: 'number', label: 'כמה אורחים התאימו' },
  capped: { type: 'boolean', label: 'נעצר בתקרה', description: 'היו יותר אורחים מהתקרה' },
  // The same gap as `action.import_guest_list`: the error branch returns
  // `{ started: 0, reason }`, `reason` was never published, and the
  // weekly-sweep starter referenced it as `{{…reason?}}` from the source
  // rather than from the picker.
  reason: { type: 'string', label: 'סיבת הכישלון', description: 'קיים רק במסלול "נכשל"' },
} as const;
