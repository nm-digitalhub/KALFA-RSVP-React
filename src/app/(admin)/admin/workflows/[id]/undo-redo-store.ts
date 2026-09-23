// Undo / redo history for the workflow editor — the vendor's own plugin.
//
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Synergia Pro Sp. z o.o.
// Source: https://github.com/synergycodes/workflowbuilder
//   apps/demo/src/app/plugins/undo-redo/stores/use-undo-redo-store.ts
//   apps/demo/src/app/plugins/undo-redo/functions/decorators.ts
//   at commit b1f47943b723c628b6dd9f6cc67f160df58a55b8 (2026-09-22)
// License: https://www.apache.org/licenses/LICENSE-2.0
//
// MODIFIED (Apache-2.0 §4b): the two source files are merged into this one and
// the exports gained doc comments. The logic — snapshot shape, history cap,
// equality test, drag watchers, undo/redo order, and which change names the
// decorator ignores — is the vendor's, unchanged.
//
// ⚠️ WHY THIS IS A COPY AND NOT AN IMPORT. The plugin is not published: none of
// the nine `@workflowbuilder/*` plugin packages exists on npm (each returns
// 404), and only `@workflowbuilder/sdk` is installed. Undo/Redo is one of the
// two plugins the vendor's docs do NOT mark Enterprise, and its source is
// Apache-2.0 in their public repo — so the vendor's code is used as written
// rather than rebuilt by hand.
//
// It is built entirely on SDK exports this editor already depends on
// (`getStore*` / `setStore*` / `trackFutureChange`) plus zustand, which the SDK
// declares as a peer.
import {
  getStoreEdges,
  getStoreLayoutDirection,
  getStoreNodes,
  setStoreEdges,
  setStoreLayoutDirection,
  setStoreNodes,
  trackFutureChange,
} from '@workflowbuilder/sdk';
import type { LayoutDirection, WorkflowBuilderEdge, WorkflowBuilderNode } from '@workflowbuilder/sdk';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const DEFAULT_MAX_HISTORY_SIZE = 100;

type HistoryItem = {
  nodes: WorkflowBuilderNode[];
  edges: WorkflowBuilderEdge[];
  layoutDirection: LayoutDirection;
};

type SnapshotWatchers = {
  [name: string]: {
    snapshot?: HistoryItem;
  };
};

type UndoRedoStore = {
  snapshotsWatchers: SnapshotWatchers;
  past: HistoryItem[];
  future: HistoryItem[];
};

const emptyStore: UndoRedoStore = {
  snapshotsWatchers: {},
  past: [],
  future: [],
};

export const useUndoRedoStore = create<UndoRedoStore>()(
  devtools(
    () =>
      ({
        ...emptyStore,
      }) satisfies UndoRedoStore,
    { name: 'undoRedoStore' },
  ),
);

/**
 * Forget every step. Not in the vendor's store.
 *
 * MODIFIED: added because this editor is a route, not a page. The store is a
 * module singleton, so without a reset the history of one workflow would still
 * be there after navigating to another — and Ctrl+Z would paste the previous
 * workflow's nodes into this one. `workflow-editor.tsx` calls it on the same
 * workflow-change boundary as `resetExecution` and `resetPanels`.
 */
export function resetUndoRedo() {
  useUndoRedoStore.setState({ ...emptyStore });
}

function areSnapshotsEqual(previous: HistoryItem, current: HistoryItem): boolean {
  if (
    previous.nodes === current.nodes &&
    previous.edges === current.edges &&
    previous.layoutDirection === current.layoutDirection
  ) {
    return true;
  }

  return JSON.stringify(previous) === JSON.stringify(current);
}

// core function of undo/redo functionality
// is responsible for recording each step that we decide to record via takeSnapshot or processSnapshotWatching
export function takeSnapshot(snapshot?: HistoryItem) {
  const nodes = snapshot?.nodes || getStoreNodes();
  const edges = snapshot?.edges || getStoreEdges();
  const layoutDirection = snapshot?.layoutDirection || getStoreLayoutDirection();

  const newSnapshot: HistoryItem = { nodes, edges, layoutDirection };

  const lastSnapshot = useUndoRedoStore.getState().past.at(-1);
  if (lastSnapshot && areSnapshotsEqual(lastSnapshot, newSnapshot)) {
    return;
  }

  useUndoRedoStore.setState((state) => ({
    past: [...state.past.slice(state.past.length - DEFAULT_MAX_HISTORY_SIZE + 1), newSnapshot],
    future: [],
  }));
}

