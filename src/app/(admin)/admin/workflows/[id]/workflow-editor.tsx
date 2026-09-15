"use client";

import {
  Icon,
  WorkflowBuilder,
  useEffectChange,
  useKeyPress,
  useSingleSelectedElement,
  useStore,
  type DidSaveStatus,
  type IntegrationDataFormat,
  type OnSaveParams,
  type WorkflowBuilderIsValidConnection,
} from "@workflowbuilder/sdk";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import "@workflowbuilder/sdk/style.css";
// Immediately after, so its unlayered counters land on top of the SDK's reset.
import "./sdk-overrides.css";

import { Button } from "@/components/ui/button";
import { isTriggerType } from "@/lib/workflow/catalogue/nodes";
import {
  buildPaletteItems,
  type VoiceDialOption,
  type VoicePurposeOption,
  type WhatsAppNumberOption,
} from "@/lib/workflow/catalogue/schemas";
import { DIAGRAM_TEMPLATES } from "@/lib/workflow/catalogue/templates";
import { applyHebrewToSdk } from "@/lib/workflow/i18n-he";

import { loadVoiceDialListsAction } from "../actions";

import { appBarPlugin } from "./app-bar";
import {
  stripComputedErrors,
  syncArmBlockerMarkers,
} from "./arm-blocker-markers";
import { normalizeLegacyProperties } from "./normalize-legacy-properties";
import { checkboxListRenderer } from "./checkbox-list-control";
import { headerRowsRenderer } from "./header-rows-control";
import { ExecutionHighlighting } from "./highlighting";
import { ExecutionLogPanel } from "./log-panel";
import { executionMarkersPlugin } from "./node-markers";
import { resetExecution } from "./use-execution-store";
import {
  resetPanels,
  setEditorCompact,
  setPropertiesOpen,
  usePanelsStore,
} from "./use-panels-store";
import { setSecretNames } from "./use-secrets-store";

