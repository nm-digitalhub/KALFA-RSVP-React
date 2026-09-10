'use client';

import {
  Icon,
  WorkflowBuilder,
  useSingleSelectedElement,
  useStore,
  type DidSaveStatus,
  type IntegrationDataFormat,
  type OnSaveParams,
  type WorkflowBuilderIsValidConnection,
} from '@workflowbuilder/sdk';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import '@workflowbuilder/sdk/style.css';
// Immediately after, so its unlayered counters land on top of the SDK's reset.
import './sdk-overrides.css';

import { Button } from '@/components/ui/button';
import { isTriggerType } from '@/lib/workflow/catalogue/nodes';
import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { DIAGRAM_TEMPLATES } from '@/lib/workflow/catalogue/templates';
import { applyHebrewToSdk } from '@/lib/workflow/i18n-he';

import { appBarPlugin } from './app-bar';
import { ExecutionHighlighting } from './highlighting';
import { ExecutionLogPanel } from './log-panel';
import { executionMarkersPlugin } from './node-markers';
import { resetExecution } from './use-execution-store';
import { resetPanels, setEditorCompact, setPropertiesOpen, usePanelsStore } from './use-panels-store';

type Props = {
  workflowId: string;
  name: string;
  initialNodes: IntegrationDataFormat['nodes'];
  initialEdges: IntegrationDataFormat['edges'];
  layoutDirection?: IntegrationDataFormat['layoutDirection'];
  initialGlobalVariables?: IntegrationDataFormat['globalVariables'];
  /**
   * A Server Action. It carries `requireAdmin` and the ownership check on its
   * own side — nothing here is authorization, and the browser's copy of the id
   * is not trusted by it.
   *
   * It THROWS on failure rather than returning a falsy value. See the comment on
   * `handleSave`.
   */
  saveAction: (workflowId: string, definition: unknown) => Promise<void>;
};

/**
 * Refuses an edge into the trigger while it is being drawn.
 *
 * This is rule 6 of the conversion contract, enforced a second time at the point
 * of gesture, so the owner never draws an invalid graph and discovers it only on
 * save. It is a courtesy and NOT the enforcement: a graph can also arrive by
 * import or from a hand-edited row, and neither passes through this prop. The
 * adapter stays authoritative.
 *
 * Reads the catalogue, never `data.role` — same rule as everywhere else.
 */
const isValidConnection: WorkflowBuilderIsValidConnection = ({ targetNode }) =>
  !isTriggerType(targetNode.data.type);

const PLUGINS = [executionMarkersPlugin, appBarPlugin];

// Applied at module scope, which runs AFTER the SDK's own import has
// initialised i18next (the import above is evaluated first, in source order).
// `addResourceBundle` on an already-initialised instance needs no particular
// ordering — unlike the "configure i18next before importing the SDK" route
// upstream describes, which would depend on import order and be fragile here.
applyHebrewToSdk();

export function WorkflowEditor({
  workflowId,
  name,
  initialNodes,
  initialEdges,
  layoutDirection,
  initialGlobalVariables,
  saveAction,
}: Props) {
  // Root 2.3.0 omits globalVariables from its props. Its child effects load
  // nodes/edges first; this parent effect restores the remaining persisted field.
  useEffect(() => {
    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
    resetExecution();
    resetPanels();
    return () => {
      resetExecution();
      resetPanels();
    };
  }, [workflowId, initialGlobalVariables]);

  return (
    // THE POSITIONING CONTEXT, and the whole reason this file was rewritten.
    // The SDK's own root is
    //   ._container_ { position: absolute; height: 100%; width: 100% }
    // so it fills its nearest POSITIONED ancestor. Without `relative` here it
    // escapes to the viewport and covers the admin shell. The height must be
    // explicit for the same reason: `height: 100%` against an auto-height
    // parent resolves to nothing.
    <div className="kalfa-workflow-frame relative h-[calc(100dvh-14rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border">
      <WorkflowBuilder.Root
        key={workflowId}
        name={name}
        // Replaces the vendor's "Workflow Builder" wordmark, which is their
        // branding on our admin page. An element is rendered as-is (the prop
        // also takes an image URL or a { light, dark } pair, neither of which
        // we need), and an icon costs a quarter of the wordmark's width — which
        // is what the app bar runs out of first on a phone.
        logo={<Icon name="FlowArrow" size="large" aria-label="עורך התהליכים" />}
        layoutDirection={layoutDirection}
        nodeTypes={PALETTE_ITEMS}
        // Populates the "בחירת תבנית" modal, which offered only "קנבס ריק"
        // because this prop defaults to []. Module-scope array — upstream
        // requires a stable reference, same as nodeTypes.
        diagramTemplates={DIAGRAM_TEMPLATES}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        isValidConnection={isValidConnection}
        // Mounts the per-node execution badges into the OptionalNodeContent slot.
        // Module-scope array: `plugins` is read once on first mount, and a fresh
        // array each render would be a new reference for no reason.
        plugins={PLUGINS}
        // MUST be passed. The default is { strategy: 'localStorage' } — omit it
        // and the workflow is written to the browser instead of to us, silently.
        // 'api' is not an option either: upstream documents that it "issues plain
        // fetch() calls with no auth headers", and this endpoint cannot be
        // unauthenticated. 'props' is the only candidate.
        integration={{
          strategy: 'props',
          onDataSave: makeSaveHandler(workflowId, saveAction),
        }}
      >
        <WorkflowEditorLayout />
      </WorkflowBuilder.Root>
    </div>
  );
}

