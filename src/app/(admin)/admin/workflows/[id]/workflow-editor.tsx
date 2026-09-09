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
import { Eye, GitBranch, ListTree, Save, Settings2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import '@workflowbuilder/sdk/style.css';
// Immediately after, so its unlayered counters land on top of the SDK's reset.
import './sdk-overrides.css';

import { Button } from '@/components/ui/button';
import { isTriggerType } from '@/lib/workflow/catalogue/nodes';
import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { applyHebrewToSdk } from '@/lib/workflow/i18n-he';

import { ExecutionHighlighting } from './highlighting';
import { ExecutionLogPanel } from './log-panel';
import { executionMarkersPlugin } from './node-markers';

type Props = {
  workflowId: string;
  name: string;
  initialNodes: IntegrationDataFormat['nodes'];
  initialEdges: IntegrationDataFormat['edges'];
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
  saveAction,
}: Props) {
  return (
    // THE POSITIONING CONTEXT, and the whole reason this file was rewritten.
    // The SDK's own root is
    //   ._container_ { position: absolute; height: 100%; width: 100% }
    // so it fills its nearest POSITIONED ancestor. Without `relative` here it
    // escapes to the viewport and covers the admin shell. The height must be
    // explicit for the same reason: `height: 100%` against an auto-height
    // parent resolves to nothing.
    <div className="relative h-[calc(100vh-14rem)] min-h-[30rem] overflow-hidden rounded-lg border border-border">
      <WorkflowBuilder.Root
        name={name}
        nodeTypes={PALETTE_ITEMS}
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
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);
  const [isPropertiesOpen, setPropertiesOpen] = useState(false);

  useEffect(() => {
    if (globalThis.matchMedia?.('(max-width: 800px)').matches) {
      toggleSidebar(false);
    }
  }, [toggleSidebar]);

  // Adjust the panel when the SELECTION changes, done during render rather than
  // in an effect. React's own guidance for "reset state when a prop changes" is
  // this compare-with-previous pattern, and `react-hooks/set-state-in-effect`
  // flags the effect form — rightly: an effect would paint the stale panel
  // first, then correct it.
  //
  // `matchMedia` is absent on the server, so the optional call yields undefined
  // and the panel renders closed there. The first client render has no selection
  // either, so both agree and hydration is clean.
  const selectionKey = selected?.node?.id ?? selected?.edge?.id ?? null;
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    setPropertiesOpen(
      hasSelection && Boolean(globalThis.matchMedia?.('(max-width: 800px)').matches),
    );
  }

  return (
    <div className="workflow-builder-root kalfa-workflow-editor">
      <div className="kalfa-workflow-canvas-layer">
        <WorkflowBuilder.Canvas />
      </div>

      <div id="viewport-bounds" className="kalfa-workflow-viewport-bounds" />

      <div
        className="kalfa-workflow-panel-layer"
        data-palette-expanded={isPaletteExpanded ? 'true' : 'false'}
        data-has-selection={hasSelection ? 'true' : 'false'}
        data-properties-open={isPropertiesOpen ? 'true' : 'false'}
      >
        <aside className="kalfa-workflow-palette-panel" aria-label="ספריית צעדים">
          <WorkflowBuilder.Palette />
        </aside>

        <aside className="kalfa-workflow-properties-panel" aria-label="מאפיינים">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="kalfa-workflow-mobile-panel-close"
            aria-label="סגירת מאפיינים"
            onClick={() => setPropertiesOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
          <WorkflowBuilder.PropertiesPanel />
        </aside>
      </div>

      {/* Reads the execution store and renders nothing until a run has
          produced something — a test run or a real one, indistinguishable to it
          by design. Inside <Root> because it reads the canvas's edges. */}
      <ExecutionHighlighting />

      {/* One bottom stack, so the log and toolbar never overlap on mobile. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3">
        <div className="pointer-events-auto w-full max-w-xl bg-card">
          <ExecutionLogPanel />
        </div>
        <EditorToolbar
          canOpenProperties={hasSelection}
          onOpenPalette={() => toggleSidebar(true)}
          onOpenProperties={() => setPropertiesOpen(true)}
        />
      </div>
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
  onOpenPalette,
  onOpenProperties,
}: {
  canOpenProperties: boolean;
  onOpenPalette: () => void;
  onOpenProperties: () => void;
}) {
  const actions = useWorkflowBuilderActions();
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await actions.save();
    } finally {
      setSaving(false);
    }
  }, [actions]);

  return (
    // A plain flex child of the bottom stack above — no positioning of its own,
    // which is what stopped it colliding with the log panel.
    //
    // `flex-wrap` because three Hebrew labels do not fit one line on a narrow
    // phone; they wrap to a second row instead of overflowing the viewport.
    <header className="pointer-events-none flex w-full justify-center">
      <span className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-card p-2 shadow-lg">
        <Button
          type="button"
          variant="outline"
          className="kalfa-workflow-mobile-tool"
          onClick={onOpenPalette}
        >
          <ListTree aria-hidden="true" />
          צעדים
        </Button>
        <Button
          type="button"
          variant="outline"
          className="kalfa-workflow-mobile-tool"
          onClick={onOpenProperties}
          disabled={!canOpenProperties}
        >
          <Settings2 aria-hidden="true" />
          מאפיינים
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          <Save aria-hidden="true" />
          {saving ? 'שומר…' : 'שמירה'}
        </Button>
        <Button type="button" variant="outline" onClick={actions.toggleReadOnly}>
          <Eye aria-hidden="true" />
          מצב צפייה
        </Button>
        <Button
          type="button"
          variant="outline"
          // flipPositions is a naive x/y axis swap that ignores node sizes, which
          // is exactly why the SDK exposes it only on the toggle and why it is
          // paired with fitView here.
          onClick={() => actions.toggleLayoutDirection({ flipPositions: true, fitView: true })}
        >
          <GitBranch aria-hidden="true" />
          כיוון הזרימה
        </Button>
      </span>
    </header>
  );
}
