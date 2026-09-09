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
        [edge('t', 'c'), edge('c', 'yes', 'true'), edge('c', 'no', 'false')],
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.definition.edges.map((e) => [e.targetNodeId, e.sourceHandle]),
    ).toEqual([
      ['c', undefined],
      ['yes', 'true'],
      ['no', 'false'],
    ]);
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

  it('11. a namespaced template reference is rejected, and Meta\'s {{1}} is not', () => {
    // The two directions in one test, because they are one decision. The guard
    // is anchored on the namespace: catching bare `{{` would reject the message
    // bodies this product actually sends.
    const withReference = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER, { keyword: 'שלום {{trigger.guest.name}}' })]),
    );
    expect(codes(withReference)).toContain('unresolved_template_reference');
    if (!withReference.ok) {
      expect(withReference.errors[0]?.field).toBe('keyword');
    }

    const withMetaPlaceholder = toWorkflowDefinition(
      'wf1',
      diagram([node('t', TRIGGER, { keyword: 'שלום {{1}}, האירוע ב־{{2}}' })]),
    );
    expect(withMetaPlaceholder.ok).toBe(true);
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