/**
 * Custom layout for the embedded admin editor.
 *
 * The SDK docs explicitly allow composing TopBar / Canvas / Palette /
 * PropertiesPanel as children of Root, and that is what this is. What it does
 * NOT do any more is replace the app bar.
 *
 * The reason it once did — "TopBar ships English controls" — stopped being true
 * the moment `i18n-he.ts` landed: the bar renders entirely through `t(...)`, and
 * that file now supplies Hebrew for every key it reaches. What the app bar is
 * NOT is an overlay: `._container_` is a plain `display:flex; height:auto;
 * width:100%` div in normal flow (verified in the shipped stylesheet), unlike
 * Palette and PropertiesPanel, which the SDK sizes from its own row and which
 * are the reason DefaultLayout could not simply be dropped into hand-rolled
 * columns. So the bar composes here and the panels still do not.
 *
 * Mounting it back returns the SDK's auto-save and save-on-unload — both live
 * inside its Save button — plus Settings, Import and Export, which existed in
 * `useWorkflowBuilderActions` all along with nothing wired to them.
 */
function WorkflowEditorLayout() {
  const frameRef = useRef<HTMLDivElement>(null);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const isPropertiesOpen = usePanelsStore((s) => s.isPropertiesOpen);
  const isCompact = usePanelsStore((s) => s.isCompact);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);

  // Measure the editor, since the admin sidebar also consumes viewport width.
  //
  // Published to the panels store rather than kept local: the buttons that read
  // it are injected into the app bar at module scope and have no props path
  // back to here. See use-panels-store.ts.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let previous: boolean | undefined;
    const observer = new ResizeObserver(() => {
      const compact = frame.clientWidth <= 900;
      if (compact === previous) return;
      previous = compact;
      setEditorCompact(compact);
      toggleSidebar(!compact);
      setPropertiesOpen(false);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [toggleSidebar]);

  const selectionKey = selected?.node?.id ?? selected?.edge?.id ?? null;

  // An EFFECT, not the render-phase `if (key !== lastKey)` this used to be.
  //
  // That pattern is only sound for a component's own `useState`. `isPropertiesOpen`
  // now lives in a module store, so writing it during render mutates state outside
  // React — which tears under a double-render and is a side effect in the render
  // phase besides. It has to move here.
  useEffect(() => {
    setPropertiesOpen(Boolean(selectionKey));
  }, [selectionKey]);

  useEffect(() => {
    if (isCompact && selectionKey) toggleSidebar(false);
  }, [isCompact, selectionKey, toggleSidebar]);

  const closePanels = useCallback(() => {
    toggleSidebar(false);
    setPropertiesOpen(false);
  }, [toggleSidebar]);

  // Escape is bound to the DOCUMENT, not to the container.
  //
  // React's onKeyDown only fires for events that bubble through the element, and
  // a keydown is dispatched at `document.activeElement`. On a fresh load — or
  // after a tap on empty canvas, which is exactly the phone case these overlays
  // exist for — nothing inside the editor holds focus, so activeElement is
  // <body>, which is not a descendant, and the handler never ran.
  //
  // Bound only while an overlay is actually open, so this never swallows Escape
  // from a dialog or menu elsewhere on the admin page.
  const hasOpenOverlay = isCompact && (isPaletteExpanded || isPropertiesOpen);
  useEffect(() => {
    if (!hasOpenOverlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanels();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasOpenOverlay, closePanels]);

  return (
    <div ref={frameRef} className="workflow-builder-root kalfa-workflow-editor">
      <header className="kalfa-workflow-toolbar">
        <WorkflowBuilder.TopBar />
      </header>
      <div
        className="kalfa-workflow-workspace"
        data-palette-expanded={isPaletteExpanded}
        data-properties-open={isPropertiesOpen && hasSelection}
      >
        <aside id="workflow-palette" className="kalfa-workflow-palette-panel" aria-label="ספריית צעדים">
          <WorkflowBuilder.Palette />
        </aside>
        <div
          className="kalfa-workflow-canvas-layer"
          onPointerDownCapture={() => { if (isCompact) closePanels(); }}
        >
          <WorkflowBuilder.Canvas />
          {/*
            DefaultLayout renders a hidden `#viewport-bounds` spacer between its
            palette and properties panels, and the SDK reads it with a GLOBAL
            `document.querySelector("#viewport-bounds")` to compute fitView
            padding — see `q7()`, whose only caller is the SDK's own useFitView.
            Replacing DefaultLayout removed the element, so that lookup returned
            null and the SDK fell back to a uniform padding, fitting content
            underneath our overlay panels.

            It does NOT affect dragging a node from the palette: drop position
            comes from `reactFlowInstance.screenToFlowPosition(clientX, clientY)`.

            Our toolbar's "הצגת הכול" calls instance.fitView() directly and never
            consults this, but two SDK-internal paths do — loading a diagram
            template, and the keyboard command hook — so the element has to exist.
          */}
          <div id="viewport-bounds" aria-hidden="true" className="kalfa-workflow-viewport-bounds" />
        </div>
        <aside id="workflow-properties" className="kalfa-workflow-properties-panel" aria-label="מאפיינים">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="kalfa-workflow-panel-close"
            aria-label="סגירת מאפיינים"
            onClick={() => setPropertiesOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
          <WorkflowBuilder.PropertiesPanel />
        </aside>
      </div>
      <ExecutionHighlighting />
      <div className="kalfa-workflow-log"><ExecutionLogPanel /></div>
    </div>
  );
}

/**
 * The save contract, and its one trap.
 *
 * `onDataSave` returns `Promise<DidSaveStatus>` where `DidSaveStatus` is
 * `'success' | 'error' | 'alreadyStarted'` — but the runtime treats EVERY
 * non-empty resolution as "the save finished" and shows the success snackbar.
 * Resolving `'error'` therefore tells the owner their workflow was saved when it
 * was not. Upstream is explicit that you must THROW to surface an error.
 *
 * So: this only ever resolves `'success'`, and lets the action's throw through.
 */
function makeSaveHandler(
  workflowId: string,
  saveAction: Props['saveAction'],
): (data: IntegrationDataFormat, params?: OnSaveParams) => Promise<DidSaveStatus> {
  return async (data, params) => {
    // The editor also saves in the background — before the user leaves the page
    // — at a rate we do not control. Both paths persist; `isAutoSave` is carried
    // so the action can tell a deliberate save from a background one and the
    // snackbar stays off for the latter (the runtime already suppresses it).
    void params?.isAutoSave;

    // The WHOLE payload, not a chosen four fields.
    //
    // This used to rebuild `{ name, layoutDirection, nodes, edges }` — the shape
    // the docs site documents for IntegrationDataFormat. The installed
    // `dist/index.d.ts` declares a fifth, `globalVariables: VariablesIndex`,
    // which appears nowhere in their published docs. Cherry-picking therefore
    // silently erased the diagram's global variables on every save, including
    // every background auto-save.
    //
    // Passing `data` straight through also means the next field they add
    // survives instead of being dropped until someone notices. The column stores
    // the editor's format verbatim precisely so this can be a pass-through.
    await saveAction(workflowId, data);

    return 'success';
  };
}
