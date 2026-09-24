// `logic.wait`: the pure contract, shared by the editor and the server.
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
export const type = 'logic.wait' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `logic.wait` — the run stops here and comes back later.
 *
 * A DURATION, not a wall-clock time, and that is the smaller of the two useful
 * shapes: "three days after this point in the flow" composes with any trigger,
 * while "next Tuesday at 9" only makes sense against a calendar and belongs to
 * the schedule trigger instead.
 *
 * MINUTES IS THE FLOOR. Anything shorter is not a wait an owner can reason
 * about — the queue's own delivery jitter is measured in seconds — and offering
 * seconds would invite a flow that parks and wakes hundreds of times a day.
 */
export const WAIT_UNIT_VALUES = ['minutes', 'hours', 'days'] as const;
export type WaitUnitValue = (typeof WAIT_UNIT_VALUES)[number];

export type WaitConfig = {
  amount: number;
  unit: WaitUnitValue;
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
export const requiredFields: string[] = ['label', 'description', 'amount', 'unit'];

/**
 * Numeric bounds — `NODE_NUMBER_RANGES` reads this, and through it both the
 * editor schema (`schema.ts` spreads `amount`) and `arm-check.ts`.
 *
 * `minimum: 1` is the form's and the arming gate's half of the guard; the
 * handler refuses a non-positive value again, because the schema constrains
 * what can be TYPED and not what is in the jsonb row.
 *
 * The value shape is `NODE_NUMBER_RANGES`' own, spelled out rather than
 * imported because this file imports nothing; the registry's type checks the
 * assignment.
 */
export const numberRanges: { amount: { minimum?: number; maximum?: number } } = {
  amount: { minimum: 1 },
};

/**
 * The budget for one call of the handler. It computes a deadline and throws the
 * park signal — no I/O — so a few seconds is generous. The WAIT itself is a
 * park, not a call, and is not bounded by this.
 */
export const activityProfile = { timeoutMs: 5_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. `amount` and `unit` are a duration, which
 * means the same thing in any installation. Declaring `{}` rather than leaving
 * the key out is what lets `node-definitions.test.ts` tell "nothing to bind"
 * from "forgot". Values are `'identifier' | 'secret' | 'catalogue'` — spelled
 * out here rather than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * returns nothing on its first pass — it throws the park signal — and on resume
 * writes `waited` and `resumed` by hand. `resumed` is written but was never
 * declared; it stays undeclared because adding it would change what the
 * variable picker offers.
 */
export const outputFields = {
  waited: { type: 'boolean', label: 'ההמתנה הסתיימה' },
} as const;
