// The only bridge between the editor's JSON and the runner's execution model.
//
// These are two different type systems that happen to describe the same picture.
// `WorkflowBuilderNode` belongs to @workflowbuilder/sdk and carries
// `data.properties`; `BaseNode` belongs to the vendored execution model and
// carries `config` plus `role?: NodeRole`. Nothing converts between them
// implicitly, and nothing else in KALFA is allowed to: the rest of the app talks
// to src/lib/workflow's public surface, and the conversion happens exactly here.
//
// THE EIGHT RULES (docs/workflow-editor-plan-2026-09-09.md §3), each marked at
// the line that implements it:
//
//   1. The catalogue decides which types may begin a flow.
//   2. This module is the only writer of `role: 'start'`.
//   3. `role` arriving from the client or stored JSON is discarded, not merged.
//   4. Exactly one start node.
//   5. An unknown node type is rejected BEFORE execution.
//   6. An incoming edge into the start node is rejected.
//   7. An orphan node that is not the start node is rejected.
//   8. Start is never inferred from in-degree zero.
//
// Rules 4, 6 and 7 are also checked by the vendored `resolveStartNode`. That is
// not redundancy to remove: `resolveStartNode` runs INSIDE `runGraph`, after
// `execution_started` has been emitted and a run row exists. Checking here means
// a malformed graph never becomes a run at all — which is what test 10 asserts.
import type {
  BaseNode,
  WorkflowDefinition,
  WorkflowEdgeDefinition,
} from '@/lib/workflow/vendor/workflowbuilder/types/workflow-execution/execution-model';

import { findCatalogueEntry, isTriggerType } from '../catalogue/nodes';
import {
  ACTION_BRANCH_HANDLES,
  ERROR_POLICIES,
  NODE_STATUSES,
  RUNNER_ERROR_PORT,
  type ErrorPolicy,
  type NodeStatus,
} from '../catalogue/types';

import { editorDiagramSchema, type EditorDiagram } from './editor-schema';

// ---------------------------------------------------------------------------
// The node the runner sees
// ---------------------------------------------------------------------------

