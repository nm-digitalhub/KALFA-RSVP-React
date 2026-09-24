// `logic.condition`: the pure contract, shared by the editor and the server.
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
export const type = 'logic.condition' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

// Trigger fields offered in the condition's dropdown.
//
// This list used to hold two entries and to be the ONLY thing a condition could
// look at, on the reasoning that "an unbounded accessor would invite reaching
// into something that is not there and failing at run time instead of at save
// time". Two things make that reasoning obsolete:
//
//   1. the trigger payload grew from two fields to seven, so the closed set was
//      hiding five values a workflow was already carrying; and
//   2. `resolveConfigTemplates` now runs over every field of every config before
//      the handler sees it, and an unresolvable reference raises
//      `PermanentNodeExecutionError` naming the offending token. The failure the
//      closed set was protecting against is now loud, immediate and specific —
//      which was the only thing wrong with it.
//
// So the dropdown stays as the convenient path and is complete, while `left`
// below opens the door the docs describe: `nodes/conditional.md` specifies X and
// Y as free values that "support referencing data from earlier nodes and the
// trigger payload". A condition can now compare `{{nodes.<id>.value}}` to
// anything, which is what makes multi-step logic expressible at all.
export const CONDITION_FIELDS = [
  'message_text',
  'button_payload',
  'guest_name',
  'event_name',
  'event_date',
  'contactId',
  'eventId',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPERATORS = [
  'contains',
  'not_contains',
  'equals',
  'not_equals',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// Operators that take no right-hand value. Named once, because THREE places have
// to agree — the form's HIDE rule, the handler's evaluation, and any reader
// asking why 'ערך' vanished.
export const UNARY_CONDITION_OPERATORS = ['is_empty', 'is_not_empty'] as const;

// The two outgoing ports of a condition node, as HANDLE IDS.
//
// These strings are a persistence contract twice over, and getting them wrong
// is silent. The runner's `isEdgeLive` fires an outgoing edge only when
// `edge.sourceHandle === nextPort`, compared with `===` and nothing else. So the
// value the handler returns must be, character for character, the id the EDITOR
// wrote on the handle the owner dragged from.
//
// The editor mints handle ids with the SDK's `getHandleId({ handleType, innerId })`,
// documented as returning `<handleType>:inner:<innerId>` for a sub-handle. The
// SDK's own decision branches pass a `crypto.randomUUID()` as `innerId`, but the
// parser accepts any suffix (`/^(source|target):inner:/`), so a FIXED innerId is
// legal and gives us the one thing a UUID cannot: a value the worker can know
// without reading the diagram.
//
// They are spelled out as literals rather than computed, because this module is
// read by the pg-boss worker and must not import @workflowbuilder/sdk.
// `catalogue/branch-handles.test.ts` asserts each literal equals
// `getHandleId(...)` on the SDK side, so if the SDK ever changes the format the test fails rather than the
// workflow.
export const CONDITION_BRANCH_HANDLES = {
  true: 'source:inner:true',
  false: 'source:inner:false',
} as const;

export type ConditionBranchHandle =
  (typeof CONDITION_BRANCH_HANDLES)[keyof typeof CONDITION_BRANCH_HANDLES];

export type ConditionConfig = {
  /**
   * The left-hand side, as a free expression.
   *
   * Empty or absent means "use `field`", which is what every diagram saved
   * before this existed contains — so old workflows keep evaluating exactly as
   * they did, and the fallback is a compatibility path rather than a second way
   * to write a new condition.
   */
  left?: string;
  field: ConditionField;
  operator: ConditionOperator;
  // Unused by the unary operators. Kept optional rather than a union so the
  // property form can show one shape and hide the field with a JSONForms rule.
  value?: string;
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
export const requiredFields: string[] = ['label', 'description', 'field', 'operator'];

/** The budget for one call of the handler. No I/O, so a few seconds is generous. */
export const activityProfile = { timeoutMs: 5_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. Every property here is an author's
 * literal or a closed option (a trigger field name, an operator, the fixed
 * branch handles) and means the same thing in any installation. Declaring `{}`
 * rather than leaving the key out is what lets `node-definitions.test.ts` tell
 * "nothing to bind" from "forgot". Values are `'identifier' | 'secret' |
 * 'catalogue'` — spelled out here rather than imported, because this file
 * imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. Declaring it also makes the
 * shape a deliberate contract: renaming `result` breaks saved workflows, so the
 * name is chosen once and kept. The handler (`runtime.ts`) still writes the same
 * `result` key by hand.
 */
export const outputFields = {
  result: {
    type: 'boolean',
    label: 'תוצאת התנאי',
    description: 'האם התנאי התקיים',
  },
} as const;
