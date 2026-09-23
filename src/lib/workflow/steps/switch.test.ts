import { describe, expect, it } from 'vitest';

import {
  SWITCH_DEFAULT_BRANCH_ID,
  SWITCH_DEFAULT_HANDLE,
  switchBranchHandle,
  type SwitchBranch,
  type SwitchComparisonOperator,
} from '@/lib/workflow/catalogue/types';

import { STEP_HANDLERS, evaluateSwitchBranch, type StepContext } from './index';

// `logic.switch` — N owner-defined branches, each with its own condition rows.
//
// REWRITTEN 2026-09-13 off a fixed `case1/case2/case3` API. The old suite tested
// three string fields; the node now carries the SDK's `DecisionBranches` shape,
// so the branches, their labels, their ports and their conditions all come from
// the diagram.
//
// The port a handler names is the whole behaviour: `isEdgeLive` fires the
// outgoing edge whose sourceHandle matches by `===` and prunes the rest, so a
// wrong port is not a wrong answer — it is a dead end, and the run ends
// `incomplete`. Every test here asserts the PORT, not just the output.
//
// Both sides of every row arrive ALREADY RESOLVED (`resolveConfigTemplates` runs
// first), which is why the fixtures below are literals: by the time this handler
// sees a row, `{{trigger.button_payload}}` is whatever the guest pressed.

const handler = STEP_HANDLERS['logic.switch'];

const ctx = {
  runId: 'run-1',
  workflowId: 'wf-self',
  nodeId: 'node-1',
  trigger: {
    eventId: 'e1',
    contactId: 'c1',
    message_text: '',
    button_payload: '',
  },
  deps: {
    guests: {} as StepContext['deps']['guests'],
    alerts: {} as StepContext['deps']['alerts'],
    // `logic.switch` does no I/O; a port that throws on use proves it.
    webhook: {
      post: async () => {
        throw new Error('logic.switch must not make a request');
      },
    },
    integrations: {} as StepContext['deps']['integrations'],
    accounting: {} as StepContext['deps']['accounting'],
    ai: { run: async () => ({ text: '', costUsd: null, sessionId: null }) },
  },
} satisfies StepContext;

const run = (config: Record<string, unknown>) => handler(config, ctx);

/** One row, defaulting the join to the control's own 'AND'. */
function row(
  x: string,
  comparisonOperator: SwitchComparisonOperator,
  y: string,
  logicalOperator: 'AND' | 'OR' = 'AND',
) {
  return { x, comparisonOperator, y, logicalOperator } as const;
}

/** A branch whose id also names its handle, the way the control mints them. */
function branch(id: string, conditions: SwitchBranch['conditions'], label = id): SwitchBranch {
  return { id, sourceHandle: switchBranchHandle(id), label, conditions };
}

const DEFAULT_BRANCH: SwitchBranch = {
  id: SWITCH_DEFAULT_BRANCH_ID,
  sourceHandle: SWITCH_DEFAULT_HANDLE,
  label: 'אחרת',
  conditions: [],
};

/** The RSVP shape the diagram template ships. */
const RSVP_BRANCHES = (pressed: string): SwitchBranch[] => [
  branch('attending', [row(pressed, 'isEqual', 'rsvp_attending')], 'מגיע/ה'),
  branch('declined', [row(pressed, 'isEqual', 'rsvp_declined')], 'לא מגיע/ה'),
  branch('maybe', [row(pressed, 'isEqual', 'rsvp_maybe')], 'אולי'),
  DEFAULT_BRANCH,
];

