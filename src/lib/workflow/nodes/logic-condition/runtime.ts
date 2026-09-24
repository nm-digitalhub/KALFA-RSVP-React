// `logic.condition` — the step handler and the comparison it runs. Server side:
// SDK-free, and it imports the shared step contract from `steps/shared`, never
// from `steps/index` (the registry imports this file, so that would be a cycle).
import { readEnum, readString, type StepHandler, type WorkflowTriggerPayload } from '../../steps/shared';

import * as conditionDefinition from './definition';
import {
  CONDITION_BRANCH_HANDLES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  type ConditionConfig,
  type ConditionField,
  type ConditionOperator,
} from './definition';

/**
 * Compare two already-resolved strings.
 *
 * Takes the LEFT-HAND VALUE, not a field name. That is the whole opening: the
 * left side used to be an index into the trigger payload, so a condition could
 * only ever ask about the inbound message. Now `resolveConfigTemplates` has
 * already turned `{{nodes.<id>.value}}` — or any other reference — into text by
 * the time this runs, and this function no longer knows or cares where the
 * string came from.
 */
export function compareValues(
  actual: string,
  operator: ConditionOperator,
  operand: string,
): boolean {
  // Case-insensitive throughout. Hebrew has no case, but a keyword may be Latin
  // ("YES", "ok") and an owner typing one should not have to match the guest's
  // shift key.
  const a = actual.trim().toLowerCase();
  const b = operand.trim().toLowerCase();
  switch (operator) {
    case 'contains':
      // An empty needle would match everything, which is never what an owner
      // who left the box blank meant.
      return b !== '' && a.includes(b);
    case 'not_contains':
      return b === '' || !a.includes(b);
    case 'equals':
      return a === b;
    case 'not_equals':
      return a !== b;
    case 'starts_with':
      return b !== '' && a.startsWith(b);
    case 'ends_with':
      return b !== '' && a.endsWith(b);
    case 'is_empty':
      return a === '';
    case 'is_not_empty':
      return a !== '';
  }
}

/**
 * @deprecated Kept because it is the shape the pre-`left` diagrams evaluate
 * under, and because `dry-run`'s trace and two test files name it. Reads a field
 * off the trigger payload and defers to {@link compareValues}.
 */
export function evaluateCondition(
  field: ConditionField,
  operator: ConditionOperator,
  operand: string,
  trigger: WorkflowTriggerPayload,
): boolean {
  return compareValues(trigger[field] ?? '', operator, operand);
}

// Branches by naming a port. `isEdgeLive` in the runner fires the outgoing edge
// whose `sourceHandle` matches — by `===`, with no normalisation on either side —
// and prunes the rest.
//
// CORRECTED 2026-09-09. This returned 'true' / 'false', and the comment here
// asserted that "the editor's two branches must be drawn with handles 'true' and
// 'false'" as though that were arrangeable. It was not: those strings are not
// handle ids and the editor could never emit one. A node drawn from the palette
// carried a single source handle spelled 'source', so BOTH outgoing edges
// matched neither port, every condition pruned both branches, and the run ended
// `execution_incomplete` with a DeadEnd. The unit tests hand-built their edges
// with `sourceHandle: 'true'` and so agreed with the comment rather than with
// the editor — which is why tsc, eslint, the suite and the build all passed over
// a node type that could not work.
//
// The ports are now `CONDITION_BRANCH_HANDLES`, the same ids the palette seeds
// into `decisionBranches` and the SDK's decision renderer puts on the handles.
//
// Naming a port is still a promise of a live route: if no edge carries that
// handle the run ends `incomplete` with a DeadEnd naming this node. That is the
// intended reading — a condition wired to only one branch genuinely has a dead
// end on the other — and it surfaces to the owner instead of passing silently.

export const condition: StepHandler = async (config, ctx) => {
  const operator = readEnum(config, 'operator', CONDITION_OPERATORS, conditionDefinition.type);
  const operand = readString<ConditionConfig>(config, 'value');

  // `left` arrives ALREADY RESOLVED — `resolveConfigTemplates` walked the whole
  // config before this handler was called — so an owner comparing
  // `{{nodes.<id>.value}}` gets the computed text here, not the reference.
  //
  // Falling back to `field` rather than requiring `left` is what keeps every
  // diagram saved before this working unchanged: those carry a field name and no
  // left-hand expression, and they must keep evaluating identically.
  const left = readString<ConditionConfig>(config, 'left').trim();
  const actual =
    left === ''
      ? (ctx.trigger[readEnum(config, 'field', CONDITION_FIELDS, conditionDefinition.type)] ?? '')
      : left;

  const result = compareValues(actual, operator, operand);
  return {
    output: { result },
    nextPort: result ? CONDITION_BRANCH_HANDLES.true : CONDITION_BRANCH_HANDLES.false,
  };
};
