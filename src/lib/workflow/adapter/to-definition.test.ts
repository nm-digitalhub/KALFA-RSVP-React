// The conversion contract, as tests. Each case names the rule it guards
// (docs/workflow-editor-plan-2026-09-09.md §3 and §8).
//
// Two of these — 7 and 10 — assert a CALL COUNT OF ZERO on a spy
// ActivityRunnerPort, not merely the absence of an error. An adapter that
// silently swallowed a bad graph would pass a "did it throw?" test and fail a
// guest. That is the difference the spy exists to catch.
import { describe, expect, it, vi } from 'vitest';

import { runGraph } from '@/lib/workflow/vendor/workflowbuilder/execution-core/graph-runner';
import type { ActivityRunnerPort } from '@/lib/workflow/vendor/workflowbuilder/execution-core/ports/activity-runner.port';
import type { EventEmitterPort } from '@/lib/workflow/vendor/workflowbuilder/execution-core/ports/event-emitter.port';

import { CATALOGUE, CATALOGUE_COVERS_ALL_TYPES } from '../catalogue/nodes';

import { CONDITION_BRANCH_HANDLES } from '../catalogue/types';

import { toWorkflowDefinition, type KalfaNode } from './to-definition';

// --- fixtures --------------------------------------------------------------

type RawNode = {
  id: string;
  data: { type: string; properties?: Record<string, unknown> } & Record<string, unknown>;
};

function node(
  id: string,
  type: string,
  properties: Record<string, unknown> = {},
  extraData: Record<string, unknown> = {},
): RawNode {
  return {
    id,
    type: 'node',
    position: { x: 0, y: 0 },
    data: { type, icon: 'Lightning', properties, ...extraData },
  } as RawNode;
}

function edge(source: string, target: string, sourceHandle?: string) {
  return {
    id: `xy-edge__${source}-${target}`,
    source,
    target,
    type: 'labelEdge',
    sourceHandle: sourceHandle ?? null,
  };
}

const TRIGGER = 'trigger.whatsapp_inbound';
const CONDITION = 'logic.condition';
const ACTION = 'action.update_guest_status';

function diagram(nodes: unknown[], edges: unknown[] = []) {
  return { name: 'בדיקה', layoutDirection: 'DOWN', nodes, edges };
}

function codes(result: ReturnType<typeof toWorkflowDefinition>): string[] {
  return result.ok ? [] : result.errors.map((e) => e.code);
}

// A runner that records every node it is asked to execute. `executeNode` is the
// single entry point into every side effect in the system, so a call count of
// zero here is the assertion that nothing happened.
function spyRunner() {
  const executed: string[] = [];
  const port: ActivityRunnerPort<KalfaNode> = {
    executeNode: vi.fn(async (n: KalfaNode) => {
      executed.push(n.id);
      return { output: {} };
    }),
  };
  return { port, executed };
}

const silentEvents: EventEmitterPort = {
  emitEvent: async () => {},
  updateStatus: async () => {},
};

// --- the catalogue itself --------------------------------------------------

describe('catalogue', () => {
  it('covers every declared node type exactly once', () => {
    expect(CATALOGUE_COVERS_ALL_TYPES).toBe(true);
  });

  it('declares exactly one trigger type in this slice', () => {
    expect(CATALOGUE.filter((e) => e.isTrigger).map((e) => e.type)).toEqual([TRIGGER]);
  });
});

// --- the ten contract tests ------------------------------------------------