describe('logic.switch — routing', () => {
  it('routes each branch to its own port', async () => {
    const cases: Array<[string, string, string]> = [
      ['rsvp_attending', switchBranchHandle('attending'), 'מגיע/ה'],
      ['rsvp_declined', switchBranchHandle('declined'), 'לא מגיע/ה'],
      ['rsvp_maybe', switchBranchHandle('maybe'), 'אולי'],
    ];
    for (const [pressed, port, label] of cases) {
      const r = await run({ decisionBranches: RSVP_BRANCHES(pressed) });
      expect(r.nextPort).toBe(port);
      expect(r.output).toMatchObject({ matched: true, branch: label });
    }
  });

  it('an unmatched value takes the DEFAULT port', async () => {
    // The thing logic.condition cannot express: with two ports that both mean
    // "the test", "none of the above" has to be modelled as false.
    const r = await run({ decisionBranches: RSVP_BRANCHES('משהו חופשי') });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
    expect(r.output).toMatchObject({ matched: false, branch: null });
  });

  it('reports the branch LABEL, so the log names the route a human chose', async () => {
    const r = await run({ decisionBranches: RSVP_BRANCHES('rsvp_declined') });
    expect(r.output).toMatchObject({ branch: 'לא מגיע/ה' });
  });

  it('falls back to the branch id when the owner left the label blank', async () => {
    // The control seeds `label: ''` on every branch it adds, and the canvas then
    // shows "Branch 2". An empty string in the log would name nothing.
    const r = await run({
      decisionBranches: [
        { id: 'b1', sourceHandle: switchBranchHandle('b1'), conditions: [row('x', 'isEqual', 'x')] },
        DEFAULT_BRANCH,
      ],
    });
    expect(r.output).toMatchObject({ branch: 'b1' });
  });

  it('first match wins, in the order the owner sees on the canvas', async () => {
    // Not an error — the second is simply unreachable, which is visible on the
    // canvas rather than hidden in a validation message.
    const r = await run({
      decisionBranches: [
        branch('first', [row('כן', 'isEqual', 'כן')]),
        branch('second', [row('כן', 'isEqual', 'כן')]),
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(switchBranchHandle('first'));
  });

  it('routes to the default when the owner built no branches at all', async () => {
    const r = await run({ decisionBranches: [DEFAULT_BRANCH] });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });
});

describe('logic.switch — a branch with no conditions never matches', () => {
  it('an empty rows array does NOT match', async () => {
    // The control adds every new branch with `conditions: []`. Treating that as
    // "always true" would make a half-built branch swallow every run the moment
    // it was created, and nothing below it could ever fire.
    expect(evaluateSwitchBranch([])).toBe(false);
    const r = await run({
      decisionBranches: [branch('empty', []), DEFAULT_BRANCH],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('an absent rows field does NOT match', async () => {
    expect(evaluateSwitchBranch(undefined)).toBe(false);
    const r = await run({
      decisionBranches: [
        { id: 'bare', sourceHandle: switchBranchHandle('bare'), label: 'bare' },
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('the DEFAULT branch is never evaluated — it is reached by elimination', async () => {
    // It has no conditions, so the rule above would otherwise skip past it and
    // the handler would fall through to the reserved handle instead of the
    // branch the owner actually wired.
    const r = await run({ decisionBranches: [branch('a', [row('x', 'isEqual', 'y')]), DEFAULT_BRANCH] });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });
});

describe('logic.switch — the ten SDK operators', () => {
  const cases: Array<[SwitchComparisonOperator, string, string, boolean]> = [
    ['isEqual', 'כן', 'כן', true],
    ['isEqual', 'כן', 'לא', false],
    ['isNotEqual', 'כן', 'לא', true],
    ['isContaining', 'שלום עולם', 'עולם', true],
    ['isContaining', 'שלום', 'עולם', false],
    ['isNotContaining', 'שלום', 'עולם', true],
    ['isGreaterThan', '5', '3', true],
    ['isGreaterThan', '3', '5', false],
    ['isLessThan', '3', '5', true],
    ['isGreaterThanOrEqual', '5', '5', true],
    ['isLessThanOrEqual', '5', '5', true],
    ['isBefore', '2026-01-01', '2026-06-01', true],
    ['isAfter', '2026-06-01', '2026-01-01', true],
    ['isBefore', '2026-06-01', '2026-01-01', false],
  ];

  it.each(cases)('%s(%s, %s) === %s', async (op, x, y, expected) => {
    const r = await run({
      decisionBranches: [branch('t', [row(x, op, y)]), DEFAULT_BRANCH],
    });
    expect(r.nextPort).toBe(expected ? switchBranchHandle('t') : SWITCH_DEFAULT_HANDLE);
  });

  it('is case-insensitive and trims, exactly like the condition node', async () => {
    // An owner who learns one comparison has learned both.
    const r = await run({
      decisionBranches: [branch('t', [row('  YES  ', 'isEqual', 'yes')]), DEFAULT_BRANCH],
    });
    expect(r.nextPort).toBe(switchBranchHandle('t'));
  });

  it('a numeric comparison on text is FALSE, not NaN', async () => {
    // The alternative is a branch chosen by an accident of coercion. "No" sends
    // the run to the default, where a person put something deliberate.
    const r = await run({
      decisionBranches: [branch('t', [row('שלום', 'isGreaterThan', '3')]), DEFAULT_BRANCH],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('an unparseable date is FALSE, not a coin flip', async () => {
    const r = await run({
      decisionBranches: [branch('t', [row('מחר', 'isBefore', '2026-06-01')]), DEFAULT_BRANCH],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('an operator the SDK does not ship matches nothing', async () => {
    // config arrives from a jsonb column; the schema constrains the form, not
    // the row. An unknown operator must be inert rather than throwing mid-run.
    const r = await run({
      decisionBranches: [
        { id: 't', sourceHandle: switchBranchHandle('t'), conditions: [{ x: 'a', y: 'a', comparisonOperator: 'isRoughly', logicalOperator: 'AND' }] },
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });
});

describe('logic.switch — the AND/OR join is ONE per branch, read off row 0', () => {
  // ⚠️ THE TEST THIS SECTION EXISTS FOR.
  //
  // MEASURED in the shipped control: the picker renders with
  // `shouldShowOperator: index === 0 && lastIndex !== 0` and writes to that row
  // alone; every row the owner adds carries the module default 'AND' forever.
  // An earlier version of the handler folded over each row's own field, which
  // read 'AND' off row 2 and quietly ANDed a branch the owner set to OR.
  //
  // Each fixture below therefore sets OR on row 0 and leaves 'AND' on row 1 —
  // exactly what the control persists — and asserts the OR is honoured.

  const TRUE = row('כן', 'isEqual', 'כן');
  const FALSE = row('כן', 'isEqual', 'לא');

  it('OR on row 0 matches when only the SECOND row is true', async () => {
    const r = await run({
      decisionBranches: [
        branch('t', [{ ...FALSE, logicalOperator: 'OR' }, TRUE]),
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(switchBranchHandle('t'));
  });

  it('OR on row 0 matches when only the FIRST row is true', async () => {
    const r = await run({
      decisionBranches: [
        branch('t', [{ ...TRUE, logicalOperator: 'OR' }, FALSE]),
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(switchBranchHandle('t'));
  });

  it('OR does not match when every row is false', async () => {
    expect(evaluateSwitchBranch([{ ...FALSE, logicalOperator: 'OR' }, FALSE])).toBe(false);
  });

  it('AND requires EVERY row, however many', async () => {
    expect(evaluateSwitchBranch([TRUE, TRUE, TRUE])).toBe(true);
    expect(evaluateSwitchBranch([TRUE, TRUE, FALSE])).toBe(false);
    expect(evaluateSwitchBranch([FALSE, TRUE, TRUE])).toBe(false);
  });

  it("row 1's operator is IGNORED — it is inert in the control", async () => {
    // The proof that the fold is gone. Under the old code this pair read OR off
    // row 1 and matched; under the control's real semantics the branch is AND
    // (row 0 says so) and must NOT match.
    expect(evaluateSwitchBranch([TRUE, { ...FALSE, logicalOperator: 'OR' }])).toBe(false);
  });

  it('a missing operator on row 0 is AND, the control’s own default', async () => {
    const noJoin = { x: 'כן', comparisonOperator: 'isEqual' as const, y: 'כן' };
    expect(evaluateSwitchBranch([noJoin as never, FALSE])).toBe(false);
    expect(evaluateSwitchBranch([noJoin as never, TRUE])).toBe(true);
  });
});

describe('logic.switch — it never names a port the diagram does not carry', () => {
  it('every reachable port comes from a declared branch', async () => {
    const branches = RSVP_BRANCHES('rsvp_maybe');
    const declared = new Set(branches.map((b) => b.sourceHandle));
    for (const pressed of ['rsvp_attending', 'rsvp_declined', 'rsvp_maybe', 'אחר', '', '   ']) {
      const r = await run({ decisionBranches: RSVP_BRANCHES(pressed) });
      expect(declared.has(String(r.nextPort))).toBe(true);
    }
  });

  it('a diagram whose default branch was DELETED still names the reserved handle', async () => {
    // Rather than dead-ending with no explanation. The owner can delete the
    // default card; the run still has somewhere to go, and an unwired handle is
    // visible on the canvas.
    const r = await run({ decisionBranches: [branch('only', [row('a', 'isEqual', 'b')])] });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('a config with no decisionBranches at all routes to the reserved handle', async () => {
    expect((await run({})).nextPort).toBe(SWITCH_DEFAULT_HANDLE);
    expect((await run({ decisionBranches: 'לא מערך' })).nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('a branch missing its sourceHandle is dropped rather than routed to undefined', async () => {
    const r = await run({
      decisionBranches: [
        { id: 'broken', conditions: [row('a', 'isEqual', 'a')] },
        DEFAULT_BRANCH,
      ],
    });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });
});
