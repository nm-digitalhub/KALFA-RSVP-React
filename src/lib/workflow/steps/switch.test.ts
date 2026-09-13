import { describe, expect, it } from 'vitest';

import {
  SWITCH_CASE_HANDLES,
  SWITCH_DEFAULT_HANDLE,
} from '@/lib/workflow/catalogue/types';

import { STEP_HANDLERS, type StepContext } from './index';

// `logic.switch` — three named cases and a default.
//
// The port a handler names is the whole behaviour: `isEdgeLive` fires the
// outgoing edge whose sourceHandle matches by `===` and prunes the rest, so a
// wrong port is not a wrong answer — it is a dead end, and the run ends
// `incomplete`. Every test here asserts the PORT, not just the output.

const handler = STEP_HANDLERS['logic.switch'];

const ctx = {
  runId: 'run-1',
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
  },
} satisfies StepContext;

const run = (config: Record<string, unknown>) => handler(config, ctx);

const THREE = { case1: 'כן', case2: 'לא', case3: 'אולי' };

describe('logic.switch — routing', () => {
  it('routes each case to its own port, in order', async () => {
    const cases: Array<[string, string]> = [
      ['כן', SWITCH_CASE_HANDLES[0]],
      ['לא', SWITCH_CASE_HANDLES[1]],
      ['אולי', SWITCH_CASE_HANDLES[2]],
    ];
    for (const [left, port] of cases) {
      const r = await run({ left, ...THREE });
      expect(r.nextPort).toBe(port);
      expect(r.output).toMatchObject({ matched: true });
    }
  });

  it('an unmatched value takes the DEFAULT port', async () => {
    // The thing logic.condition cannot express: with two ports that both mean
    // "the test", "none of the above" has to be modelled as false.
    const r = await run({ left: 'משהו אחר', ...THREE });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
    expect(r.output).toMatchObject({ matched: false, case: null });
  });

  it('reports WHICH case matched, so the log explains the route', async () => {
    expect((await run({ left: 'לא', ...THREE })).output).toMatchObject({
      matched: true,
      case: 2,
      value: 'לא',
    });
  });

  it('first match wins when two cases carry the same text', async () => {
    // Not an error — the second is simply unreachable, which is visible on the
    // canvas rather than hidden in a validation message.
    const r = await run({ left: 'כן', case1: 'כן', case2: 'כן', case3: '' });
    expect(r.nextPort).toBe(SWITCH_CASE_HANDLES[0]);
  });
});

describe('logic.switch — an empty case is an unused branch', () => {
  it('an empty value does NOT match an empty case field', async () => {
    // The defect this prevents: with empty treated as a match, a switch with one
    // case filled in would send every empty value to case 2 and the default
    // could never be reached.
    const r = await run({ left: '', case1: 'כן', case2: '', case3: '' });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('a switch with no cases at all routes everything to the default', async () => {
    const r = await run({ left: 'כלשהו', case1: '', case2: '', case3: '' });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('a gap between cases does not shift the ports', async () => {
    // case2 empty must not promote case3 into case 2's handle — the handle is
    // the position on the canvas, and the owner wired an edge to it.
    const r = await run({ left: 'ג', case1: 'א', case2: '', case3: 'ג' });
    expect(r.nextPort).toBe(SWITCH_CASE_HANDLES[2]);
    expect(r.output).toMatchObject({ case: 3 });
  });
});

describe('logic.switch — matching follows the condition node’s rules', () => {
  it('is case-insensitive and trims, exactly like `equals`', async () => {
    // An owner who learns one comparison has learned both. A value routing here
    // would have satisfied `equals` on a condition node.
    const r = await run({ left: '  YES  ', case1: 'yes', case2: '', case3: '' });
    expect(r.nextPort).toBe(SWITCH_CASE_HANDLES[0]);
  });

  it('a missing `left` is the empty value, not a crash', async () => {
    // config arrives from a jsonb column; the schema constrains the form, not
    // the row.
    const r = await run({ case1: 'כן', case2: '', case3: '' });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });

  it('a non-string config value is read as empty rather than coerced', async () => {
    const r = await run({ left: 42, case1: '42', case2: '', case3: '' });
    expect(r.nextPort).toBe(SWITCH_DEFAULT_HANDLE);
  });
});

describe('logic.switch — it never names a port that is not declared', () => {
  it('every reachable port is one of the four the palette seeds', async () => {
    const declared = new Set<string>([...SWITCH_CASE_HANDLES, SWITCH_DEFAULT_HANDLE]);
    const inputs = ['כן', 'לא', 'אולי', 'אחר', '', '   '];
    for (const left of inputs) {
      const r = await run({ left, ...THREE });
      expect(declared.has(String(r.nextPort))).toBe(true);
    }
  });
});
