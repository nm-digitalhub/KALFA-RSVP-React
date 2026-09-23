'use client';

// Copy & paste — the vendor's plugin, on the vendor's IN-MEMORY clipboard.
//
// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Synergia Pro Sp. z o.o.
// Source: https://github.com/synergycodes/workflowbuilder
//   apps/demo/src/app/plugins/copy-paste/plugin-exports.ts
//   apps/demo/src/app/plugins/copy-paste/providers/copy-paste-provider.ts
//   apps/demo/src/app/plugins/copy-paste/libs/types.ts
//   apps/demo/src/app/plugins/copy-paste/libs/hooks/use-copy-paste.tsx
//   apps/demo/src/app/plugins/copy-paste/libs/hooks/use-flow-mouse-position.tsx
//   apps/demo/src/app/plugins/copy-paste/libs/hooks/use-copy-paste-keyboard-handler.tsx
//   at commit b1f47943b723c628b6dd9f6cc67f160df58a55b8 (2026-09-22)
// License: https://www.apache.org/licenses/LICENSE-2.0
//
// MODIFIED (Apache-2.0 §4b) in three places, plus one type-only change noted
// after them. Every hook body below is otherwise the vendor's.
//
//   1. `useCopyPaste`, NOT `useExternalCopyPaste`. MEASURED, and a security
//      decision this codebase already made once. The vendor's provider uses the
//      external hook, which writes `JSON.stringify(selection)` to
//      `navigator.clipboard` — and `pasteElements` spreads `...node`, so that is
//      every node's `properties` as stored. That includes `action.webhook` URLs
//      and headers an owner may have typed a key into, which is precisely what
//      `export-diagram.tsx` scrubs before its own copyable box, because "an
//      exported blob travels further than a screenshot". The OS clipboard is
//      readable by every clipboard manager and every other app. The vendor ships
//      BOTH hooks in the same lib; this is their other one, documented by them as
//      "in-memory … fast, session-only operations".
//
//      A consequence worth having rather than a loss to mitigate: the clipboard
//      is `useState` inside a provider mounted under `<Root key={workflowId}>`,
//      so it empties when another workflow opens. A webhook trigger therefore
//      cannot be pasted into a second workflow carrying the first one's
//      `endpointId` / `tokenHash` — two armed workflows sharing one address,
//      where `findWorkflowForEndpoint` returns the first and the other never
//      fires. What IS lost is pasting across browser tabs.
//
//   2. The keyboard hook is the SDK's exported `useKeyPress`, not the plugin's
//      own `use-key-press.ts`. MEASURED equivalent: the plugin's
//      `isReactFlowDiagramTarget` and the SDK's `UF` are identical to the
//      character, comment included, and the plugin file's own TODO says it is a
//      stopgap. The published one also stops calling `preventDefault` on keyup
//      inside form fields. No `skipTarget`, as in the vendor's handler — so a
//      text field in the properties panel keeps its own Ctrl+C / Ctrl+V.
//
//   3. Paste is announced only when there is something to paste. The vendor
//      guards on `navigator.clipboard.readText()` being non-empty; with an
//      in-memory clipboard the equivalent is "has anything been copied", held
//      in a ref. Without the guard, Ctrl+V on an empty clipboard would still
//      call `trackFutureChange('paste')` and leave an undo step that changes
//      nothing. It is also why `handleCopy` wraps `copy` rather than being it.
//
// And one type-only change: `KeyboardHandler`'s members are `() => void` rather
// than the vendor's `Function` (which needed an eslint-disable). No runtime
// difference — every handler is called with no arguments.
import {
  getStoreEdges,
  getStoreNodes,
  getStoreSelection,
  registerComponentDecorator,
  resetStoreSelection,
  trackFutureChange,
  useKeyPress,
  useStore,
} from '@workflowbuilder/sdk';
import { type Edge, type Node, useReactFlow, useViewport } from '@xyflow/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  type GetHandleId,
  type Position,
  type Selection,
  getSelectionWithNodesBetween,
  pasteElements,
  removeElements,
} from './copy-paste-utils';

// ---------------------------------------------------------------------------
// libs/types.ts — the two types only the hooks below use
// ---------------------------------------------------------------------------

type FlowMousePosition = {
  /** Raw screen coordinates (relative to browser window) */
  screen: Position;
  /**
   * Diagram-space coordinates for absolute positioning with CSS transform
   * These are relative to the diagram container.
   */
  diagram: Position;
  /**
   * Flow-space coordinates (accounting for zoom and pan)
   * These are useful for node placement or data operations (e.g., adding new nodes)
   */
  flow: Position;
  /** Whether mouse is inside the flow */
  isInsideFlow: boolean;
  /** Current zoom level */
  zoom: number;
  /** Current pan offset */
  pan: Position;
};

type KeyboardHandler = {
  handleCut: () => void;
  handleCopy: () => void;
  handlePaste: () => void;
};

// ---------------------------------------------------------------------------
// libs/hooks/use-copy-paste.tsx — unchanged
// ---------------------------------------------------------------------------

