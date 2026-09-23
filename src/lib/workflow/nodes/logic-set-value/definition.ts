// `logic.set_value`: the pure contract, shared by the editor and the server.
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
export const type = 'logic.set_value' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

// Compute a value and hand it to later steps.
//
// This node does no I/O at all, and that is exactly why it is worth having.
// Every field of every node now passes through `resolveConfigTemplates`, so
// `value` can be any mixture of literal text and `{{…}}` references — and its
// OUTPUT is readable downstream as `{{nodes.<id>.value}}`.
//
// That turns the resolver from a substitution feature into a composition one:
// build a greeting once, reuse it in three branches; or normalise something
// awkward in one visible place on the canvas instead of repeating the same
// expression in every message body. It is n8n's `Set` node, minus the parts
// that need a runtime we do not have.
export type SetValueConfig = {
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
export const requiredFields: string[] = ['label', 'description', 'value'];

/** The budget for one call of the handler. No I/O, so a few seconds is generous. */
export const activityProfile = { timeoutMs: 5_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. `value` is an author's literal (it is
 * reviewed as portable in `portability-coverage.test.ts`, by property name, for
 * every node that has one). Declaring `{}` rather than leaving the key out is
 * what lets `node-definitions.test.ts` tell "nothing to bind" from "forgot".
 * Values are `'identifier' | 'secret' | 'catalogue'` — spelled out here rather
 * than imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `value` key by hand; `references.test.ts` is what
 * catches a template naming a key this list does not declare.
 */
export const outputFields = {
  value: { type: 'string', label: 'הערך', description: 'הערך שחושב' },
} as const;