// `BaseNode.config` is `unknown` by design — the runner is deliberately ignorant
// of any product's vocabulary. This is where ours attaches. `config` holds the
// node's properties verbatim; the step handler narrows it against the catalogue
// entry for its own type.
export type KalfaNode = BaseNode & {
  config: Record<string, unknown>;
  /**
   * The node's own lifecycle, lifted out of the properties like `label` and
   * `errorPolicy`. Absent means `active`, which is also what an unrecognised
   * value falls back to — the vocabulary is ours, the row is not.
   */
  status?: NodeStatus;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const CONVERSION_ERROR_CODES = [
  'malformed_diagram',
  'unknown_node_type',
  'no_start_node',
  'multiple_start_nodes',
  'start_node_has_incoming_edge',
  'orphan_node',
  'edge_endpoint_missing',
  'duplicate_node_id',
  'unresolved_template_reference',
] as const;

export type ConversionErrorCode = (typeof CONVERSION_ERROR_CODES)[number];

export type ConversionError = {
  code: ConversionErrorCode;
  /** Hebrew, admin-facing: this surfaces in the editor, not in a log. */
  message: string;
  /** The offending node, where there is one — so the owner can find it on the canvas. */
  nodeId?: string;
  /** The offending property, for the template guard. */
  field?: string;
};

export type ConversionResult =
  | {
      ok: true;
      definition: WorkflowDefinition<KalfaNode>;
      /**
       * `ExecutionContext.global`, built from the diagram's own variables panel.
       *
       * The vendored `execution-context.ts` names the two bags apart:
       * `variables` is "server-side globals/secrets the backend injects",
       * `global` is "global variables defined manually in the builder". This is
       * the second one, and it is keyed by NAME because `{{global.<name>}}` is
       * how a reference spells it — the panel's own `id` never appears in a
       * template.
       *
       * Carried on the result rather than fetched again by the caller: this
       * module already parsed the row, and a second parse would be a second
       * place for the shape to drift.
       */
      globals: Record<string, string>;
    }
  | { ok: false; errors: ConversionError[] };

// ---------------------------------------------------------------------------
// The template guard
// ---------------------------------------------------------------------------

// The editor's variable picker writes `{{nodes.<id>.<path>}}` into a property
// and the SDK stores it as plain text. `trigger.*`, `variables.*` and
// `global.*` can land in any text field the same way.
//
// UNBLOCKED 2026-09-10. This module used to REFUSE any diagram containing such
// a reference, and the refusal was correct while it stood: `resolve-template.ts`
// was not vendored, so the characters themselves would have been sent — a guest
// receiving a WhatsApp message reading `{{trigger.customer.name}}`.
//
// The reason it was not vendored — "it needs target: ES2018" — was half true
// and outlived its accuracy. `replaceAll` compiles fine here (`lib: esnext`,
// and `redact.ts` from the same package already uses it); only the four NAMED
// capture groups were rejected, and converting those to numbered positions is
// mechanical. The vendored file now carries that one divergence, and upstream's
// own 32 tests pass against it unchanged.
//
// Resolution happens ONCE, in `activity-runner.ts`, over the whole config
// before the handler runs. A reference the context cannot satisfy raises
// `PermanentNodeExecutionError` at that point — loud, on the first attempt,
// with the offending token in the message.
//
// What is deliberately NOT re-added here: a save-time check that every
// reference resolves. It cannot be done honestly — `{{trigger.message_text}}`
// is valid and unresolvable at save time, because no message has arrived yet.

/**
 * The node's Active / Draft / Disabled switch.
 *
 * Anything unrecognised is treated as ABSENT, not as an error. That matters for
 * one concrete case: `action.update_guest_status` used to spell the guest's RSVP
 * value under this same key, so a diagram saved before the rename carries
 * `status: 'attending'` here. Rejecting it would break those diagrams; reading it
 * as a lifecycle value would silently disable a live node. Falling back to
 * `active` does neither.
 */
function readNodeStatus(value: unknown): NodeStatus | undefined {
  return typeof value === 'string' && (NODE_STATUSES as readonly string[]).includes(value)
    ? (value as NodeStatus)
    : undefined;
}

function readErrorPolicy(value: unknown): ErrorPolicy | undefined {
  return typeof value === 'string' && (ERROR_POLICIES as readonly string[]).includes(value)
    ? (value as ErrorPolicy)
    : undefined;
}


// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a stored editor diagram into a `WorkflowDefinition` the vendored
 * runner can execute, or into a list of named errors. Never throws on bad data:
 * a malformed diagram is a result, not an exception, because the caller is
 * usually rendering it back to the owner.
 */
export function toWorkflowDefinition(
  workflowId: string,
  storedDefinition: unknown,
): ConversionResult {
  const parsed = editorDiagramSchema.safeParse(storedDefinition);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        {
          code: 'malformed_diagram',
          message: 'מבנה התהליך אינו תקין ולא ניתן להריץ אותו.',
        },
      ],
    };
  }

  const diagram = parsed.data;
  const errors: ConversionError[] = [];

  // --- nodes ---------------------------------------------------------------
  const nodes: KalfaNode[] = [];
  const seenIds = new Set<string>();

  for (const editorNode of diagram.nodes) {
    if (seenIds.has(editorNode.id)) {
      errors.push({
        code: 'duplicate_node_id',
        message: `שני צמתים חולקים את אותו מזהה (${editorNode.id}).`,
        nodeId: editorNode.id,
      });
      continue;
    }
    seenIds.add(editorNode.id);

    const nodeType = editorNode.data.type;
    const entry = findCatalogueEntry(nodeType);

    // RULE 5. An unknown type stops here — it never reaches ActivityRunnerPort.
    if (!entry) {
      errors.push({
        code: 'unknown_node_type',
        message: `סוג הצעד "${nodeType}" אינו קיים בקטלוג.`,
        nodeId: editorNode.id,
      });
      continue;
    }

    const properties = editorNode.data.properties;

    // RULES 2 and 3, in one expression, and this is the ONLY place `role` is
    // assigned anywhere in KALFA. `editorNode.data` may well carry a `role`
    // key — from a hand-edited row, a crafted request, or a future SDK — and it
    // is not read, not merged, not validated. It is simply not consulted:
    // `isTriggerType` asks the catalogue and nothing else.
    //
    // RULE 8 lives here too, by omission. In-degree is computed below for rules
    // 6 and 7; it is never an input to this decision.
    const role = isTriggerType(nodeType) ? ('start' as const) : undefined;

    // Lifted OUT of `config` and onto the node, because the runner reads it as
    // a sibling of `config` — `BaseNode.errorPolicy`, not `config.errorPolicy`.
    // Validated against the closed set rather than passed through: the value
    // arrives from a browser via jsonb, and an unrecognised string would make
    // `policy === 'fail'` false in the runner's own comparison and silently
    // absorb a failure the owner asked to be fatal. Anything unknown, absent,
    // or non-string falls back to no field at all, which is the runner's
    // documented default of 'fail'.
    const errorPolicy = readErrorPolicy(properties.errorPolicy);

    const node: KalfaNode = {
      id: editorNode.id,
      type: nodeType,
      config: properties,
      ...(typeof properties.label === 'string' && properties.label !== ''
        ? { label: properties.label }
        : {}),
      ...(role ? { role } : {}),
      ...(errorPolicy ? { errorPolicy } : {}),
      ...(() => {
        const status = readNodeStatus(properties.status);
        return status ? { status } : {};
      })(),
    };
    nodes.push(node);
  }

  // --- edges ---------------------------------------------------------------
  const edges: WorkflowEdgeDefinition[] = [];
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));

  for (const [index, editorEdge] of diagram.edges.entries()) {
    // An edge to or from a node that is not in the graph is a broken diagram,
    // not something to route around. `buildAdjacencyMap` would silently drop it
    // and the owner would see a step that never runs with no explanation.
    if (!seenIds.has(editorEdge.source) || !seenIds.has(editorEdge.target)) {
      errors.push({
        code: 'edge_endpoint_missing',
        message: 'קיים חיבור אל צעד שאינו קיים בתהליך.',
      });
      continue;
    }
    // A node dropped for an earlier error (unknown type, template reference)
    // leaves its edges pointing at nothing runnable. Those errors are already
    // reported; adding an edge error for the same cause would bury them.
    if (!inDegree.has(editorEdge.source) || !inDegree.has(editorEdge.target)) {
      continue;
    }

    // RULE 8's neighbour: ids convert unchanged (test 8). Only a MISSING id is
    // synthesised, and deterministically, so the same diagram always yields the
    // same definition — a run is reproducible from its row.
    const id = editorEdge.id ?? `e${index}:${editorEdge.source}->${editorEdge.target}`;

    edges.push({
      id,
      sourceNodeId: editorEdge.source,
      targetNodeId: editorEdge.target,
      // Preserved verbatim so decision branches work (test 9), with ONE
      // rewrite: the action node's error branch. The editor mints that handle
      // through `getHandleId` as `source:inner:error`, and the runner tests
      // against the bare literal `errorRoute` — this is the seam where the two
      // vocabularies meet, and it is the only place that knows both.
      //
      // `null` from React Flow becomes absent, which is what `isEdgeLive` treats
      // as "no handle" — every non-error edge live.
      ...(editorEdge.sourceHandle
        ? {
            sourceHandle:
              editorEdge.sourceHandle === ACTION_BRANCH_HANDLES.error
                ? RUNNER_ERROR_PORT
                : editorEdge.sourceHandle,
          }
        : {}),
    });

    inDegree.set(editorEdge.target, (inDegree.get(editorEdge.target) ?? 0) + 1);
  }

  // A graph with a bad node cannot be judged on its start shape — the missing
  // node may have been the trigger. Report what is known and stop.
  if (errors.length > 0) return { ok: false, errors };

  // --- start shape (rules 4, 6, 7) ----------------------------------------
  const startNodes = nodes.filter((n) => n.role === 'start');

  // RULE 4.
  if (startNodes.length === 0) {
    errors.push({
      code: 'no_start_node',
      message: 'לתהליך אין צעד פתיחה. יש להוסיף טריגר אחד.',
    });
  } else if (startNodes.length > 1) {
    errors.push({
      code: 'multiple_start_nodes',
      message: `לתהליך יש ${startNodes.length} צעדי פתיחה. מותר בדיוק אחד.`,
    });
  }

  const startNode = startNodes.length === 1 ? startNodes[0] : undefined;

  // RULE 6.
  if (startNode && (inDegree.get(startNode.id) ?? 0) > 0) {
    errors.push({
      code: 'start_node_has_incoming_edge',
      message: 'לצעד הפתיחה יש חיבור נכנס. צעד פתיחה חייב להיות ראשון.',
      nodeId: startNode.id,
    });
  }

  // RULE 7. Only meaningful once the start node is unambiguous — with two
  // triggers or none, "orphan" has no definition to test against.
  if (startNode) {
    for (const node of nodes) {
      if (node.id === startNode.id) continue;
      if ((inDegree.get(node.id) ?? 0) === 0) {
        errors.push({
          code: 'orphan_node',
          message: `הצעד "${node.label ?? node.id}" אינו מחובר לתהליך ולעולם לא ירוץ.`,
          nodeId: node.id,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, definition: { workflowId, nodes, edges }, globals: toGlobals(diagram) };
}

/**
 * The variables panel's definitions, reduced to the name→value map the runner
 * takes. `defaultValue` is the only value a definition carries — there is no
 * separate runtime value in `VariableDefinition` — so it IS the value.
 *
 * A blank name is dropped: `{{global.}}` is not a reference any grammar
 * accepts, so a nameless variable can never be read and keeping it would only
 * put an empty key in the context. Two variables sharing a name collapse to the
 * later one, which is what a name lookup has to do; the panel does not stop the
 * owner from creating the collision.
 */
function toGlobals(diagram: EditorDiagram): Record<string, string> {
  const globals: Record<string, string> = {};
  for (const definition of Object.values(diagram.globalVariables ?? {})) {
    if (!definition) continue;
    const name = definition.name.trim();
    if (name === '') continue;
    globals[name] = definition.defaultValue;
  }
  return globals;
}
