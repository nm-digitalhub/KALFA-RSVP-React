import {
  getStoreNodes,
  setStoreNodes,
  type WorkflowBuilderEdge,
  type WorkflowBuilderNode,
} from "@workflowbuilder/sdk";

import { findArmBlockersByNode } from "@/lib/workflow/catalogue/arm-check";

// The refusals the arm button would give, shown on the nodes while editing.
//
// ⚠️ THE FAILURE THIS CLOSES. `findArmBlockers` catches three things no schema
// can: a guest step under a trigger that never carries a guest, a keyword no
// message kind can satisfy, and a webhook body that is absent rather than blank.
// All three are CROSS-FIELD or CROSS-NODE, all three are refusals the engine
// already makes — and until now the owner met every one of them by pressing
// "arm" and reading a list. The node itself looked fine.
//
// The SDK exposes exactly the right seam: `data.properties.customErrors` puts an
// exclamation mark on the node and the message in the properties panel. Its own
// source says so, and `Ga()` in the 2.3.0 bundle counts customErrors toward a
// node's validity alongside real schema errors.
//
// ⚠️ WHAT THIS IS NOT. It is not a promise that a clean canvas arms.
// `findVoiceDialBlockers` asks the database whether each voice purpose still
// exists and is reachable, which cannot run in the browser, so a node may be
// marked clean here and still be refused at arming. The arm button stays the
// authority; this moves the cheap half of its answer forward in time.

/** The Ajv error shape the SDK documents for `customErrors`. */
function toErrorObject(message: string) {
  return {
    keyword: "armBlocker",
    instancePath: "",
    schemaPath: "",
    params: {},
    message,
  };
}

function messagesOf(node: WorkflowBuilderNode): string[] {
  const existing = (node.data?.properties as { customErrors?: unknown } | undefined)
    ?.customErrors;
  return Array.isArray(existing)
    ? existing
        .map((e) => (e as { message?: unknown } | null)?.message)
        .filter((m): m is string => typeof m === "string")
    : [];
}

function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Recompute the markers for the current diagram, writing only on a real change.
 *
 * ⚠️ THE EQUALITY CHECK IS WHAT MAKES THIS SAFE TO CALL FROM A NODE SUBSCRIPTION.
 * `setStoreNodes` replaces every node and re-validates, which emits another node
 * change; without the early return this would be an infinite loop rather than a
 * marker. So the write happens only when some node's message list actually
 * differs from what it already carries.
 */
export function syncArmBlockerMarkers(
  name: string,
  edges: readonly WorkflowBuilderEdge[],
  workflowId: string,
): void {
  const nodes = getStoreNodes();

  // `findArmBlockersByNode` parses with `editorDiagramSchema` and returns []
  // for anything it cannot read — a half-built diagram mid-drag, for instance —
  // so this never invents a marker from a shape it did not understand.
  const blockers = findArmBlockersByNode({ name, nodes, edges }, workflowId);

  const byNode = new Map<string, string[]>();
  for (const blocker of blockers) {
    const list = byNode.get(blocker.nodeId);
    if (list) list.push(blocker.message);
    else byNode.set(blocker.nodeId, [blocker.message]);
  }

  let changed = false;
  const next = nodes.map((node) => {
    const wanted = byNode.get(node.id) ?? [];
    if (sameMessages(messagesOf(node), wanted)) return node;
    changed = true;

    const properties = { ...(node.data?.properties ?? {}) } as Record<string, unknown>;
    // ⚠️ DELETED, NOT SET TO `[]`. `Ga()` tests `customErrors.length === 0`, so
    // an empty array is equivalent for validity — but the key would then be
    // written into every node of every diagram, and the save handler strips
    // exactly this key by name. Absent is the honest representation of "no
    // refusal", and it keeps a clean diagram byte-identical to one saved before
    // this file existed.
    if (wanted.length === 0) delete properties.customErrors;
    else properties.customErrors = wanted.map(toErrorObject);

    return { ...node, data: { ...node.data, properties } } as WorkflowBuilderNode;
  });

  if (changed) setStoreNodes(next);
}

/**
 * Strip the editor's computed validation state out of a diagram before it is
 * persisted.
 *
 * ⚠️ THIS IS A BUG FIX THAT PREDATES `customErrors`, AND IT IS MEASURED. Eight
 * of twenty-two stored nodes already carry `properties.errors` — the save path
 * is a verbatim pass-through and has never stripped anything. Schema errors are
 * self-healing, because the SDK recomputes them on load; `customErrors` are not,
 * because nothing but this module computes them. Persisting one would show an
 * owner a refusal that was fixed in another session and is no longer true.
 *
 * ⚠️ AND IT IS STILL A PASS-THROUGH IN THE SENSE THAT MATTERS. The handler's own
 * comment warns against rebuilding the payload from a chosen four fields — that
 * erased `globalVariables` once. This removes two keys BY NAME from inside each
 * node's properties and copies everything else, so a field the vendor adds
 * tomorrow still survives.
 */
export function stripComputedErrors<T extends { nodes?: unknown }>(data: T): T {
  if (!Array.isArray(data.nodes)) return data;

  return {
    ...data,
    nodes: data.nodes.map((node) => {
      const typed = node as { data?: { properties?: Record<string, unknown> } };
      const properties = typed.data?.properties;
      if (!properties || (!("errors" in properties) && !("customErrors" in properties))) {
        return node;
      }
      const { errors: _errors, customErrors: _customErrors, ...rest } = properties;
      return { ...typed, data: { ...typed.data, properties: rest } };
    }),
  };
}
