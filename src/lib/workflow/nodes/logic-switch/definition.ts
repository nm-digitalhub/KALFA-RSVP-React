// `logic.switch`: the pure contract, shared by the editor and the server.
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
export const type = 'logic.switch' as const;

/** Not a trigger. The catalogue, not the stored JSON, decides who may start. */
export const isTrigger = false;

/**
 * `logic.switch` — N named branches, each with its own conditions.
 *
 * REBUILT 1:1 ON THE SDK'S OWN `DecisionBranches` CONTROL (2026-09-13). The first
 * version hard-coded three cases and a default because I had not read far enough:
 * the SDK ships a composer that gives the owner add / remove / reorder / rename
 * over the branch list, and `ArrayFieldSchema` to declare it. The ceiling was
 * mine, not the package's.
 *
 * The operators below are the SDK's own `comparisonsOperators`, copied as
 * literals rather than imported — this module is read by the pg-boss worker and
 * must not load `@workflowbuilder/sdk`. `branch-handles.test.ts` pins them
 * against the package so a drift fails a test rather than a live workflow.
 */
export const SWITCH_COMPARISON_OPERATORS = [
  'isEqual',
  'isNotEqual',
  'isGreaterThan',
  'isLessThan',
  'isLessThanOrEqual',
  'isGreaterThanOrEqual',
  'isContaining',
  'isNotContaining',
  'isBefore',
  'isAfter',
] as const;
export type SwitchComparisonOperator = (typeof SWITCH_COMPARISON_OPERATORS)[number];

/**
 * The SDK's `LogicalOperator`, joining the rows within ONE branch.
 *
 * ONE per branch, not one per join: the control renders its picker on the first
 * row only (measured — see `evaluateSwitchBranch`), so `conditions[0]` is the
 * only authoritative copy and the field on later rows is inert.
 */
export const SWITCH_LOGICAL_OPERATORS = ['AND', 'OR'] as const;
export type SwitchLogicalOperator = (typeof SWITCH_LOGICAL_OPERATORS)[number];

/**
 * One condition row, exactly the SDK's `DynamicCondition`.
 *
 * `x` and `y` are free values — literal text or `{{…}}` references — and both
 * arrive ALREADY RESOLVED, because `resolveConfigTemplates` walks the whole
 * config before the handler runs. That is what an earlier note (quoted, and
 * retracted, in `nodes/logic-condition/logic-condition.ts`) said we could not do ("their conditions resolve through resolveTemplate, which
 * we did not vendor"); resolve-template IS vendored and wired, so the reason is
 * gone and the control can be exposed as designed.
 */
export type SwitchCondition = {
  x: string;
  comparisonOperator: SwitchComparisonOperator;
  y: string;
  logicalOperator: SwitchLogicalOperator;
};

/**
 * One branch: a handle, a label and the rows that select it.
 *
 * `sourceHandle` is minted by the EDITOR through `getHandleId`, so unlike the
 * fixed three-case version the worker cannot know the ports in advance — it
 * reads them from the branch the conditions selected. That is the whole reason
 * this shape can be dynamic at all.
 */
export type SwitchBranch = {
  id: string;
  sourceHandle: string;
  label?: string;
  conditions?: SwitchCondition[];
};

/**
 * The DEFAULT port — fired when no branch matched.
 *
 * Seeded by the palette and NOT removable from the control, because "none of the
 * above" is the one route that must always exist: without it an unmatched value
 * names no port, `isEdgeLive` prunes every edge, and the run ends `incomplete`
 * with a dead end rather than going somewhere a person chose.
 */
export const SWITCH_DEFAULT_HANDLE = 'source:inner:default';
export const SWITCH_DEFAULT_BRANCH_ID = 'default';

/**
 * The handle id a branch of `id` draws, spelled once.
 *
 * This is the SDK's `getHandleId({ handleType: 'source', innerId })` output —
 * reproduced as a string template rather than imported, because this module is
 * read by the pg-boss worker and must not load `@workflowbuilder/sdk`.
 * `branch-handles.test.ts` pins the two against each other, so a change in the
 * SDK's format fails a test instead of silently orphaning every seeded branch.
 *
 * Branches the OWNER adds get theirs minted by the control in this same shape;
 * this exists for the ones WE seed (the palette default, the diagram templates).
 */
export function switchBranchHandle(branchId: string): string {
  return `source:inner:${branchId}`;
}

export type SwitchConfig = {
  /**
   * An optional convenience value the owner may fill in and reference from a
   * row. The handler never reads it — each row compares its own `x` — which is
   * why it is not in `requiredFields` (see `uischema.ts`).
   */
  left?: string;
  /** Read by the SDK's node renderer AND by the handler. One array, one truth. */
  decisionBranches: SwitchBranch[];
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
 * Only the identity fields: `left` is a convenience the handler never reads,
 * which is why it left this list (see `uischema.ts`).
 */
export const requiredFields: string[] = ['label', 'description'];

/** The budget for one call of the handler. No I/O, so a few seconds is generous. */
export const activityProfile = { timeoutMs: 5_000 };

/**
 * Properties whose values point into THIS installation and are blanked on
 * export — `NODE_DEPLOYMENT_BINDINGS` reads this.
 *
 * EMPTY, AND DECLARED EMPTY ON PURPOSE. Every property here is an author's
 * literal (the `left` value, each row's `x` and `y`), a closed SDK operator, or a
 * branch handle minted in the diagram itself, and means the same thing in any
 * installation. Declaring `{}` rather than leaving the key out is what lets
 * `node-definitions.test.ts` tell "nothing to bind" from "forgot". Values are
 * `'identifier' | 'secret' | 'catalogue'` — spelled out here rather than
 * imported, because this file imports nothing.
 */
export const deploymentBindings: Readonly<Record<string, 'identifier' | 'secret' | 'catalogue'>> = {};

/**
 * What the handler returns, as the variable picker offers it.
 *
 * The palette entry's `outputSchema.properties` is built from this, so the
 * picker has one declaration of the node's output. The handler (`runtime.ts`)
 * still writes the same `matched` / `branch` keys by hand.
 */
export const outputFields = {
  matched: { type: 'boolean', label: 'נמצאה התאמה', description: 'האם תנאי כלשהו התקיים' },
  // A NAME now, not a number. With N owner-named branches "מסלול 3" is not
  // a fact the node knows; the label the owner typed is.
  branch: { type: 'string', label: 'שם המסלול שנבחר', description: 'ריק כאשר נבחרה ברירת המחדל' },
} as const;