describe('conversion contract', () => {
  it('1. a single trigger with no incoming edge converts and gets role: start', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('a', ACTION)], [edge('t', 'a')]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes.map((n) => [n.id, n.role])).toEqual([
      ['t', 'start'],
      ['a', undefined],
    ]);
  });

  it('2. no trigger fails before runGraph', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('a', ACTION), node('b', CONDITION)], [edge('a', 'b')]),
    );
    expect(codes(result)).toContain('no_start_node');
  });

  it('3. two triggers fail', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t1', TRIGGER), node('t2', TRIGGER), node('a', ACTION)], [
        edge('t1', 'a'),
        edge('t2', 'a'),
      ]),
    );
    expect(codes(result)).toContain('multiple_start_nodes');
  });

  it('4. an edge into the trigger fails', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('a', ACTION)], [edge('t', 'a'), edge('a', 't')]),
    );
    expect(codes(result)).toContain('start_node_has_incoming_edge');
  });

  it('5. an extra orphan fails', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [node('t', TRIGGER), node('a', ACTION), node('lonely', CONDITION)],
        [edge('t', 'a')],
      ),
    );
    expect(codes(result)).toContain('orphan_node');
    if (result.ok) return;
    expect(result.errors.find((e) => e.code === 'orphan_node')?.nodeId).toBe('lonely');
  });

  it('6. role: start injected into a normal node is not accepted', () => {
    // The exact attack: a hand-edited row (or a crafted save) claiming a
    // non-trigger node is the entry point. Rule 3 says the incoming value is
    // discarded — not validated, not merged — so the graph must read as having
    // no start at all, exactly as if the key were absent.
    const injected = node('a', ACTION, {}, { role: 'start', isStartNode: true });
    const result = toWorkflowDefinition('wf1', diagram([injected]));

    expect(codes(result)).toContain('no_start_node');
    expect(codes(result)).not.toContain('multiple_start_nodes');
  });

  it('6b. an injected role is discarded even when a real trigger is present', () => {
    // The subtler half: with a genuine trigger in the graph, a merged-in role
    // would produce TWO start nodes. Reading exactly one proves the stored value
    // was dropped rather than combined.
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [node('t', TRIGGER), node('a', ACTION, {}, { role: 'start' })],
        [edge('t', 'a')],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes.filter((n) => n.role === 'start')).toHaveLength(1);
    expect(result.definition.nodes.find((n) => n.id === 'a')?.role).toBeUndefined();
  });

  it('7. an unknown node type never reaches ActivityRunnerPort', async () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('x', 'action.definitely_not_real')], [edge('t', 'x')]),
    );

    expect(codes(result)).toContain('unknown_node_type');

    // The count-of-zero half: a rejected graph is never handed to the runner.
    const { port, executed } = spyRunner();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(executed).toHaveLength(0);
    expect(port.executeNode).not.toHaveBeenCalled();
  });

  it('8. node and edge ids convert unchanged', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('a', ACTION)], [edge('t', 'a')]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes.map((n) => n.id)).toEqual(['t', 'a']);
    expect(result.definition.edges).toEqual([
      { id: 'xy-edge__t-a', sourceNodeId: 't', targetNodeId: 'a' },
    ]);
  });

  it('9. sourceHandle is preserved so decision and error branches work', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [node('t', TRIGGER), node('c', CONDITION), node('yes', ACTION), node('no', ACTION)],
        [
          edge('t', 'c'),
          edge('c', 'yes', CONDITION_BRANCH_HANDLES.true),
          edge('c', 'no', CONDITION_BRANCH_HANDLES.false),
        ],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verbatim, colons and all. The runner compares this against the handler's
    // `nextPort` with `===`, so any normalisation here would silently kill the
    // branch.
    expect(
      result.definition.edges.map((e) => [e.targetNodeId, e.sourceHandle]),
    ).toEqual([
      ['c', undefined],
      ['yes', 'source:inner:true'],
      ['no', 'source:inner:false'],
    ]);
  });

  // --- the three wirings added 2026-09-09 --------------------------------

  it('lets {{global.…}} through to be resolved at run time', () => {
    // This used to be blocked, and the block was right while no resolver
    // existed: the characters themselves would have reached a guest. With
    // `resolve-template.ts` vendored, `global` is one of the four namespaces it
    // knows, and the value comes from the same variables panel the diagram
    // carries.
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('a', ACTION, { status: 'attending', label: '{{global.eventName}}' })], [
        edge('t', 'a'),
      ]),
    );

    expect(codes(result)).toEqual([]);
  });

  it('carries the variables panel through as ExecutionContext.global', () => {
    const withVariables = {
      ...diagram([node('t', TRIGGER), node('a', ACTION, { status: 'attending' })], [edge('t', 'a')]),
      globalVariables: {
        'var-1': {
          id: 'var-1',
          name: 'eventName',
          type: 'string',
          defaultValue: 'החתונה של דנה ויוסי',
          description: '',
        },
        // Nameless: unreachable by any reference, so it must not reach the map.
        'var-2': { id: 'var-2', name: '  ', type: 'string', defaultValue: 'x', description: '' },
      },
    };

    const result = toWorkflowDefinition('wf1', withVariables);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Keyed by NAME, because `{{global.eventName}}` is how it is spelled — the
    // panel's `var-1` id never appears in a reference.
    expect(result.globals).toEqual({ eventName: 'החתונה של דנה ויוסי' });
  });

  it('lifts errorPolicy out of config and onto the node', () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [node('t', TRIGGER), node('a', ACTION, { status: 'attending', errorPolicy: 'continue' })],
        [edge('t', 'a')],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A sibling of `config`, which is where the runner reads it. Leaving it
    // only inside `config` would mean the runner never saw it.
    expect(result.definition.nodes.find((n) => n.id === 'a')?.errorPolicy).toBe('continue');
  });

  it('accepts errorRoute, which it used to drop', () => {
    // This assertion was inverted. `errorRoute` sat in the rejected list because
    // nothing in the editor could draw an edge carrying the runner's reserved
    // port — true of the SDK's handle minting, and never true of the adapter,
    // which rewrites `source:inner:error` into it. See unblocked.test.ts for the
    // routing itself; here it is only that the policy survives conversion.
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [
          node('t', TRIGGER),
          node('a', ACTION, { rsvpStatus: 'attending', errorPolicy: 'errorRoute' }),
        ],
        [edge('t', 'a')],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.nodes.find((n) => n.id === 'a')?.errorPolicy).toBe('errorRoute');
  });

  it('drops an errorPolicy it does not recognise rather than trusting it', () => {
    // The value arrives from a browser through jsonb. An unrecognised string
    // would make the runner's `policy === 'fail'` comparison false and absorb a
    // failure the owner never asked to absorb; absent means the documented
    // default, which is 'fail'.
    for (const injected of ['ERROR_ROUTE', 'CONTINUE', '', 42]) {
      const result = toWorkflowDefinition(
        'wf1',
        diagram(
          [node('t', TRIGGER), node('a', ACTION, { status: 'attending', errorPolicy: injected })],
          [edge('t', 'a')],
        ),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.definition.nodes.find((n) => n.id === 'a')?.errorPolicy).toBeUndefined();
    }
  });

  it('10. when validation fails, no node runs', async () => {
    // Two triggers: a graph that is structurally wrong but whose nodes are all
    // real and all runnable. Nothing about it would stop a naive adapter from
    // handing it to runGraph.
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t1', TRIGGER), node('t2', TRIGGER), node('a', ACTION)], [
        edge('t1', 'a'),
        edge('t2', 'a'),
      ]),
    );

    expect(result.ok).toBe(false);

    const { port, executed } = spyRunner();
    if (result.ok) return;
    expect(executed).toHaveLength(0);
    expect(port.executeNode).not.toHaveBeenCalled();
  });

  it("11. a template reference converts, and Meta's {{1}} is left alone", () => {
    // Both halves are one decision, and it survived the guard's removal
    // unchanged: what separates a VARIABLE reference from a WhatsApp
    // placeholder is the dot after the namespace.
    //
    // `resolveTemplate`'s outer matcher is `\{\{\s*\w+\.…\}\}` — a word,
    // then a DOT. `{{1}}` has no dot, so the resolver never sees it as a
    // reference and it reaches Meta verbatim. That matters concretely: this
    // codebase has 85 positional placeholders in approved template bodies, and
    // a resolver that ate them would corrupt every one.
    const withReference = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER, { keyword: 'שלום {{trigger.message_text}}' })]),
    );
    // Converts now. The reference is resolved at RUN time by the activity
    // runner, against a context that does not exist while the owner is drawing.
    expect(codes(withReference)).toEqual([]);

    const withMetaPlaceholder = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER, { keyword: 'שלום {{1}}, האירוע ב־{{2}}' })]),
    );
    expect(withMetaPlaceholder.ok).toBe(true);
    if (!withMetaPlaceholder.ok) return;
    // Carried through byte for byte.
    expect(withMetaPlaceholder.definition.nodes[0]?.config.keyword).toBe(
      'שלום {{1}}, האירוע ב־{{2}}',
    );
  });
});