// startSnapshotWatching function is used to start observing changes such as moving a node around the diagram
// you can use it together with the onNodeDragStart function
export function startSnapshotWatching(name: string) {
  useUndoRedoStore.setState((state) => ({
    snapshotsWatchers: {
      ...state.snapshotsWatchers,
      [name]: {
        snapshot: {
          nodes: getStoreNodes(),
          edges: getStoreEdges(),
          layoutDirection: getStoreLayoutDirection(),
        },
      },
    },
  }));
}

export function stopSnapshotWatching(name: string) {
  useUndoRedoStore.setState((state) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [name]: snapshotRemoved, ...newSnapshotsWatchers } = state.snapshotsWatchers;

    return {
      snapshotsWatchers: newSnapshotsWatchers,
    };
  });
}

// processSnapshotWatching function is used during processes like dragging node
// you can use it with onNodesChange function
export function processSnapshotWatching(name: string, shouldSkip = false) {
  const item = useUndoRedoStore.getState().snapshotsWatchers[name];

  if (!item?.snapshot) {
    return;
  }

  if (!shouldSkip) {
    takeSnapshot(item.snapshot);
    stopSnapshotWatching(name);
  }
}

export function undo() {
  trackFutureChange('undo');

  const state = useUndoRedoStore.getState();
  const pastState = state.past.at(-1);

  if (pastState) {
    const nodes = getStoreNodes();
    const edges = getStoreEdges();
    const layoutDirection = getStoreLayoutDirection();

    useUndoRedoStore.setState((state) => ({
      past: state.past.slice(0, -1),
      future: [...state.future, { nodes, edges, layoutDirection }],
    }));

    setStoreNodes(pastState.nodes);
    setStoreEdges(pastState.edges);
    setStoreLayoutDirection(pastState.layoutDirection);
  }
}

export function redo() {
  trackFutureChange('redo');

  const state = useUndoRedoStore.getState();
  const futureState = state.future.at(-1);

  if (futureState) {
    const nodes = getStoreNodes();
    const edges = getStoreEdges();
    const layoutDirection = getStoreLayoutDirection();

    useUndoRedoStore.setState((state) => ({
      past: [...state.past, { nodes, edges, layoutDirection }],
      future: state.future.slice(0, -1),
    }));

    setStoreNodes(futureState.nodes);
    setStoreEdges(futureState.edges);
    setStoreLayoutDirection(futureState.layoutDirection);
  }
}

// ---------------------------------------------------------------------------
// From functions/decorators.ts
// ---------------------------------------------------------------------------

type TrackFutureChangeDecoratorParams = {
  params: unknown[];
};

const dragCallbackByCodename: {
  [codename: string]: (name: string) => void;
} = {
  nodeDragStart: startSnapshotWatching,
  nodeDragChange: processSnapshotWatching,
  nodeDragStop: stopSnapshotWatching,
};

/**
 * Every announced change becomes a history step — this is how the plugin hears
 * about them. Registered on the SDK's `trackFutureChange`, which the editor
 * calls before every diagram mutation it makes.
 *
 * ⚠️ WHICH IS WHY `app-bar.tsx` ANNOUNCES ITS LAYOUT FLIP. `setStoreNodes` and
 * `setStoreLayoutDirection` announce nothing, so a flip that did not call
 * `trackFutureChange('layoutDirection')` first would leave no step, and the next
 * Ctrl+Z would revert the flip together with whatever came before it.
 *
 * It also means the arm-blocker sync, which writes through `setStoreNodes`
 * without announcing, never lands in history — correct, since its markers are
 * recomputed from the diagram rather than being part of it.
 */
export function trackFutureChangeDecorator({ params }: TrackFutureChangeDecoratorParams) {
  const codename = typeof params[0] === 'string' ? params[0] : '';

  if (['undo', 'redo'].includes(codename)) {
    // Triggered by history skipping takeSnapshot()
    return;
  }

  const specialDragCallback = dragCallbackByCodename[codename];
  if (specialDragCallback) {
    specialDragCallback('nodeDrag');

    return;
  }

  takeSnapshot();
}
