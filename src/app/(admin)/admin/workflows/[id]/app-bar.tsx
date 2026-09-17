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
  trackFutureChange,
  useSingleSelectedElement,
  useStore,
} from '@workflowbuilder/sdk';

import { isVendorExportItem, openScrubbedExport } from './export-diagram';
import { useEffect, useRef } from 'react';

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
 *
 * ⚠️ ONE DELIBERATE DIFFERENCE FROM THE VENDOR'S VERSION: the announcement.
 *
 * `setStoreLayoutDirection` and `setStoreNodes` are both a bare
 * `useStore.setState` — read them in `store/slices/diagram-slice/actions.ts`,
 * neither announces anything. The vendor's `toggleLayoutDirection` announces
 * nothing either, so upstream a layout flip is invisible to every subscriber of
 * the changes tracker. Two consequences, and both are wrong:
 *
 *   * Auto-save never learns the diagram is dirty. `layoutDirection` and every
 *     node position are both persisted fields, so the flip is a real, saveable
 *     change — and dropping a dragged node (`nodeDragStop`) already announces
 *     itself for exactly that reason. Only two names are on the SDK's skip list
 *     (`nodeDragStart`, `nodeDragChange`); this one is not, by design.
 *   * A history plugin snapshots on announcement only. Without one, a flip
 *     leaves no entry, so the next undo restores a snapshot taken BEFORE the
 *     flip — reverting the flip together with whatever the user actually meant
 *     to undo. One Ctrl+Z, two actions.
 *
 * `trackFutureChange` is announced FIRST and the name is ours. The tracker takes
 * a plain `string` with no validation, and every published SDK name is spoken by
 * the SDK itself; `'layoutDirection'` cannot collide with one.
 */
function toggleLayoutDirection() {
  trackFutureChange('layoutDirection');
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
  const anchor = useRef<HTMLButtonElement>(null);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const isPropertiesOpen = usePanelsStore((s) => s.isPropertiesOpen);
  const isCompact = usePanelsStore((s) => s.isCompact);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);

  // No dependency array on purpose: this re-sweeps after every render of ours,
  // which makes it self-healing if the SDK ever remounts its own subtree. The
  // body is a handful of DOM reads over six elements and exits on the first
  // mismatch, so running it often costs nothing.
  useEffect(() => {
    hideVendorLanguageSwitcher(anchor.current);
  });

  return (
    <>
      <button
        ref={anchor}
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
 * Hides the SDK's own language switcher, which reads "EN" over a Hebrew editor.
 *
 * It is registered at MODULE LOAD (`WA()` runs on import, decorating
 * `OptionalAppBarControls` with priority 10), offers exactly `[{en}, {pl}]`, and
 * labels itself `pc.find(l => l.code === language) || pc[0]`. Ours is `he`, which
 * matches neither, so it announces English — and both of the things it offers to
 * switch to would leave Hebrew permanently, since the detector caches the choice
 * in localStorage.
 *
 * WHY NOT THE REGISTRY. The obvious removal is to re-register its key, since an
 * entry is keyed by `plugin.name ?? content.name` and a match replaces. That was
 * tried and it DOES NOT SURVIVE THE PRODUCTION BUILD. In the SDK's own dist the
 * component is `function jA()`, so the key is `"jA"` — but our bundler inlines it
 * into an anonymous function expression:
 *
 *   H("OptionalAppBarControls", { content: function(){…}, priority:10, place:"before" })
 *
 * `content.name` is then `""`, which `Xd()` treats as absent and falls back to
 * `__auto_<hash of the function's own minified source text>`. That key is
 * unreproducible by us and changes on every build of either package. Verified in
 * `.next/static/chunks` on a deployed build — and note the trap it set: a test
 * asserting the name resolves against `node_modules`, where it is still "jA", so
 * it passed while the shipped app was unaffected.
 *
 * WHAT THIS DOES INSTEAD. It hides the element by what it IS rather than by what
 * it is called: inside the app bar's controls row, an element that is a menu
 * trigger AND whose entire visible text is a two-letter code. That is the shape
 * of `code.toUpperCase()` for any language they ever add, and it is carried by
 * nothing else in the bar — verified against the live DOM, where the predicate
 * matches exactly one element out of six.
 *
 * If the SDK changes shape the predicate simply stops matching and the button
 * comes back — the same cosmetic wrongness as before, not a broken bar — and dev
 * gets a warning. Elements carrying our own class are excluded so this can never
 * hide the controls it ships alongside.
 */
const LANGUAGE_CODE = /^[A-Za-z]{2}$/;

function hideVendorLanguageSwitcher(anchor: HTMLElement | null): void {
  const row = anchor?.parentElement;
  if (!row) return;

  let found = 0;
  for (const element of row.children) {
    if (element.classList.contains('kalfa-workflow-appbar-button')) continue;
    if (!LANGUAGE_CODE.test(element.textContent?.trim() ?? '')) continue;
    if (!element.querySelector('[aria-haspopup="menu"]')) continue;
    found += 1;
    (element as HTMLElement).style.display = 'none';
  }

  if (found === 0 && process.env.NODE_ENV !== 'production') {
    console.warn(
      "[kalfa] Could not find the SDK's language switcher in the app bar. If an " +
        '"EN" button is showing over the Hebrew editor, re-derive the predicate in ' +
        'app-bar.tsx from the live DOM of the controls row.',
    );
  }
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
    // The vendor's items come through `returnValue` and ours are appended, so an
    // SDK upgrade that adds a new one keeps it instead of having it replaced by
    // this list.
    //
    // ⚠️ WITH ONE EXCEPTION, AND IT IS A LEAK RATHER THAN A PREFERENCE. The
    // vendor's Export opens a copyable box containing `getStoreDataForIntegration()`
    // verbatim — which is node `properties` as stored, including the webhook
    // trigger's token, outbound webhook headers, and every connection id. It is
    // dropped here and replaced by the same modal over a scrubbed payload. See
    // export-diagram.tsx for what was read out of the bundle to establish that.
    callback: ({ returnValue }) => ({
      replacedReturn: [
        ...(Array.isArray(returnValue) ? returnValue : []).filter(
          (item) => !isVendorExportItem(item),
        ),
        {
          label: 'ייצוא',
          icon: <Icon name="Export" />,
          onClick: openScrubbedExport,
        },
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