// --- the definition actually executes --------------------------------------

describe('the converted definition drives the vendored runner', () => {
  it('runs the whole chain in graph order', async () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER), node('c', CONDITION), node('a', ACTION)], [
        edge('t', 'c'),
        edge('c', 'a'),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { port, executed } = spyRunner();
    const outcome = await runGraph(
      {
        workflowId: 'wf1',
        executionId: 'run1',
        definition: result.definition,
        triggerPayload: {},
        variables: {},
        global: {},
      },
      port,
      silentEvents,
    );

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['t', 'c', 'a']);
  });

  it('follows only the branch the condition names', async () => {
    const result = toWorkflowDefinition(
      'wf1',
      diagram(
        [node('t', TRIGGER), node('c', CONDITION), node('yes', ACTION), node('no', ACTION)],
        [edge('t', 'c'), edge('c', 'yes', 'true'), edge('c', 'no', 'false')],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const executed: string[] = [];
    const port: ActivityRunnerPort<KalfaNode> = {
      executeNode: async (n) => {
        executed.push(n.id);
        return n.type === CONDITION ? { output: {}, nextPort: 'true' } : { output: {} };
      },
    };

    const outcome = await runGraph(
      {
        workflowId: 'wf1',
        executionId: 'run1',
        definition: result.definition,
        triggerPayload: {},
        variables: {},
        global: {},
      },
      port,
      silentEvents,
    );

    expect(outcome.status).toBe('completed');
    expect(executed).toEqual(['t', 'c', 'yes']);
    expect(executed).not.toContain('no');
  });
});
