// Copy & paste — the pure half of the vendor's plugin.
//
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Synergia Pro Sp. z o.o.
// Source: https://github.com/synergycodes/workflowbuilder
//   apps/demo/src/app/plugins/copy-paste/libs/types.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/points.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/position-utils.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/calculate-pasted-node-position.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/get-selection-with-nodes-between.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/paste-elements.ts
//   apps/demo/src/app/plugins/copy-paste/libs/utils/remove-elements.ts
//   at commit b1f47943b723c628b6dd9f6cc67f160df58a55b8 (2026-09-22)
// License: https://www.apache.org/licenses/LICENSE-2.0
//
// MODIFIED (Apache-2.0 §4b): seven files merged into one, and two members of
// the vendor's files are not carried over because nothing in the plugin calls
// them — `transformPointFromWindowToDiagramCoordinates` (position-utils.ts) and
// the `FlowMousePosition` / `KeyboardHandler` types, which move to
// `copy-paste.tsx` beside the hooks that use them. Every function below is the
// vendor's, unchanged.
//
// ⚠️ THE SYSTEM-CLIPBOARD UTILITIES ARE DELIBERATELY ABSENT. The vendor's lib
// also ships `copy-to-clipboard.ts`, `paste-from-clipboard.ts` and
// `ensure-clipboard-supported.ts`, which back `useExternalCopyPaste`. This port
// uses the vendor's other hook, `useCopyPaste`, and so never touches
// `navigator.clipboard` — see copy-paste.tsx for why.
import { type Edge, type Node, type XYPosition, getNodesBounds } from '@xyflow/react';

export type Selection = {
  nodes: Node[];
  edges: Edge[];
};

export type Position = {
  x: number;
  y: number;
};

export type GetHandleId = (params: {
  /**
   * The type of handle to get the ID for.
   * Can be 'source' or 'target'.
   */
  type: 'source' | 'target';
  /**
   * The ID of the new node to create.
   */
  newNodeId: string;
  /**
   * The ID of copied node's handle.
   */
  oldHandleId: string | null;
  /**
   * The ID of copied node.
   */
  oldNodeId: string;
}) => string | null;

// ---------------------------------------------------------------------------
// points.ts
// ---------------------------------------------------------------------------

export const addPoints = (point1: Position | XYPosition, point2: Position | XYPosition) => ({
  x: point1.x + point2.x,
  y: point1.y + point2.y,
});

export const subtractPoints = (point1: Position | XYPosition, point2: Position | XYPosition) => ({
  x: point1.x - point2.x,
  y: point1.y - point2.y,
});

// ---------------------------------------------------------------------------
// position-utils.ts
// ---------------------------------------------------------------------------

export const getNodesCenterPoint = (nodes: Node[]): Position => {
  const bounds = getNodesBounds(nodes);

  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};

// ---------------------------------------------------------------------------
// calculate-pasted-node-position.ts
// ---------------------------------------------------------------------------

export const calculateNodePastePositionOffset = (nodes: Node[], pastePosition: Position): Position => {
  const nodesCenterPoint = getNodesCenterPoint(nodes);

  return subtractPoints(pastePosition, nodesCenterPoint);
};

// ---------------------------------------------------------------------------
// get-selection-with-nodes-between.ts
// ---------------------------------------------------------------------------

const getEdgesByNodeId = (nodeId: string, edges: Edge[]) =>
  edges.filter((edge: Edge) => edge.source === nodeId || edge.target === nodeId);

export const getSelectionWithNodesBetween = (selection: Selection, edges: Edge[]) => {
  const nodesIds = new Set(selection.nodes.map((node: Node) => node.id));

  const allEdges = selection.nodes.flatMap((node: Node) => getEdgesByNodeId(node.id, edges));

  const uniqueEdges = [...new Map(allEdges.map((edge: Edge) => [edge.id, edge])).values()];
  const currentEdges = uniqueEdges.filter((edge: Edge) => nodesIds.has(edge.source) && nodesIds.has(edge.target));

  selection.edges = currentEdges;

  return selection;
};

// ---------------------------------------------------------------------------
// paste-elements.ts
// ---------------------------------------------------------------------------

