// ActivityRunnerPort over the KALFA step handlers, with the idempotency claim
// wrapped around every one of them.
//
// THIS IS THE FILE THAT MAKES A RETRY SAFE. The vendored `runGraph` keeps no
// per-node checkpoint: it resolves the start node and drives waves until the
// graph ends. pg-boss is at-least-once, so a job that crashes after node 2's
// side effect and before the run finishes will, on retry, replay nodes 1, 2 and
// 3 from scratch. Nothing in the runner prevents that; the ledger does.
//
// The order is the whole point:
//
//     claim  →  side effect  →  complete
//       │
//       └── 'already_done'  →  return the ORIGINAL result, run nothing
//
// The ORIGINAL result, whole — `{ output, nextPort }`, not just `output`. A
// condition node's `nextPort` is the branch it chose; a replay that returned a
// fresh empty result would re-decide that branch and could send half the graph
// down a path that never ran the first time.
import { isKnownNodeType } from '../catalogue/nodes';
import type { KalfaNodeType } from '../catalogue/types';
import { STEP_HANDLERS, type WorkflowTriggerPayload } from '../steps';
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';
import type {
  ActivityRunnerPort,
  NodeExecutionResult,
} from '../vendor/workflowbuilder/execution-core/ports/activity-runner.port';

import type { GuestActionsPort, StepLedgerPort } from './ports';

export type ActivityRunnerArgs = {
  runId: string;
  trigger: WorkflowTriggerPayload;
  ledger: StepLedgerPort;
  guests: GuestActionsPort;
};

// The shape the runner sees. Structural rather than an import of KalfaNode, so
// this module does not depend on the adapter.
type RunnableNode = {
  id: string;
  type: string;
  config: unknown;
};

export function createActivityRunner<TNode extends RunnableNode>(
  args: ActivityRunnerArgs,
): ActivityRunnerPort<TNode> {
  const { runId, trigger, ledger, guests } = args;

  return {
    async executeNode(node): Promise<NodeExecutionResult> {
      // Rule 5 again, at the last possible moment. The adapter already rejected
      // unknown types before this graph became a run — this is the assertion
      // that the two layers agree, and it fails closed if they ever stop
      // agreeing (a catalogue entry removed while a saved workflow still uses
      // it, say).
      if (!isKnownNodeType(node.type)) {
        throw new PermanentNodeExecutionError(
          'unknown_node_type',
          `סוג הצעד "${node.type}" אינו קיים בקטלוג.`,
        );
      }
      const handler = STEP_HANDLERS[node.type as KalfaNodeType];

      const claim = await ledger.claimStep({
        runId,
        nodeId: node.id,
        nodeType: node.type,
      });

      if (claim.kind === 'already_done') {
        // The replay path. Nothing runs; the graph continues on the output the
        // first attempt produced.
        return claim.result as NodeExecutionResult;
      }

      if (claim.kind === 'in_flight') {
        // Another worker holds this node. Not success and not a permanent
        // failure: the run must stop here rather than proceed on an output that
        // does not exist. `fail` is the default error policy, so this aborts the
        // graph — which is correct, because the attempt that owns the node is
        // still driving its own copy of the same graph.
        throw new PermanentNodeExecutionError(
          'step_in_flight',
          `הצעד "${node.id}" כבר רץ בהרצה מקבילה.`,
        );
      }

      const config = isConfigObject(node.config) ? node.config : {};

      try {
        const result = await handler(config, { trigger, deps: { guests } });
        // Persisted AFTER the side effect and BEFORE the runner propagates, so a
        // crash between the two leaves the row 'running' — visible as stuck
        // rather than invisible as never-attempted.
        await ledger.completeStep({ runId, nodeId: node.id, result });
        return result;
      } catch (error) {
        await ledger.failStep({
          runId,
          nodeId: node.id,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
