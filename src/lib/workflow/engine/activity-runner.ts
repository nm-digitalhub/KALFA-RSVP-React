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
import type { ExecutionContext } from '../vendor/workflowbuilder/execution-core/execution-context';
import { PermanentNodeExecutionError } from '../vendor/workflowbuilder/execution-core/errors';
import { resolveTemplate } from '../vendor/workflowbuilder/execution-core/templates/resolve-template';
import type {
  ActivityRunnerPort,
  NodeExecutionResult,
} from '../vendor/workflowbuilder/execution-core/ports/activity-runner.port';

import type { GuestActionsPort, StepLedgerPort, TeamAlertsPort } from './ports';

export type ActivityRunnerArgs = {
  runId: string;
  trigger: WorkflowTriggerPayload;
  ledger: StepLedgerPort;
  guests: GuestActionsPort;
  alerts: TeamAlertsPort;
};

// The shape the runner sees. Structural rather than an import of KalfaNode, so
// this module does not depend on the adapter.
type RunnableNode = {
  id: string;
  type: string;
  config: unknown;
  status?: string;
};

/**
 * Resolve every `{{…}}` reference in a node's config, once, before the handler
 * runs.
 *
 * ONE PLACE, not one per handler. `executeNode` already receives the full
 * `ExecutionContext` — trigger payload, global variables, and every completed
 * node's output — so resolving here means a handler never sees a template and
 * every field of every node type gets references for free, including node types
 * nobody has written yet.
 *
 * Strings only, recursively through objects and arrays. A number, a boolean and
 * a null are returned untouched: a template is text by definition, and walking
 * into non-strings would only cost time.
 *
 * An unresolved reference is PERMANENT. `resolveTemplate` throws for a path the
 * context does not carry, and no amount of retrying will make `{{trigger.typo}}`
 * exist — so it is raised as `PermanentNodeExecutionError` and the node stops on
 * its first attempt rather than burning the queue's retry budget on a typo.
 * That is the behaviour upstream chose too, and for the same stated reason: a
 * broken reference should fail loudly on the first run, not silently resolve to
 * an empty string and reach a guest.
 */
function resolveConfigTemplates(value: unknown, context: ExecutionContext): unknown {
  if (typeof value === 'string') {
    try {
      return resolveTemplate(value, context);
    } catch (error) {
      throw new PermanentNodeExecutionError(
        'unresolved_template_reference',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigTemplates(item, context));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveConfigTemplates(item, context);
    }
    return out;
  }
  return value;
}

export function createActivityRunner<TNode extends RunnableNode>(
  args: ActivityRunnerArgs,
): ActivityRunnerPort<TNode> {
  const { runId, trigger, ledger, guests, alerts } = args;

  return {
    // `context` was ignored until templates landed — the handlers took only
    // their own config and the trigger. It carries nodeOutputs, variables and
    // global, which is everything a reference can name.
    async executeNode(node, context): Promise<NodeExecutionResult> {
      // Rule 5 again, at the last possible moment. The adapter already rejected
      // unknown types before this graph became a run — this is the assertion
      // that the two layers agree, and it fails closed if they ever stop
      // agreeing (a catalogue entry removed while a saved workflow still uses
      // it, say).
      //
      // It also closes a prototype-pollution vector, which is why it must stay
      // AHEAD of the index below. `node.type` is an arbitrary string that came
      // from a browser via jsonb, and `STEP_HANDLERS` is an object literal — so
      // a node typed `constructor` or `toString` would resolve off
      // Object.prototype and be called as a handler. Upstream documents exactly
      // this hazard (packages/execution-core/README.md) and prescribes a
      // membership test rather than a bare index. `isKnownNodeType` is a
      // Map-backed `.has`, which has no prototype chain to walk, so the lookup
      // that follows is unreachable with a polluting key.
      if (!isKnownNodeType(node.type)) {
        throw new PermanentNodeExecutionError(
          'unknown_node_type',
          `סוג הצעד "${node.type}" אינו קיים בקטלוג.`,
        );
      }
      const handler = STEP_HANDLERS[node.type as KalfaNodeType];

      // Active / Draft / Disabled, honoured here rather than in the graph.
      //
      // The node still RUNS — it claims its row, records a step, and lets the
      // graph continue through it — but its handler is never called, so it
      // performs no side effect. That is a deliberate choice between two
      // possible meanings of "off":
      //
      //   * remove the node and rewire its edges through. Surgery on a graph the
      //     owner drew, and a disabled node in a branch would silently change
      //     which branch fires.
      //   * pass through. `nextPort` is undefined, so every non-error outgoing
      //     edge stays live and the rest of the workflow behaves as if this step
      //     had succeeded and done nothing.
      //
      // The second is what an owner switching one step off is asking for, and it
      // is the same behaviour n8n's node-disable has. `draft` is treated
      // identically and reported separately, so the log says which it was: a
      // step nobody finished writing is not the same as one deliberately
      // switched off, even though neither should touch a guest.
      if (node.status === 'draft' || node.status === 'disabled') {
        const result: NodeExecutionResult = {
          output: { skipped: true, reason: `node_${node.status}` },
        };
        // Claimed and completed anyway, so the replay path and the run log see
        // the same node list whether it was on or off. A skipped step that left
        // no row would look like a crash on the next retry.
        const skipClaim = await ledger.claimStep({
          runId,
          nodeId: node.id,
          nodeType: node.type,
        });
        if (skipClaim.kind === 'already_done') return skipClaim.result as NodeExecutionResult;
        if (skipClaim.kind === 'claimed') {
          await ledger.completeStep({ runId, nodeId: node.id, result });
        }
        return result;
      }

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

      const rawConfig = isConfigObject(node.config) ? node.config : {};
      // Resolved AFTER the ledger claim, so a replay of an already-completed
      // node returns its stored result without re-resolving — and BEFORE the
      // handler, which therefore never has to know templates exist.
      const config = resolveConfigTemplates(rawConfig, context) as Record<string, unknown>;

      try {
        const result = await handler(config, { trigger, deps: { guests, alerts } });
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