type UseCopyPasteParams = {
  getSelection: () => Selection;
  getEdges: () => Edge[];
  getNodes: () => Node[];
  getHandleId: GetHandleId;
  shouldCopyEdgeBetween: boolean;
  resetSelectedElements: () => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  generateId: () => string;
};

/**
 * React hook for in-memory cut, copy, and paste of diagram elements.
 *
 * Provides copy, cut, and paste operations using an in-memory clipboard. Use this for fast, session-only operations.
 */
const useCopyPaste = ({
  getSelection,
  getEdges,
  resetSelectedElements,
  shouldCopyEdgeBetween = true,
  getNodes,
  setNodes,
  setEdges,
  generateId,
  getHandleId,
}: UseCopyPasteParams) => {
  const [clipboard, setClipboard] = useState<Selection>();

  const handleGetSelection = useCallback(() => {
    let selection = getSelection();

    if (!selection) {
      console.warn('useCopyPaste: No selection');
      return;
    }

    if (shouldCopyEdgeBetween && selection.nodes.length > 1) {
      selection = getSelectionWithNodesBetween(selection, getEdges());
    }

    return selection;
  }, [getSelection, getEdges, shouldCopyEdgeBetween]);

  const copy = useCallback(() => {
    const selection = handleGetSelection();

    setClipboard(selection);

    return selection;
  }, [handleGetSelection]);

  const cut = useCallback(() => {
    const selection = copy();

    if (!selection) return;

    removeElements({
      elements: selection,
      getNodes,
      setNodes,
      getEdges,
      setEdges,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copy]);

  const paste = useCallback(
    ({ mousePosition = { x: 0, y: 0 } }: { mousePosition?: Position } = {}) => {
      if (!clipboard) {
        console.warn('useCopyPaste: Clipboard is empty');

        return;
      }

      resetSelectedElements();

      pasteElements({
        elements: structuredClone(clipboard),
        mousePosition,
        getNodes,
        setNodes,
        getEdges,
        setEdges,
        generateId,
        getHandleId,
      });
    },
    [clipboard, resetSelectedElements, getNodes, getEdges, setNodes, setEdges, generateId, getHandleId],
  );

  return {
    copy,
    cut,
    paste,
  };
};

// ---------------------------------------------------------------------------
// libs/hooks/use-flow-mouse-position.tsx — unchanged
// ---------------------------------------------------------------------------

type UseGetFlowMousePositionOptions = {
  /** Custom selector to target flow container. Falls back to ".react-flow" */
  selector?: string;
};

function useGetFlowMousePosition({ selector = '.react-flow' }: UseGetFlowMousePositionOptions = {}) {
  const { screenToFlowPosition } = useReactFlow();

  const viewport = useViewport();
  const flowContainerRef = useRef<Element | null>(null);

  // Check if a point is inside the flow container
  const isPointInsideFlow = useCallback((point: Position) => {
    if (!flowContainerRef.current) return false;

    const rect = flowContainerRef.current.getBoundingClientRect();

    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }, []);

  const getMousePositionFromEvent = useCallback(
    <T extends { clientX: number; clientY: number }>(event: T) => {
      const screenPosition = { x: event.clientX, y: event.clientY };
      const isInside = isPointInsideFlow(screenPosition);

      const { zoom = 1, x: panX = 0, y: panY = 0 } = viewport;

      let diagramPosition = { x: 0, y: 0 };
      let flowPosition = { x: 0, y: 0 };

      if (flowContainerRef.current) {
        const rect = flowContainerRef.current.getBoundingClientRect();

        // Calculate diagram-relative position
        diagramPosition = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };

        if (isInside) {
          // Use the react-flow utility to get flow coordinates
          // This returns the virtual coordinates in the flow space
          flowPosition = screenToFlowPosition(screenPosition, {
            snapToGrid: false,
          });
        }
      }

      return {
        screen: screenPosition,
        diagram: diagramPosition,
        flow: flowPosition,
        isInsideFlow: isInside,
        zoom,
        pan: { x: panX, y: panY },
      };
    },
    [screenToFlowPosition, viewport, isPointInsideFlow],
  );

  // Attach the ref to the container on mount or selector change
  useLayoutEffect(() => {
    const container = document.querySelector(selector);
    if (container) {
      flowContainerRef.current = container;
    }
  }, [selector]);

  return { getMousePositionFromEvent, flowContainerRef };
}

type UseFlowMousePositionOptions = {
  selector?: string;
  enabled?: boolean;
};

function useFlowMousePosition({ selector = '.react-flow', enabled = true }: UseFlowMousePositionOptions = {}) {
  const viewport = useViewport();

  const { getMousePositionFromEvent, flowContainerRef } = useGetFlowMousePosition({ selector });

  const isMounted = useRef<boolean>(false);
  const [mousePosition, setMousePosition] = useState<FlowMousePosition>({
    screen: { x: 0, y: 0 },
    diagram: { x: 0, y: 0 },
    flow: { x: 0, y: 0 },
    isInsideFlow: false,
    zoom: 1,
    pan: { x: 0, y: 0 },
  });

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      setMousePosition(getMousePositionFromEvent(event));
    },
    [getMousePositionFromEvent],
  );

  const handleMouseLeave = useCallback(() => {
    setMousePosition((previous) => ({
      ...previous,
      isInsideFlow: false,
    }));
  }, []);

  const handleMouseEnter = useCallback(() => {
    setMousePosition((previous) => ({
      ...previous,
      isInsideFlow: true,
    }));
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;

    if (flowContainerRef.current) {
      globalThis.addEventListener('mousemove', handleMouseMove, { passive: true });

      flowContainerRef.current.addEventListener('mouseenter', handleMouseEnter);
      flowContainerRef.current.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      isMounted.current = true;
      globalThis.removeEventListener('mousemove', handleMouseMove);

      if (flowContainerRef.current) {
        flowContainerRef.current.removeEventListener('mouseenter', handleMouseEnter);
        // eslint-disable-next-line react-hooks/exhaustive-deps
        flowContainerRef.current.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMouseMove, handleMouseEnter, handleMouseLeave, selector, enabled]);

  useEffect(() => {
    if (!enabled) return;

    if (isMounted.current && mousePosition.isInsideFlow) {
      // Force a position update when viewport changes
      const event = new MouseEvent('mousemove', {
        clientX: mousePosition.screen.x,
        clientY: mousePosition.screen.y,
      });

      handleMouseMove(event);
    }
  }, [viewport, handleMouseMove, mousePosition.screen.x, mousePosition.screen.y, mousePosition.isInsideFlow, enabled]);

  return mousePosition;
}

// ---------------------------------------------------------------------------
// libs/hooks/use-copy-paste-keyboard-handler.tsx — see (2)
// ---------------------------------------------------------------------------

/**
 * React hook to handle keyboard shortcuts for cut, copy, and paste actions.
 *
 * Listens for Ctrl/Cmd+X, Ctrl/Cmd+C, and Ctrl/Cmd+V and triggers the provided handlers.
 */
const useCopyPasteKeyboardHandler = ({ handleCut, handleCopy, handlePaste }: KeyboardHandler) => {
  const x = useKeyPress('x', { withControlOrMeta: true });
  const c = useKeyPress('c', { withControlOrMeta: true });
  const v = useKeyPress('v', { withControlOrMeta: true });

  useEffect(() => {
    if (x) {
      handleCut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x]);

  useEffect(() => {
    if (c) {
      handleCopy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  useEffect(() => {
    if (v) {
      handlePaste();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
};

// ---------------------------------------------------------------------------
// providers/copy-paste-provider.ts — see (1) and (3)
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomUUID();
}

const getHandleIdForCopyPaste: GetHandleId = (params) => {
  if (!params.oldHandleId) {
    return null;
  }

  return params.oldHandleId.replace(params.oldNodeId, params.newNodeId);
};

function CopyPasteProviderComponent({ children }: { children?: ReactNode }) {
  const isReadOnlyMode = useStore((store) => store.isReadOnlyMode);
  const mousePosition = useFlowMousePosition();

  const { setNodes, setEdges } = useReactFlow();

  const { cut, copy, paste } = useCopyPaste({
    getSelection: getStoreSelection,
    getEdges: getStoreEdges,
    resetSelectedElements: resetStoreSelection,
    shouldCopyEdgeBetween: true,
    getNodes: getStoreNodes,
    setNodes,
    setEdges,
    generateId,
    getHandleId: getHandleIdForCopyPaste,
  });

  // (3) — the in-memory counterpart of the vendor's `readText()` guard.
  const hasCopied = useRef(false);

  const handleCopy = useCallback(() => {
    const selection = copy();
    if (selection && selection.nodes.length > 0) hasCopied.current = true;
  }, [copy]);

  const handleCut = useCallback(() => {
    if (isReadOnlyMode) {
      return;
    }

    const selection = getStoreSelection();

    if (selection) {
      trackFutureChange('cut');
      cut();
      if (selection.nodes.length > 0) hasCopied.current = true;
    }
  }, [cut, isReadOnlyMode]);

  const handlePaste = useCallback(() => {
    if (isReadOnlyMode) {
      return;
    }

    if (hasCopied.current) {
      trackFutureChange('paste');
      paste({ mousePosition: mousePosition.flow });
    }
  }, [isReadOnlyMode, mousePosition.flow, paste]);

  useCopyPasteKeyboardHandler({
    handleCut,
    handleCopy,
    handlePaste,
  });

  return children;
}

/**
 * From plugin-exports.ts, unchanged: one registration, into `OptionalHooks`.
 *
 * MEASURED that it runs where it has to. The root shell `DB` renders the
 * OptionalHooks host `CB` unconditionally — whether or not `<Root>` is given
 * children, which this editor always does — and `DB` is itself rendered inside
 * xyflow's `ReactFlowProvider` (`Bv` in `$B`, the 2.3.0 `<Root>`), so
 * `useReactFlow()` and `useViewport()` above have their context.
 */
export function copyPastePlugin(): void {
  registerComponentDecorator('OptionalHooks', {
    content: CopyPasteProviderComponent,
    name: 'CopyPasteProvider',
  });
}
