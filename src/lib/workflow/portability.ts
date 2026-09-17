// Taking a workflow out of this installation, and bringing one in.
//
// A saved diagram already looks portable — `{ name, nodes, edges,
// layoutDirection, globalVariables }`, and nothing in it is scoped to an event
// (`workflows.event_id` is null on all 20 rows, measured 2026-09-16). What is
// not portable is what some nodes STORE: a connection uuid, another workflow's
// id, a webhook token that is the trigger's whole credential.
//
// PURE. No database, no clock, no Supabase. The one fact it cannot know on its
// own — whether a catalogue key exists at the destination — arrives as a
// predicate from the caller, because answering it means reading a table and this
// module is the part that must stay testable without one.
import { CATALOGUE } from './catalogue/nodes';
import {
  NODE_DEPLOYMENT_BINDINGS,
  type DeploymentBinding,
  type KalfaNodeType,
} from './catalogue/types';

/**
 * Stamped into every export and required on every import.
 *
 * Not decoration: an import is a file someone was handed, and the alternative to
 * refusing an unrecognised one is feeding arbitrary JSON to a schema parser and
 * hoping. The version moves when the meaning of the payload changes, not when
 * the catalogue grows — a diagram using a node this installation lacks is a
 * different failure, reported per node below.
 */
export const WORKFLOW_EXPORT_FORMAT = 'kalfa.workflow';
export const WORKFLOW_EXPORT_VERSION = 1;

export type WorkflowExportEnvelope = {
  format: typeof WORKFLOW_EXPORT_FORMAT;
  version: typeof WORKFLOW_EXPORT_VERSION;
  exportedAt: string;
  workflow: {
    name: string;
    layoutDirection?: unknown;
    nodes: unknown[];
    edges: unknown[];
    globalVariables?: unknown;
  };
  /**
   * What was taken out, so the file itself says what has to be supplied again.
   * Carries the property NAME and the reason — never the removed value.
   */
  removed: RemovedBinding[];
};

export type RemovedBinding = {
  nodeId: string;
  nodeType: string;
  /** The node's own label, so a person can find it again in the editor. */
  nodeLabel: string;
  property: string;
  binding: DeploymentBinding;
};

/** Answers whether a catalogue key means the same thing at the destination. */
export type CatalogueValueIsPortable = (property: string, value: string) => boolean;

type LooseNode = {
  id?: unknown;
  data?: { type?: unknown; properties?: Record<string, unknown> };
};

/**
 * Remove everything that would not survive the trip, and say what was removed.
 *
 * ⚠️ REMOVED, NOT BLANKED-AND-FORGOTTEN. The property is set to '' rather than
 * deleted, because a node whose required field is absent and one whose required
 * field is empty take different paths through the editor's schema — and the
 * arming gate already refuses the empty one with a message naming the field.
 * Deleting would instead produce a node the form cannot render.
 */