type Props = {
  workflowId: string;
  name: string;
  initialNodes: IntegrationDataFormat["nodes"];
  initialEdges: IntegrationDataFormat["edges"];
  layoutDirection?: IntegrationDataFormat["layoutDirection"];
  initialGlobalVariables?: IntegrationDataFormat["globalVariables"];
  /**
   * A Server Action. It carries `requireAdmin` and the ownership check on its
   * own side — nothing here is authorization, and the browser's copy of the id
   * is not trusted by it.
   *
   * It THROWS on failure rather than returning a falsy value. See the comment on
   * `handleSave`.
   */
  saveAction: (workflowId: string, definition: unknown) => Promise<void>;
  /**
   * Our WhatsApp lines, for the trigger node's "which number" dropdown.
   *
   * Resolved on the server (page.tsx) and passed down, because the palette is
   * built here in the browser and the numbers are database rows. An empty list
   * is a legitimate state — nothing synced yet — and the dropdown then offers
   * only "כל המספרים", which is the same behaviour the node had before the
   * field existed.
   */
  whatsappNumbers: readonly WhatsAppNumberOption[];
  /**
   * The configured voice agents, for `action.start_voice_call`.
   *
   * Same reasoning as `whatsappNumbers`: the palette is built in the browser and
   * these are database rows. An empty list means the node offers nothing to
   * pick, which is the honest state before any purpose is set up.
   */
  voicePurposes: readonly VoicePurposeOption[];
  /**
   * The numbers a voice call may go out FROM.
   *
   * Rows, like the two lists above, so this one costs no vendor round trip. The
   * other two dial lists (rules, agents) are NOT props: they are live vendor
   * reads, fetched here on demand the first time a call node is selected.
   */
  voiceCallerIds: readonly VoiceDialOption[];
  /**
   * The secret NAMES the HTTP node's header rows may reference.
   *
   * Names, never values — see secrets.ts and use-secrets-store.ts. Resolved on
   * the server because the environment is not readable here.
   */
  secretNames: readonly string[];
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

// Custom JsonForms renderers. Module scope for the same reason as PLUGINS: the
// prop is read once, and a fresh object each render would re-register the
// registry on every keystroke in the properties panel.
//
// One entry so far — the HTTP node's header list, which has no built-in
// equivalent in the SDK's closed control union. See header-rows-control.tsx.
const JSON_FORM = { renderers: [headerRowsRenderer, checkboxListRenderer] };

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
  whatsappNumbers,
  voicePurposes,
  voiceCallerIds,
  secretNames,
  saveAction,
}: Props) {
  // ── the two live dial lists ────────────────────────────────────────────────
  //
  // ⚠️ FETCHED WHEN A CALL NODE IS FIRST SELECTED, never on mount. Opening a
  // workflow must not depend on Voximplant and ElevenLabs both being reachable,
  // and most workflows have no call node at all. Until the fetch lands the two
  // dropdowns offer only their blank default, which means "the rule configured
  // for the purpose" / "the agent configured in the scenario" — the behaviour
  // that shipped before these fields existed. A vendor outage therefore costs
  // the pickers, never the editor.
  //
  // ONCE PER EDITOR. `requested` is a ref, not state: it must not re-render, and
  // it must survive the selection changing away and back. The retry below is the
  // only thing that clears it.
  const [dialLists, setDialLists] = useState<{
    rules: readonly VoiceDialOption[];
    agents: readonly VoiceDialOption[];
    errors: readonly string[];
  }>({ rules: [], agents: [], errors: [] });
  const [isLoadingDialLists, startDialListLoad] = useTransition();
  const dialListsRequested = useRef(false);

  // The selection is watched INSIDE `<Root>` — see this callback's use in
  // `WorkflowEditorLayout`.
  //
  // Not a correctness requirement, and worth recording as such rather than
  // leaving a scarier comment standing: the 2.3.0 store is a module-level
  // zustand singleton (`create()(devtools(…))` in the shipped bundle, matching
  // the typings' own "module-level global singleton" note), so the hook would
  // work from here too. The docs' architecture page describes a
  // `StoreContext.Provider` in the SDK's source tree, which is the arrangement
  // that WOULD make placement matter; the published artifact does not use it.
  // Watching from inside Root costs nothing and matches the two calls this file
  // already makes, so it stays there and does not depend on which of those two
  // shapes a future version ships.
  const loadDialLists = useCallback(() => {
    dialListsRequested.current = true;
    // `startTransition` because this dispatches a Server Function; see the same
    // note on the Voximplant rule field under /admin/integrations.
    startDialListLoad(async () => {
      const res = await loadVoiceDialListsAction();
      setDialLists({
        rules: res.rules.ok ? res.rules.items : [],
        agents: res.agents.ok ? res.agents.items : [],
        // Each vendor reports separately: a Voximplant outage must not hide the
        // agents, and a missing ElevenLabs key must not hide the rules.
        errors: [
          ...(res.rules.ok ? [] : [`כללי הניתוב: ${res.rules.message}`]),
          ...(res.agents.ok ? [] : [`סוכני ElevenLabs: ${res.agents.message}`]),
        ],
      });
    });
  }, []);

  // Fires once, the first time a call node is selected. The ref is what makes it
  // once: it must not re-render, and it must survive the selection moving away
  // and back. The retry button is the only thing that asks again.
  const loadDialListsOnce = useCallback(() => {
    if (dialListsRequested.current) return;
    loadDialLists();
  }, [loadDialLists]);
  // MEMOISED, and that is a requirement rather than an optimisation: upstream
  // states `nodeTypes` "must be a stable reference — declare at module scope or
  // memoize". Every other palette entry is module-scope data; this one entry's
  // dropdown is a live list, which is why the whole array has to be built here
  // instead. A fresh array each render would re-register the palette on every
  // keystroke in the properties panel.
  const paletteItems = useMemo(
    () =>
      buildPaletteItems(
        whatsappNumbers,
        voicePurposes,
        voiceCallerIds,
        dialLists.rules,
        dialLists.agents,
      ),
    [
      whatsappNumbers,
      voicePurposes,
      voiceCallerIds,
      dialLists.rules,
      dialLists.agents,
    ],
  );
  // ⚠️ REPAIR LEGACY ARRAY SHAPES BEFORE THE SCHEMA SEES THEM.
  //
  // An ARMED workflow is stored with `messageKinds: ['text', 'button']` — bare
  // strings, from before the control persisted objects — and the schema declares
  // `items: { type: 'object' }`. So the editor marked a workflow INVALID that
  // runs exactly as intended, because `matchesKind` accepts both shapes and the
  // schema does not. `ArrayFieldSchema` cannot express "object or string", so
  // the shapes have to converge on the one the control writes.
  //
  // Done here rather than as a migration: nothing is written on the owner's
  // behalf to a workflow that is armed and firing. The false marker is gone when
  // they open the diagram, and the row converges the next time they save.
  //
  // `initialNodes` is only read by `<Root>` on first mount, so memoising on the
  // palette is enough — and the palette's live lists never change which fields
  // are arrays.
  const normalizedInitialNodes = useMemo(
    () => normalizeLegacyProperties(initialNodes, paletteItems),
    [initialNodes, paletteItems],
  );

  // ⚠️ RE-SNAPSHOT THE PALETTE, or the live lists never reach the form.
  //
  // MEASURED IN THE 2.3.0 BUNDLE, not assumed — and the assumption it replaces
  // was wrong. Passing a new `nodeTypes` array is NOT enough on its own:
  //
  //   • `<Root>` calls `kM(nodeTypes)` on every render, which writes a
  //     MODULE-LEVEL variable (`x1`). That part does update.
  //   • But the properties panel does not read that variable. It reads
  //     `getNodeDefinition(type)` off the Zustand store, and that reads
  //     `store.data` — a SNAPSHOT copied from the module variable by
  //     `fetchData()`.
  //   • `fetchData()` is called in exactly one place: the Palette sidebar's own
  //     `useEffect(() => { fetchData() }, [fetchData])`. `fetchData` is a stable
  //     store reference, so that effect runs ONCE, on mount.
  //
  // So without this, the agent and rule dropdowns would stay empty forever: the
  // definition the panel renders was frozen before the vendors answered.
  //
  // ⚠️ AND THE ORDER IS THE REASON THIS IS AN EFFECT. React renders the child
  // before running the parent's effects, so by the time this runs, `<Root>`'s
  // render has already written the new palette into the module variable and
  // `fetchData()` copies the CURRENT one. Calling it during render would copy
  // the previous.
  //
  // Harmless on mount, where it re-takes a snapshot the Palette just took.
  useEffect(() => {
    useStore.getState().fetchData();
  }, [paletteItems]);

  // Root 2.3.0 does not expose globalVariables as an initial-data prop.
  // Its internal integration layer supports them, but Root does not forward
  // them. Keep this synchronization independent from the workflow-session
  // lifecycle: an RSC refresh may reconstruct this object without changing
  // which workflow the owner is editing.
  useEffect(() => {
    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
  }, [initialGlobalVariables]);

  // Execution and panel state belong to the workflow visit. Revalidation of
  // this same workflow must not reset them merely because server props were
  // reconstructed.
  useEffect(() => {
    resetExecution();
    resetPanels();

    return () => {
      resetExecution();
      resetPanels();
    };
  }, [workflowId]);

  // Published to a module store rather than passed down: the header control is
  // registered at module scope and mounted by the SDK's own tree, so there is no
  // props path to it. Same mechanism, same reason, as use-panels-store.
  //
  // `.join()` as the dependency, not the array: `secretNames` is a fresh array
  // on every server render, and depending on its identity would re-set the store
  // on every re-render for no change.
  const secretNamesKey = secretNames.join(",");
  useEffect(() => {
    setSecretNames(secretNamesKey === "" ? [] : secretNamesKey.split(","));
  }, [secretNamesKey]);

  return (
    <>
      {dialLists.errors.length > 0 && (
        // ⚠️ THE FAILURE IS SAID OUT LOUD, not folded into the dropdown.
        //
        // The tempting alternative — an option reading "טעינה נכשלה" — would put
        // a non-value in a list of values and be selectable. An owner who picked
        // it would be choosing the blank default while believing they had chosen
        // something. So the list stays honest (it holds only real rules and real
        // agents) and the reason it is short is stated here, next to a retry.
        //
        // ⚠️ ABOVE THE FRAME AND IN NORMAL FLOW, not floating inside it. It sat
        // `absolute top-2` within the editor frame for one revision, which put it
        // straight over the SDK's app bar — an alert covering the Save button is
        // a worse bug than the one it reports.
        //
        // `role="alert"` and not a toast: this is a persistent condition, not an
        // event, and it stays until the retry succeeds.
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <span>{dialLists.errors.join(" · ")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isLoadingDialLists}
            onClick={loadDialLists}
          >
            {isLoadingDialLists ? "טוען…" : "נסו שוב"}
          </Button>
        </div>
      )}
      {/*
        THE POSITIONING CONTEXT, and the whole reason this file was rewritten.
        The SDK's own root is
          ._container_ { position: absolute; height: 100%; width: 100% }
        so it fills its nearest POSITIONED ancestor. Without `relative` here it
        escapes to the viewport and covers the admin shell. The height must be
        explicit for the same reason: `height: 100%` against an auto-height
        parent resolves to nothing.
      */}
      <div className="kalfa-workflow-frame relative h-[calc(100dvh-14rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border">
        <WorkflowBuilder.Root
          key={workflowId}
          name={name}
          // Replaces the vendor's "Workflow Builder" wordmark, which is their
          // branding on our admin page. An element is rendered as-is (the prop
          // also takes an image URL or a { light, dark } pair, neither of which
          // we need), and an icon costs a quarter of the wordmark's width — which
          // is what the app bar runs out of first on a phone.
          logo={
            <Icon name="FlowArrow" size="large" aria-label="עורך התהליכים" />
          }
          layoutDirection={layoutDirection}
          nodeTypes={paletteItems}
          // Populates the "בחירת תבנית" modal, which offered only "קנבס ריק"
          // because this prop defaults to []. Module-scope array — upstream
          // requires a stable reference, same as nodeTypes.
          diagramTemplates={DIAGRAM_TEMPLATES}
          initialNodes={normalizedInitialNodes}
          initialEdges={initialEdges}
          isValidConnection={isValidConnection}
          // Mounts the per-node execution badges into the OptionalNodeContent slot.
          // Module-scope array: `plugins` is read once on first mount, and a fresh
          // array each render would be a new reference for no reason.
          plugins={PLUGINS}
          jsonForm={JSON_FORM}
          // MUST be passed. The default is { strategy: 'localStorage' } — omit it
          // and the workflow is written to the browser instead of to us, silently.
          // 'api' is not an option either: upstream documents that it "issues plain
          // fetch() calls with no auth headers", and this endpoint cannot be
          // unauthenticated. 'props' is the only candidate.
          integration={{
            strategy: "props",
            onDataSave: makeSaveHandler(workflowId, saveAction),
          }}
        >
          <WorkflowEditorLayout
            onVoiceCallNodeSelected={loadDialListsOnce}
            name={name}
            workflowId={workflowId}
          />
        </WorkflowBuilder.Root>
      </div>
    </>
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
function WorkflowEditorLayout({
  /**
   * Called the first time a voice-call node is selected, so the editor can fetch
   * the two live dial lists then and not a moment earlier. Passed down rather
   * than watched by the parent because this component is inside `<Root>`, which
   * is where every other `useSingleSelectedElement` call on this page lives.
   */
  onVoiceCallNodeSelected,
  name,
  workflowId,
}: {
  onVoiceCallNodeSelected: () => void;
  /** Both only so the arm-blocker sync can rebuild the diagram it parses. */
  name: string;
  workflowId: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const isPaletteExpanded = useStore((s) => s.isSidebarExpanded);
  const isPropertiesOpen = usePanelsStore((s) => s.isPropertiesOpen);
  const isCompact = usePanelsStore((s) => s.isCompact);
  const selected = useSingleSelectedElement();
  const hasSelection = Boolean(selected?.node || selected?.edge);

  const selectedNodeType = selected?.node?.data.type;
  useEffect(() => {
    if (selectedNodeType === "action.start_voice_call")
      onVoiceCallNodeSelected();
  }, [selectedNodeType, onVoiceCallNodeSelected]);

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

  // ⚠️ THE ARM GATE'S OWN REFUSALS, MOVED ONTO THE NODES THEY BELONG TO.
  //
  // `findArmBlockersByNode` reports everything arming refuses. Of those,
  // `syncArmBlockerMarkers` surfaces ONLY `source: 'arm-only'` — the five no
  // JSON Schema can make: a step left in draft, a guest step under a guestless
  // trigger, a keyword no message kind can satisfy, a fan-out pointing at its
  // own workflow, a callback routed to the sales agent. One of them is truly
  // cross-node (the guest rule reads the trigger at the other end); the rest are
  // same-node facts the schema still cannot express.
  //
  // It does NOT mirror the schema's own refusals. `Ga()` counts customErrors
  // toward validity alongside schema errors, so doing that would put two errors
  // on one node for one mistake — see arm-blocker-markers.ts for the filter and
  // the measurement behind it.
  //
  // ⚠️ SUBSCRIBED TO NODES AND EDGES, AND THAT IS ONLY SAFE BECAUSE THE SYNC IS
  // IDEMPOTENT. `setStoreNodes` re-validates and emits another node change, so a
  // write on every pass would loop forever; `syncArmBlockerMarkers` compares the
  // computed messages against the ones already on each node and returns without
  // writing when they match. Edges are in the dependency list because the guest
  // rule reads the TRIGGER at the other end of the graph — reconnecting an edge
  // changes the answer without touching any node's properties.
  useEffect(() => {
    syncArmBlockerMarkers(name, edges, workflowId);
  }, [name, nodes, edges, workflowId]);

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

  // Escape closes the phone overlays, through the SDK's own key hook.
  //
  // ⚠️ THIS WAS A HAND-ROLLED `document.addEventListener('keydown')`, and the
  // comment justifying it described a problem `useKeyPress` already solves. The
  // reasoning was: React's `onKeyDown` only sees events that bubble through the
  // element, a keydown is dispatched at `document.activeElement`, and on a fresh
  // load — or after a tap on empty canvas, the phone case these overlays exist
  // for — nothing inside the editor holds focus, so activeElement is <body> and
  // the handler never ran. All true. But the SDK's hook fires "when the diagram
  // canvas (BODY / .react-flow__*) has focus" by default, which is exactly that
  // case.
  //
  // And it fixes something the hand-rolled version got wrong: it EXCLUDES text
  // inputs, "so typing in a property field doesn't accidentally trigger keyboard
  // shortcuts". Ours listened on the document unconditionally, so Escape while
  // editing a node's title closed the panel out from under the owner.
  //
  // `useEffectChange` is the matching half: `useKeyPress` reports a HELD state,
  // and this fires only on a change after mount, so the press acts once instead
  // of on every render that observes it still down.
  const hasOpenOverlay = isCompact && (isPaletteExpanded || isPropertiesOpen);
  const escapeHeld = useKeyPress("Escape");
  useEffectChange(() => {
    if (escapeHeld && hasOpenOverlay) closePanels();
  }, [escapeHeld, hasOpenOverlay, closePanels]);

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
        <aside
          id="workflow-palette"
          className="kalfa-workflow-palette-panel"
          aria-label="ספריית צעדים"
        >
          <WorkflowBuilder.Palette />
        </aside>
        <div
          className="kalfa-workflow-canvas-layer"
          onPointerDownCapture={() => {
            if (isCompact) closePanels();
          }}
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
          <div
            id="viewport-bounds"
            aria-hidden="true"
            className="kalfa-workflow-viewport-bounds"
          />
        </div>
        <aside
          id="workflow-properties"
          className="kalfa-workflow-properties-panel"
          aria-label="מאפיינים"
        >
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
      <div className="kalfa-workflow-log">
        <ExecutionLogPanel />
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
  saveAction: Props["saveAction"],
): (
  data: IntegrationDataFormat,
  params?: OnSaveParams,
) => Promise<DidSaveStatus> {
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
    // ⚠️ MINUS THE EDITOR'S OWN VALIDATION STATE. `properties.errors` is written
    // by the SDK on every change and `properties.customErrors` by our arm-blocker
    // sync; neither is diagram CONTENT, and eight of the twenty-two nodes stored
    // today already carry a stale `errors` array because nothing ever stripped
    // them. Schema errors are self-healing — the SDK recomputes them on load —
    // but a persisted `customErrors` would show an owner a refusal that was
    // fixed in another session.
    //
    // Two keys removed by name, everything else copied: this is not the
    // cherry-picking the comment above warns about.
    await saveAction(workflowId, stripComputedErrors(data));

    return "success";
  };
}
