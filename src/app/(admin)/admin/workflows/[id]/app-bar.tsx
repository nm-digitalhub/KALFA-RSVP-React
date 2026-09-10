'use client';

// The two controls the SDK's own app bar does not have, and the two it hides.
//
// `<WorkflowBuilder.TopBar />` ships: the logo, the Save button (with its save
// status and, crucially, the SDK's auto-save), the workflow name with a kebab
// holding Settings, the read-only toggle, the dark-mode toggle, and a dots menu
// holding Export / Import. Read out of the shipped bundle — `AppBarContainer`
// renders exactly three children and none of them is a panel toggle, a fit-view
// control, or a layout-direction control.
//
// So this file supplies those four, split by how often they are used:
//
//   * Palette and Properties become buttons in `OptionalAppBarControls`. They
//     are the two the owner reaches for constantly, and on a phone the panels
//     are overlays that cannot be opened any other way.
//   * Fit-view and layout-direction join Export / Import in the existing dots
//     menu via `getControlsDotsItems`. They are occasional, and the app bar's
//     `._controls_` row is the part that runs out of width first on a phone —
//     seven icon buttons do not fit in 360px, five do.
import {
  Icon,
  getStoreLayoutDirection,
  getStoreNodes,
  registerComponentDecorator,
  registerFunctionDecorator,
  setStoreLayoutDirection,
  setStoreNodes,
  useSingleSelectedElement,
  useStore,
} from '@workflowbuilder/sdk';

import { setPropertiesOpen, usePanelsStore } from './use-panels-store';

/**
 * Fit the whole diagram into view.
 *
 * Deliberately `instance.fitView` and not the SDK's `useFitView`: that hook
 * measures its padding from window coordinates via a global lookup of
 * `#viewport-bounds`, which is right for a full-page editor and wrong for one
 * embedded in an admin route with a sidebar beside it. (The `#viewport-bounds`
 * element still has to exist — two SDK-internal paths read it — and the layout
 * still renders it.)
 */
function fitView() {
  void useStore.getState().reactFlowInstance?.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
}

/**
 * Flip RIGHT ↔ DOWN and reflow the node coordinates to match.
 *
 * This is `useWorkflowBuilderActions().toggleLayoutDirection({ flipPositions: true })`
 * rebuilt from the four exported store functions, because a dots-menu item's
 * `onClick` is a plain callback with no hook context. The two are the same
 * operation: set the opposite direction, then swap every node's x and y.
 */
function toggleLayoutDirection() {
  setStoreLayoutDirection(getStoreLayoutDirection() === 'RIGHT' ? 'DOWN' : 'RIGHT');
  setStoreNodes(
    getStoreNodes().map((node) => ({
      ...node,
      position: { x: node.position.y, y: node.position.x },
    })),
  );
  requestAnimationFrame(fitView);
}

function KalfaAppBarControls() {
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const isPropertiesOpen = usePanelsStore((s) => s.isPropertiesOpen);
  const isCompact = usePanelsStore((s) => s.isCompact);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);

  return (
    <>
      <button
        type="button"
        className="kalfa-workflow-appbar-button"
        aria-label="ספריית צעדים"
        title="ספריית צעדים"
        aria-expanded={isPaletteExpanded}
        aria-controls="workflow-palette"
        aria-pressed={isPaletteExpanded}
        onClick={() => {
          toggleSidebar(!isPaletteExpanded);
          // Only when they would sit on top of each other. Side by side, both
          // panels open at once is the useful arrangement.
          if (isCompact) setPropertiesOpen(false);
        }}
      >
        <Icon name="TreeStructure" />
      </button>
      <button
        type="button"
        className="kalfa-workflow-appbar-button"
        aria-label="מאפיינים"
        title="מאפיינים"
        aria-expanded={isPropertiesOpen && hasSelection}
        aria-controls="workflow-properties"
        aria-pressed={isPropertiesOpen && hasSelection}
        disabled={!hasSelection}
        onClick={() => {
          setPropertiesOpen(!isPropertiesOpen);
          if (isCompact) toggleSidebar(false);
        }}
      >
        <Icon name="SlidersHorizontal" />
      </button>
    </>
  );
}

/**
 * Mounts the app-bar additions.
 *
 * `name` is passed on both registrations for the same reason as the execution
 * markers: the registries are module-global singletons and registration is
 * side-effecting, so under Fast Refresh a nameless entry accumulates one copy
 * per edit. On a name match the registry REPLACES rather than appends.
 */
export function appBarPlugin(): void {
  registerComponentDecorator('OptionalAppBarControls', {
    content: KalfaAppBarControls,
    // 'before' puts them ahead of the read-only and dark-mode toggles, so the
    // two controls that change what is on screen sit closest to the canvas.
    place: 'before',
    name: 'kalfa-app-bar-controls',
  });

  registerFunctionDecorator('getControlsDotsItems', {
    place: 'after',
    // The vendor's own two items (Export / Import) come through `returnValue`
    // untouched and ours are appended, so an SDK upgrade that adds a third item
    // keeps it instead of having it replaced by this list.
    callback: ({ returnValue }) => ({
      replacedReturn: [
        ...(Array.isArray(returnValue) ? returnValue : []),
        {
          label: 'הצגת הכול',
          icon: <Icon name="ArrowsOut" />,
          onClick: fitView,
        },
        {
          label: 'כיוון הזרימה',
          icon: <Icon name="GitBranch" />,
          onClick: toggleLayoutDirection,
        },
      ],
    }),
    name: 'kalfa-app-bar-menu',
  });
}
