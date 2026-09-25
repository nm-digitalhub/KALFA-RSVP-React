'use client';

import { useStore } from '@workflowbuilder/sdk';

import { setPropertiesOpen } from './use-panels-store';

// Select a step on the canvas from outside it — a log row — so its properties
// panel opens with what it did in the run.
//
// ⚠️ THE SDK HAS NO "SELECT THIS NODE" CALL. Its store API documents
// `getStoreSelection` / `resetStoreSelection` / `setStoreNodes`, and the last
// replaces and RE-VALIDATES every node — too heavy for a click. Its FAQ says the
// React Flow API underneath stays available, and the vendor's own copy-paste
// (`copy-paste-utils.ts`) selects exactly this way: `setNodes` with
// `selected: true`. The SDK store hears it as an ordinary selection change, the
// same one a click on the node produces.
//
// ⚠️ `setPropertiesOpen(true)` AS WELL, because the editor opens the panel on a
// selection CHANGE (`workflow-editor.tsx`). Clicking a row for the step that is
// already selected, after the panel was closed, changes nothing — and must
// still open it.
//
// Returns false when the step is not on the canvas any more (deleted since the
// run), so the caller can say so instead of doing nothing.
export function focusNodeOnCanvas(nodeId: string): boolean {
  const instance = useStore.getState().reactFlowInstance;
  if (!instance?.getNode(nodeId)) return false;

  instance.setNodes((nodes) =>
    nodes.map((node) => {
      const selected = node.id === nodeId;
      return Boolean(node.selected) === selected ? node : { ...node, selected };
    }),
  );
  instance.setEdges((edges) => edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
  setPropertiesOpen(true);
  void instance.fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1 });
  return true;
}
