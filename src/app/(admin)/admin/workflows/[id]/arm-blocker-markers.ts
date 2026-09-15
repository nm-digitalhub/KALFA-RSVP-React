import {
  getStoreNodes,
  setStoreNodes,
  type WorkflowBuilderEdge,
  type WorkflowBuilderNode,
} from "@workflowbuilder/sdk";

import { findArmBlockersByNode } from "@/lib/workflow/catalogue/arm-check";

// The refusals the arm button would give, shown on the nodes while editing.
//
// ⚠️ THE FAILURE THIS CLOSES. Five refusals no JSON Schema makes, and until now
// the owner met every one of them by pressing "arm" and reading a list while the
// node itself looked fine:
//
//   a step left in DRAFT          — 'draft' is a legitimate value of the enum
//   a guest step under a          — CROSS-NODE: the answer depends on the node
//     guestless trigger             at the other end of the graph
//   a keyword no message kind     — a CONTRADICTION between two fields, not a
//     can satisfy                   fault in either one
//   a fan-out pointing at its     — needs the workflow's own id, which is not
//     own workflow                  in the diagram
//   a callback routed to the      — a value that is valid for the field and
//     sales agent                   wrong for this caller
//
// Each is a refusal the engine already makes; all this does is move the news
// forward in time, onto the node it belongs to.
//
// ⚠️ AND IT SURFACES ONLY THOSE. An earlier version of this comment argued the
// opposite — that repeating the schema's own refusals here "costs nothing" —
// and the code did exactly that. It was wrong twice over: `Ga()` counts
// `customErrors` toward node validity alongside schema errors, so the same
// invariant was injected twice at the data layer, and the schema's own message
// already renders beside the field while ours could not. `syncArmBlockerMarkers`
// now filters on `source`; see the block above it.
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

const ARM_BLOCKER_KEYWORD = "armBlocker";

/**
 * The Ajv error shape the SDK documents for `customErrors`.
 *
 * ⚠️ `instancePath` IS THE FIELD BINDING, and it used to be hardcoded to `''`.
 * JsonForms documents it as the way an external error attaches to a property
 * (`/lastname` in their own example), so a root-scoped error marks the node and
 * lands next to nothing. Each blocker now carries its own path — `/status` for
 * a draft step, `/topic` for a sales-routed callback — and `''` only where the
 * refusal genuinely is not about one field.
 */
function toErrorObject(blocker: { message: string; instancePath: string }) {
  return {
    keyword: ARM_BLOCKER_KEYWORD,
    instancePath: blocker.instancePath,
    schemaPath: "",
    params: {},
    message: blocker.message,
  };
}

/** One error's identity, for comparison. */
type ErrorIdentity = { keyword: string; instancePath: string; message: string };

function identitiesOf(node: WorkflowBuilderNode): ErrorIdentity[] {
  const existing = (node.data?.properties as { customErrors?: unknown } | undefined)
    ?.customErrors;
  if (!Array.isArray(existing)) return [];

  return existing.flatMap((entry) => {
    const e = entry as Partial<ErrorIdentity> | null;
    return typeof e?.message === "string"
      ? [
          {
            keyword: typeof e.keyword === "string" ? e.keyword : "",
            instancePath: typeof e.instancePath === "string" ? e.instancePath : "",
            message: e.message,
          },
        ]
      : [];
  });
}

/**
 * ⚠️ COMPARES IDENTITY, NOT JUST THE SENTENCE — and that is load-bearing.
 *
 * An earlier version compared `message` alone. Moving a blocker from the root to
 * its own field changes ONLY `instancePath`; the wording is unchanged. Under a
 * message-only comparison the sync would see no difference, skip the write, and
 * the error would stay attached to the node instead of the field — a silent
 * no-op that looks exactly like "already up to date".
 */
function sameErrors(a: readonly ErrorIdentity[], b: readonly ErrorIdentity[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.keyword === b[i]!.keyword &&
        x.instancePath === b[i]!.instancePath &&
        x.message === b[i]!.message,
    )
  );
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

  // ⚠️ `arm-only` ONLY, AND THIS FILTER IS THE POINT OF THE WHOLE PASS.
  //
  // `findArmBlockersByNode` reports everything arming refuses, which includes
  // blank required fields, out-of-range numbers and the conditional body — and
  // the node's own JSON Schema refuses most of those already, with its own
  // message, rendered next to the field by the per-field error indicator.
  // Mirroring them into `customErrors` injects the SAME invariant a second time
  // at the data layer: two errors on one node for one mistake, differing only in
  // wording. Not a rendering detail — `Ga()` counts both toward validity.
  //
  // What is left is exactly the set the schema cannot see: a step left in draft,
  // a guest step under a guestless trigger, a keyword no kind can satisfy, a
  // fan-out pointing at itself, a callback routed to the sales agent. Those are
  // the ones an owner would otherwise meet for the first time by pressing "arm".
  const byNode = new Map<string, ErrorIdentity[]>();
  for (const blocker of blockers) {
    if (blocker.source !== "arm-only") continue;
    const entry = {
      keyword: ARM_BLOCKER_KEYWORD,
      instancePath: blocker.instancePath,
      message: blocker.message,
    };
    const list = byNode.get(blocker.nodeId);
    if (list) list.push(entry);
    else byNode.set(blocker.nodeId, [entry]);
  }

  let changed = false;
  const next = nodes.map((node) => {
    const wanted = byNode.get(node.id) ?? [];
    if (sameErrors(identitiesOf(node), wanted)) return node;
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