/**
 * Utility to paste a selection of nodes and edges at a given position in the diagram.
 *
 * Handles ID remapping and edge handle updates. Optionally accepts a getHandleId function for custom edge handle logic.
 *
 * @param elements - Object containing nodes and edges to paste
 * @param mousePosition - Position where to paste the selection
 * @param getNodes - Function to get current nodes
 * @param setNodes - Function to set nodes
 * @param getEdges - Function to get current edges
 * @param setEdges - Function to set edges
 * @param generateId - Function to generate unique IDs
 * @param getHandleId - Function to get handle IDs for pasted elements
 * @returns void
 */
export const pasteElements = ({
  elements,
  mousePosition,
  getNodes,
  setNodes,
  getEdges,
  setEdges,
  generateId,
  getHandleId,
}: {
  elements: { nodes: Node[]; edges: Edge[] };
  mousePosition: Position;
  getNodes: () => Node[];
  setNodes: (nodes: Node[]) => void;
  getEdges: () => Edge[];
  setEdges: (edges: Edge[]) => void;
  generateId: () => string;
  getHandleId: GetHandleId;
}) => {
  const { nodes, edges } = elements;
  const mappedIds: Record<string, string> = {};

  if (nodes.length > 0) {
    const nodePasteOffset = calculateNodePastePositionOffset(nodes, mousePosition);

    const nodesToPaste = nodes.map((node) => {
      const newId = generateId();
      mappedIds[node.id] = newId;

      return {
        ...node,
        id: newId,
        position: addPoints(node.position, nodePasteOffset),
        selected: true,
      };
    });

    setNodes([...getNodes().map((node) => (node.selected ? { ...node, selected: false } : node)), ...nodesToPaste]);
  }

  // ⚠️ THE `!` ON `mappedIds[…]` BELOW IS TYPE-ONLY, AND IT IS NOT ALWAYS TRUE.
  // Added to satisfy `noUncheckedIndexedAccess`; the runtime is the vendor's,
  // unchanged. An edge whose other end was NOT copied has no entry, so the value
  // is `undefined` there. `getSelectionWithNodesBetween` drops such edges — but
  // the caller applies it only when MORE THAN ONE node is selected, so a single
  // node copied together with an explicitly selected edge keeps it, and the
  // pasted edge reconnects to the original neighbour (`mappedIds[x] || x`).
  // That is the vendor's behaviour and is left as found.
  if (edges.length > 0) {
    setEdges([
      ...getEdges().map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
      ...edges.map(({ source, target, sourceHandle = null, targetHandle = null, ...edge }) => ({
        ...edge,
        selected: true,
        sourceHandle: getHandleId
          ? getHandleId({
              type: 'source',
              newNodeId: mappedIds[source]!,
              oldNodeId: source,
              oldHandleId: sourceHandle,
            })
          : sourceHandle,
        targetHandle: getHandleId
          ? getHandleId({
              type: 'target',
              newNodeId: mappedIds[target]!,
              oldNodeId: target,
              oldHandleId: targetHandle,
            })
          : targetHandle,
        source: mappedIds[source] || source,
        target: mappedIds[target] || target,
        id: crypto.randomUUID(),
      })),
    ]);
  }
};

// ---------------------------------------------------------------------------
// remove-elements.ts
// ---------------------------------------------------------------------------

/**
 * Utility to remove a selection of nodes and edges from the diagram.
 *
 * @param elements - Object containing nodes and/or edges to remove
 * @param getNodes - Function to get current nodes
 * @param setNodes - Function to set nodes
 * @param getEdges - Function to get current edges
 * @param setEdges - Function to set edges
 * @returns void
 */
export const removeElements = ({
  elements,
  getNodes,
  setNodes,
  getEdges,
  setEdges,
}: {
  elements: { nodes?: Node[]; edges?: Edge[] };
  getNodes: () => Node[];
  setNodes: (nodes: Node[]) => void;
  getEdges: () => Edge[];
  setEdges: (edges: Edge[]) => void;
}) => {
  const { nodes, edges } = elements;
  if (nodes) {
    setNodes(getNodes().filter((node) => !nodes.some((nodeToRemove) => nodeToRemove.id === node.id)));
  }

  if (edges) {
    setEdges(getEdges().filter((edge) => !edges.some((edgeToRemove) => edgeToRemove.id === edge.id)));
  }
};