export function scrubForExport(
  definition: unknown,
  isPortableCatalogueValue: CatalogueValueIsPortable,
  now: () => number = Date.now,
): WorkflowExportEnvelope {
  const source = definition as {
    name?: unknown;
    layoutDirection?: unknown;
    nodes?: unknown;
    edges?: unknown;
    globalVariables?: unknown;
  } | null;

  const nodes = Array.isArray(source?.nodes) ? source.nodes : [];
  const removed: RemovedBinding[] = [];

  const scrubbedNodes = nodes.map((raw) => {
    const node = raw as LooseNode;
    const nodeType = typeof node.data?.type === 'string' ? node.data.type : '';
    const bindings = NODE_DEPLOYMENT_BINDINGS[nodeType as KalfaNodeType];
    if (!bindings || !node.data?.properties) return raw;

    const properties = { ...node.data.properties };
    let changed = false;

    for (const [property, binding] of Object.entries(bindings)) {
      const value = properties[property];
      // Nothing stored means nothing to remove — and reporting it would tell an
      // operator to re-supply a field they never filled.
      if (value === undefined || value === null || value === '') continue;

      if (binding === 'catalogue') {
        // A key the destination also has is the whole point of the kind: the
        // three built-in voice purposes and every compiled-in template key
        // travel, an operator's own additions do not.
        if (typeof value === 'string' && isPortableCatalogueValue(property, value)) continue;
      }

      properties[property] = '';
      changed = true;
      removed.push({
        nodeId: typeof node.id === 'string' ? node.id : '',
        nodeType,
        nodeLabel:
          typeof node.data.properties.label === 'string' ? node.data.properties.label : '',
        property,
        binding,
      });
    }

    return changed ? { ...(raw as object), data: { ...node.data, properties } } : raw;
  });

  return {
    format: WORKFLOW_EXPORT_FORMAT,
    version: WORKFLOW_EXPORT_VERSION,
    exportedAt: new Date(now()).toISOString(),
    workflow: {
      name: typeof source?.name === 'string' ? source.name : '',
      ...(source?.layoutDirection !== undefined
        ? { layoutDirection: source.layoutDirection }
        : {}),
      nodes: scrubbedNodes,
      edges: Array.isArray(source?.edges) ? source.edges : [],
      ...(source?.globalVariables !== undefined
        ? { globalVariables: source.globalVariables }
        : {}),
    },
    removed,
  };
}

export type ImportRejection =
  | { reason: 'not_an_export' }
  | { reason: 'unsupported_version'; found: unknown }
  | { reason: 'unknown_node_types'; types: string[] };

export type ImportReadResult =
  | { ok: true; definition: Record<string, unknown>; mustBeSupplied: RemovedBinding[] }
  | { ok: false; rejection: ImportRejection };

/**
 * Read an envelope and hand back a definition to save, or say why not.
 *
 * ⚠️ IT DOES NOT VALIDATE THE DIAGRAM, AND MUST NOT START. `saveWorkflowDefinition`
 * already parses it with `editorDiagramSchema` and refuses a bad shape; a second
 * validator here would be a second opinion that can disagree with the one that
 * actually gates the write. What this adds is the two questions that parser
 * cannot answer: is this even one of our files, and does this installation have
 * every node type the file names.
 */
export function readImportEnvelope(candidate: unknown): ImportReadResult {
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, rejection: { reason: 'not_an_export' } };
  }

  const envelope = candidate as Partial<WorkflowExportEnvelope>;
  if (envelope.format !== WORKFLOW_EXPORT_FORMAT) {
    return { ok: false, rejection: { reason: 'not_an_export' } };
  }
  if (envelope.version !== WORKFLOW_EXPORT_VERSION) {
    return { ok: false, rejection: { reason: 'unsupported_version', found: envelope.version } };
  }

  const workflow = envelope.workflow;
  if (typeof workflow !== 'object' || workflow === null || !Array.isArray(workflow.nodes)) {
    return { ok: false, rejection: { reason: 'not_an_export' } };
  }

  // A file written where a node type exists and read where it does not would
  // otherwise load a node the editor cannot render and the converter cannot run.
  const known = new Set<string>(CATALOGUE.map((entry) => entry.type));
  const unknown = [
    ...new Set(
      workflow.nodes
        .map((n) => (n as LooseNode).data?.type)
        .filter((t): t is string => typeof t === 'string' && !known.has(t)),
    ),
  ];
  if (unknown.length > 0) {
    return { ok: false, rejection: { reason: 'unknown_node_types', types: unknown } };
  }

  return {
    ok: true,
    definition: { ...workflow },
    // Carried through from the file rather than recomputed: the export knew what
    // it took out, and re-deriving it here would answer a different question —
    // "what is blank now", which includes fields the author simply never filled.
    mustBeSupplied: Array.isArray(envelope.removed) ? envelope.removed : [],
  };
}
