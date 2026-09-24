// `logic.switch` — the step handler and the branch evaluators it runs. Server
// side: SDK-free, and it imports the shared step contract from `steps/shared`,
// never from `steps/index` (the registry imports this file, so that would be a
// cycle).
import type { StepHandler } from '../../steps/shared';

import {
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
  type SwitchBranch,
  type SwitchCondition,
} from './definition';

// N named branches, each with its own conditions — the SDK's `DecisionBranches`
// shape, evaluated here.
//
// REBUILT 2026-09-13. The first version hard-coded three cases plus a default,
// on the reasoning that "the WORKER would have to discover the port list from
// the diagram". It does discover it — from the branch the conditions selected —
// and that is not a hazard, it is how a dynamic switch has to work. The SDK
// ships the composer; the ceiling was mine.
//
// FIRST MATCH WINS, top to bottom, which is the order the owner sees on the
// canvas. A branch with no conditions never matches (it would otherwise swallow
// everything below it); the DEFAULT branch is selected by ELIMINATION, not by a
// condition, which is why it needs none.
//
// Both sides of every row arrive ALREADY RESOLVED — `resolveConfigTemplates`
// walked the whole config first — so `x` and `y` can each be a literal, a
// `{{trigger.…}}` or a `{{nodes.…}}`, and this function never knows which.

function readBranches(config: Record<string, unknown>): SwitchBranch[] {
  const raw = config.decisionBranches;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (b): b is SwitchBranch =>
      typeof b === 'object' && b !== null && typeof (b as SwitchBranch).sourceHandle === 'string',
  );
}

/** One row. The operator set is the SDK's own; nothing else is accepted. */
export function evaluateSwitchCondition(row: SwitchCondition): boolean {
  const x = typeof row.x === 'string' ? row.x.trim() : '';
  const y = typeof row.y === 'string' ? row.y.trim() : '';
  const lower = (v: string) => v.toLowerCase();

  switch (row.comparisonOperator) {
    case 'isEqual':
      return lower(x) === lower(y);
    case 'isNotEqual':
      return lower(x) !== lower(y);
    case 'isContaining':
      return lower(x).includes(lower(y));
    case 'isNotContaining':
      return !lower(x).includes(lower(y));
    // Numeric comparisons on non-numbers are FALSE rather than NaN-propagating:
    // an owner comparing text with `isGreaterThan` gets "no" and takes the
    // default, instead of a branch chosen by an accident of coercion.
    case 'isGreaterThan':
    case 'isLessThan':
    case 'isGreaterThanOrEqual':
    case 'isLessThanOrEqual': {
      const a = Number(x);
      const b = Number(y);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (row.comparisonOperator === 'isGreaterThan') return a > b;
      if (row.comparisonOperator === 'isLessThan') return a < b;
      if (row.comparisonOperator === 'isGreaterThanOrEqual') return a >= b;
      return a <= b;
    }
    // Dates. Same rule: unparseable is FALSE, never a coin flip.
    case 'isBefore':
    case 'isAfter': {
      const a = Date.parse(x);
      const b = Date.parse(y);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return row.comparisonOperator === 'isBefore' ? a < b : a > b;
    }
    default:
      return false;
  }
}

/**
 * The rows of ONE branch, joined by a SINGLE operator read off `conditions[0]`.
 *
 * ⚠️ NOT a per-row fold, and the first version here was wrong about this.
 *
 * MEASURED in the shipped control (`dist/index-CEBfv0NZ.js`): the AND/OR picker
 * is rendered with `shouldShowOperator: index === 0 && lastIndex !== 0` — so it
 * appears on the FIRST row only, and only once a second row exists. Its onChange
 * writes `logicalOperator` to that row alone; adding a row appends the module
 * default `{ …, logicalOperator: 'AND' }`, and no code path back-fills the
 * choice onto siblings. Rows 1..n therefore carry a stale `'AND'` FOREVER,
 * whatever the owner picked.
 *
 * So there is one operator per branch, not one per join, and the control says as
 * much in words: its two labels are `conditions.compare.all` ("all") and
 * `conditions.compare.one` ("one"). A fold over each row's own field would have
 * read 'AND' from row 2 and quietly ANDed a branch the owner set to OR — a
 * misroute with nothing on screen to explain it.
 *
 * ALL → every row must hold. ONE → any row is enough.
 */
export function evaluateSwitchBranch(conditions: SwitchCondition[] | undefined): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;

  // `?? 'AND'` is the control's own default, for a row saved before the picker
  // was ever touched.
  const join = conditions[0]?.logicalOperator ?? 'AND';
  return join === 'OR'
    ? conditions.some(evaluateSwitchCondition)
    : conditions.every(evaluateSwitchCondition);
}

export const switchNode: StepHandler = async (config) => {
  const branches = readBranches(config);

  for (const branch of branches) {
    // The default is chosen by elimination below, never by evaluation — it has
    // no conditions and must not be skipped past by an empty-conditions rule.
    if (branch.id === SWITCH_DEFAULT_BRANCH_ID) continue;
    if (evaluateSwitchBranch(branch.conditions)) {
      return {
        output: { matched: true, branch: branch.label ?? branch.id },
        nextPort: branch.sourceHandle,
      };
    }
  }

  // The declared default if the owner kept it, otherwise the reserved handle —
  // so a diagram whose default branch was deleted still names a port rather
  // than dead-ending with no explanation.
  const fallback =
    branches.find((b) => b.id === SWITCH_DEFAULT_BRANCH_ID)?.sourceHandle ??
    SWITCH_DEFAULT_HANDLE;

  return { output: { matched: false, branch: null }, nextPort: fallback };
};
