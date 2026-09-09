'use client';

import {
  WorkflowBuilder,
  useSingleSelectedElement,
  useStore,
  useWorkflowBuilderActions,
  type DidSaveStatus,
  type IntegrationDataFormat,
  type OnSaveParams,
  type WorkflowBuilderIsValidConnection,
} from '@workflowbuilder/sdk';
import { Eye, GitBranch, ListTree, Maximize, Pencil, Save, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import '@workflowbuilder/sdk/style.css';
// Immediately after, so its unlayered counters land on top of the SDK's reset.
import './sdk-overrides.css';

import { Button } from '@/components/ui/button';
import { isTriggerType } from '@/lib/workflow/catalogue/nodes';
import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { DIAGRAM_TEMPLATES } from '@/lib/workflow/catalogue/templates';
import { applyHebrewToSdk } from '@/lib/workflow/i18n-he';

import { ExecutionHighlighting } from './highlighting';
import { ExecutionLogPanel } from './log-panel';
import { executionMarkersPlugin } from './node-markers';
import { resetExecution } from './use-execution-store';

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

const PLUGINS = [executionMarkersPlugin];

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
    return resetExecution;
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
 * The SDK docs explicitly allow composing Canvas / Palette / PropertiesPanel as
 * children of Root. That is the right integration point here: the built-in
 * DefaultLayout brings an English app bar, logo, and permanent side panels that
 * work for the SDK demo page but crowd this RTL admin route on phones.
 */
function WorkflowEditorLayout() {
  const frameRef = useRef<HTMLDivElement>(null);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);
  const [isCompact, setCompact] = useState(false);
  const [isPropertiesOpen, setPropertiesOpen] = useState(false);

  // Measure the editor, since the admin sidebar also consumes viewport width.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let previous: boolean | undefined;
    const observer = new ResizeObserver(() => {
      const compact = frame.clientWidth <= 900;
      if (compact === previous) return;
      previous = compact;
      setCompact(compact);
      toggleSidebar(!compact);
      setPropertiesOpen(false);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [toggleSidebar]);

  const selectionKey = selected?.node?.id ?? selected?.edge?.id ?? null;
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    setPropertiesOpen(hasSelection);
  }

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
      <EditorToolbar
        canOpenProperties={hasSelection}
        paletteOpen={isPaletteExpanded}
        propertiesOpen={isPropertiesOpen && hasSelection}
        onOpenPalette={() => {
          toggleSidebar(!isPaletteExpanded);
          if (isCompact) setPropertiesOpen(false);
        }}
        onOpenProperties={() => {
          setPropertiesOpen(!isPropertiesOpen);
          if (isCompact) toggleSidebar(false);
        }}
      />
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

/**
 * Replaces `<WorkflowBuilder.TopBar />`, which ships English controls.
 *
 * `useWorkflowBuilderActions` MUST be called from a descendant of `<Root>`:
 * outside it, `save()` resolves `'error'` and only logs a warning — the button
 * would look like it worked and save nothing. This component is rendered as a
 * child of Root above, which is what makes it correct.
 */
function EditorToolbar({
  canOpenProperties,
  paletteOpen,
  propertiesOpen,
  onOpenPalette,
  onOpenProperties,
}: {
  canOpenProperties: boolean;
  paletteOpen: boolean;
  propertiesOpen: boolean;
  onOpenPalette: () => void;
  onOpenProperties: () => void;
}) {
  const actions = useWorkflowBuilderActions();
  const instance = useStore((s) => s.reactFlowInstance);
  const documentName = useStore((s) => s.documentName);
  const setDocumentName = useStore((s) => s.setDocumentName);
  const isReadOnly = useStore((s) => s.isReadOnlyMode);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Use canvas-relative bounds. The SDK's useFitView calculates padding from
  // window coordinates, which is incorrect inside an embedded admin editor.
  const fitView = useCallback(() => {
    void instance?.fitView({ padding: 0.2, maxZoom: 1, duration: 200 });
  }, [instance]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(false);
    try {
      setSaveError((await actions.save()) === 'error');
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, [actions]);

  return (
    <header className="kalfa-workflow-toolbar">
      <label className="kalfa-workflow-name">
        <span className="text-xs text-muted-foreground">שם התהליך</span>
        <input
          aria-label="שם התהליך"
          value={documentName ?? ''}
          onChange={(event) => setDocumentName(event.target.value)}
          readOnly={isReadOnly}
          className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
        />
      </label>
      <div className="kalfa-workflow-tools" role="group" aria-label="כלי עריכת תהליך">
        <Button type="button" variant="outline" aria-expanded={paletteOpen} aria-controls="workflow-palette" onClick={onOpenPalette}>
          <ListTree aria-hidden="true" />צעדים
        </Button>
        <Button type="button" variant="outline" aria-expanded={propertiesOpen} aria-controls="workflow-properties" onClick={onOpenProperties} disabled={!canOpenProperties}>
          <Settings2 aria-hidden="true" />מאפיינים
        </Button>
        <Button type="button" onClick={save} disabled={saving || !documentName?.trim()}>
          <Save aria-hidden="true" />{saving ? 'שומר…' : 'שמירה'}
        </Button>
        <Button type="button" variant="outline" onClick={actions.toggleReadOnly} aria-pressed={isReadOnly}>
          {isReadOnly ? <Pencil aria-hidden="true" /> : <Eye aria-hidden="true" />}
          {isReadOnly ? 'חזרה לעריכה' : 'מצב צפייה'}
        </Button>
        <Button type="button" variant="outline" disabled={isReadOnly} onClick={() => {
          actions.toggleLayoutDirection({ flipPositions: true });
          requestAnimationFrame(fitView);
        }}>
          <GitBranch aria-hidden="true" />כיוון הזרימה
        </Button>
        <Button type="button" variant="outline" onClick={fitView}>
          <Maximize aria-hidden="true" />הצגת הכול
        </Button>
      </div>
      {saveError && <p role="alert" className="w-full text-sm text-destructive">השמירה נכשלה. נסו שוב.</p>}
    </header>
  );
}
