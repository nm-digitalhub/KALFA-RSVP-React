# §6 — Workflow Builder SDK 2.3.0 / Global Variables Audit

Generated: 2026-09-15T22:05:36+03:00
Project: /var/www/vhosts/kalfa.me/beta
Git branch: feat/admin-integrations-consolidation
Git HEAD: c0de7c82f29dc5873cfc932a698ae1fcd8e3ef41
SDK package: @workflowbuilder/sdk@2.3.0
SDK runtime: node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js

## 1. Public integration contract
```text
576- * ```
577- *
578- * @see https://jsonforms.io/docs/uischema/controls/#scope-string
579- *
580- * @category Forms
581- */
582-export declare function getScope<T extends object>(path: PropertyPath<T> | ''): string;
583-
584-/**
585- * Snapshot the diagram in the shape expected by the integration layer
586- * (`{ name, nodes, edges, layoutDirection }`). Use this to hand a
587- * persistable payload to the host — e.g. inside a `props`-strategy
588: * `onDataSave` callback or before posting to a custom backend.
589- *
590- * Dynamic, runtime-only values (selection, computed avoid-edge points,
591- * …) are stripped by default; pass `shouldSkipDynamicValues: false` if
592- * you specifically need the live values.
593- *
594- * @category Store
595- */
596-export declare function getStoreDataForIntegration(params?: GetStoreDataParams): IntegrationDataFormat;
597-
598-declare type GetStoreDataParams = {
599-    shouldSkipDynamicValues?: boolean;
600-};
--
732- *
733- * @category Integration
734- */
735-export declare type IntegrationDataFormatOptional = Partial<IntegrationDataFormat>;
736-
737-/**
738- * Persistence strategy identifier — one of:
739- *
740- * - `'localStorage'`: editor reads / writes the diagram under a fixed
741- *   `'workflowBuilderDiagram'` key in browser `localStorage` (not
742- *   derived from the instance `name` prop). Default.
743- * - `'api'`: editor performs HTTP load + save against the configured
744: *   `endpoints.load` / `endpoints.save` URLs.
745: * - `'props'`: editor calls the host-supplied `onDataSave` callback;
746- *   initial state comes from `initialNodes` / `initialEdges` props.
747- *
748- * @category Integration
749- */
750-export declare type IntegrationStrategy = 'localStorage' | 'api' | 'props';
751-
752-/**
753- * Tester matching any control element.
754- * @category Forms
755- */
756-export declare const isControl: (uischema: any) => uischema is JsonFormsCore.ControlElement;
757-
--
2127- *
2128- * @category Components
2129- */
2130-export declare type WorkflowBuilderEdgeTemplates = Record<string, ComponentType<EdgeProps<WorkflowBuilderEdge>>>;
2131-
2132-/**
2133- * Persistence strategy for a `<WorkflowBuilder.Root>` instance. Exactly one
2134- * variant applies. `integration` is itself optional — omitting it picks the
2135- * `localStorage` default.
2136- *
2137- * @category Integration
2138- */
2139:export declare type WorkflowBuilderIntegration = 
2140-/** Default — save to browser localStorage under `'workflowBuilderDiagram'`. Selected when `integration` is omitted entirely or set to `{}`. */
2141-    {
2142-    strategy?: 'localStorage';
2143-}
2144:/** REST persistence — SDK issues `GET endpoints.load` and `POST endpoints.save` on every save event. */
2145-| {
2146-    strategy: 'api';
2147:    endpoints: {
2148-        load: string;
2149-        save: string;
2150-    };
2151-}
2152:/** Host-managed — SDK invokes `onDataSave` with the diagram payload on every save event; the host owns where it lands. */
2153-| {
2154:    strategy: 'props';
2155:    onDataSave: OnSaveExternal;
2156-};
2157-
2158-/**
2159- * Decides whether a dragged connection is allowed. Return `false` to block the
2160- * drop (no edge created, no flicker). Fail-open: if an endpoint can't be
2161- * resolved to a node, the connection is allowed and this is not invoked.
2162- *
2163- * @category Core
2164- */
2165-export declare type WorkflowBuilderIsValidConnection = (params: WorkflowBuilderIsValidConnectionParams) => boolean;
2166-
2167-/**
--
2357-     */
2358-    edgeTemplates?: WorkflowBuilderEdgeTemplates;
2359-    /**
2360-     * Diagram templates available in the template selector.
2361-     * **Must be a stable reference** (same rationale as `nodeTypes`).
2362-     */
2363-    diagramTemplates?: TemplateModel[];
2364-    /** Plugin initializers invoked synchronously, in order, on first mount. */
2365-    plugins?: WorkflowBuilderPlugin[];
2366-    /** Custom JsonForms renderers / cells / translations. */
2367-    jsonForm?: WorkflowBuilderJsonFormConfig;
2368-    /** Persistence strategy. Defaults to `{ strategy: 'localStorage' }`. */
2369:    integration?: WorkflowBuilderIntegration;
2370-    /** Workflow name displayed in the app bar and persisted with the diagram. */
2371-    name?: string;
2372-    /**
2373-     * Replaces the built-in Workflow Builder logo in the app bar: an image URL,
2374-     * `{ light, dark }` per-theme image URLs, or a custom element rendered as-is.
2375-     */
2376-    logo?: WorkflowBuilderLogo;
2377-    /** Wraps the app-bar logo (built-in or custom) in a link opened in a new tab. */
2378-    logoHref?: string;
2379-    /** Initial layout direction (`'RIGHT'` or `'DOWN'`). */
2380-    layoutDirection?: LayoutDirection;
2381-    /** Initial nodes rendered on first mount. */
```

## 2. WorkflowBuilderRoot public API
```text
export declare function WorkflowBuilderRoot({ nodeTypes, nodeTemplates, edgeTemplates, diagramTemplates, plugins, jsonForm, integration, name, logo, logoHref, layoutDirection, initialNodes, initialEdges, isValidConnection, reactFlowProps, children, }: WorkflowBuilderRootProps): JSX.Element;

/**
 * Props accepted by `<WorkflowBuilder.Root>`.
 *
 * @category Core
 */
export declare type WorkflowBuilderRootProps = PropsWithChildren<{
    /**
     * Node type definitions rendered in the palette and used for validation.
     * **Must be a stable reference** — declare at module level or memoize.
     * Passing an inline literal (`nodeTypes={[...]}`) overwrites the SDK's
     * module-level palette holder on every parent re-render.
     */
    nodeTypes?: PaletteItemOrGroup[];
    /**
     * Per-node-type custom renderers — map of `data.type` → React component.
     * Overrides the default `WorkflowNodeTemplate` for the matching node type.
     * Use {@link defineNodeTemplate} for the typing helper.
     *
     * **Must be a stable reference** (same rationale as `nodeTypes`).
     */
    nodeTemplates?: WorkflowBuilderNodeTemplates;
    /**
     * Per-edge-type custom renderers. Map of `edge.type` to a React component.
     * Overrides the built-in `'labelEdge'` for the matching edge type; edges
     * whose type isn't registered fall back to the default edge.
     *
     * Each component is authored exactly like a ReactFlow custom edge (it takes
     * `EdgeProps` directly). The only SDK-specific step is registering it here
     * instead of via ReactFlow's `edgeTypes`. See ReactFlow's "Custom Edges"
     * guide: https://reactflow.dev/learn/customization/custom-edges. To match the
     * built-in selection and hover look, reuse the exported `useLabelEdgeHover`
     * and `EnhancedBaseEdge`, or restyle selection globally via the
     * `--ax-public-edge-color-select` CSS variable. A custom edge does not inherit
     * the built-in self-connecting loop or label rendering.
     *
     * **Must be a stable reference** (same rationale as `nodeTemplates`).
     */
    edgeTemplates?: WorkflowBuilderEdgeTemplates;
    /**
     * Diagram templates available in the template selector.
     * **Must be a stable reference** (same rationale as `nodeTypes`).
     */
    diagramTemplates?: TemplateModel[];
    /** Plugin initializers invoked synchronously, in order, on first mount. */
    plugins?: WorkflowBuilderPlugin[];
    /** Custom JsonForms renderers / cells / translations. */
    jsonForm?: WorkflowBuilderJsonFormConfig;
    /** Persistence strategy. Defaults to `{ strategy: 'localStorage' }`. */
    integration?: WorkflowBuilderIntegration;
    /** Workflow name displayed in the app bar and persisted with the diagram. */
    name?: string;
    /**
     * Replaces the built-in Workflow Builder logo in the app bar: an image URL,
     * `{ light, dark }` per-theme image URLs, or a custom element rendered as-is.
     */
    logo?: WorkflowBuilderLogo;
    /** Wraps the app-bar logo (built-in or custom) in a link opened in a new tab. */
    logoHref?: string;
    /** Initial layout direction (`'RIGHT'` or `'DOWN'`). */
    layoutDirection?: LayoutDirection;
    /** Initial nodes rendered on first mount. */
    initialNodes?: WorkflowBuilderNode[];
    /** Initial edges rendered on first mount. */
    initialEdges?: WorkflowBuilderEdge[];
    /**
     * Validate connections as the user draws them. Return `false` to reject the
     * drop. **Must be a stable reference.**
     *
     * @example
     * ```ts
     * const isValidConnection: WorkflowBuilderIsValidConnection = ({ sourceNode, targetNode }) =>
     *   !(sourceNode.data.type === 'start' && targetNode.data.type === 'start');
     * ```
     */
    isValidConnection?: WorkflowBuilderIsValidConnection;
    /**
     * Advanced escape hatch: forwards extra props to the ReactFlow canvas (see
     * {@link WorkflowBuilderReactFlowProps}). Treat as static config; runtime value
     * changes may not apply immediately.
     */
    reactFlowProps?: WorkflowBuilderReactFlowProps;
}>;

/**
 * Top bar with toolbar, project selector, and integration controls. Mount
 * via `<WorkflowBuilder.TopBar />` (or the named `<WorkflowBuilderTopBar />`
 * export) inside a custom layout; the default layout already includes it.
 *
 * @category Components
 */
export declare function WorkflowBuilderTopBar(): JSX.Element;

declare type WorkflowEditorState = DiagramState & PaletteState & DiagramSelectionState & DiagramDataModificationState & UserPreferencesState;

/**
```

## 3. Runtime integration implementation — bB / vB
```text
33238-    variant: Tt.ERROR
33239-  });
33240-}
33241-function yB({ children: e, name: t, globalVariables: n, layoutDirection: r, nodes: o, edges: i, onSave: l }) {
33242-  return Se(() => {
33243-    J7({
33244-      name: t,
33245-      layoutDirection: r,
33246-      globalVariables: n,
33247-      nodes: o,
33248-      edges: i
33249-    });
33250-  }, [i, n, r, t, o]), /* @__PURE__ */ f(e4, { onSave: l, children: e });
33251-}
33252-const Zh = "workflowBuilderDiagram";
33253:function bB({
33254-  strategy: e,
33255-  endpoints: t,
33256-  onDataSave: n,
33257-  name: r,
33258-  globalVariables: o,
33259-  layoutDirection: i,
33260-  nodes: l,
33261-  edges: s,
33262-  children: c
33263-}) {
33264-  const [{ name: u, globalVariables: d, layoutDirection: p, nodes: m, edges: y }, h] = we(
33265-    () => ({
33266-      name: r,
33267-      globalVariables: o,
33268-      layoutDirection: i,
--
33328-    [e, t == null ? void 0 : t.save, n]
33329-  );
33330-  return /* @__PURE__ */ f(
33331-    yB,
33332-    {
33333-      name: u,
33334-      globalVariables: d,
33335-      layoutDirection: p,
33336-      nodes: m,
33337-      edges: y,
33338-      onSave: g,
33339-      children: c
33340-    }
33341-  );
33342-}
33343:function vB(e) {
33344:  return (e == null ? void 0 : e.strategy) === "api" ? { strategy: "api", endpoints: e.endpoints, onDataSave: void 0 } : (e == null ? void 0 : e.strategy) === "props" ? { strategy: "props", endpoints: void 0, onDataSave: e.onDataSave } : { strategy: "localStorage", endpoints: void 0, onDataSave: void 0 };
33345-}
33346-function wB({ children: e }) {
33347-  return e;
33348-}
33349-const SB = Ut(wB, "OptionalAppChildren");
33350-function xB() {
33351-  return null;
33352-}
33353-const CB = Ut(xB, "OptionalHooks");
33354-function zB() {
33355-  const { i18n: e } = Ne();
33356-  Se(() => {
33357-    function t(n) {
33358-      document.documentElement.lang = n;
33359-    }
--
33412-  logo: c,
33413-  logoHref: u,
33414-  layoutDirection: d,
33415-  initialNodes: p,
33416-  initialEdges: m,
33417-  isValidConnection: y,
33418-  reactFlowProps: h,
33419-  children: g
33420-}) {
33421-  const b = Pe(!1);
33422-  b.current || (b.current = !0, AB(o, i)), mt(() => {
33423-    h5();
33424-  }, []), mt(() => {
33425-    fO();
33426-  }, []), kM(e ?? null), j7(r ?? null), E4(t ?? null), R4(n ?? null), C4(y ?? null), _4(h ?? null), $7({ logo: c, logoHref: u });
33427:  const { strategy: v, endpoints: x, onDataSave: S } = vB(l);
33428-  return /* @__PURE__ */ f(
33429:    bB,
33430-    {
33431-      strategy: v,
33432-      endpoints: x,
33433-      onDataSave: S,
33434-      name: s,
33435-      layoutDirection: d,
33436-      nodes: p,
33437-      edges: m,
33438-      children: /* @__PURE__ */ f(Bv, { children: /* @__PURE__ */ f(DB, { children: g }) })
33439-    }
33440-  );
33441-}
33442-function AB(e, t) {
33443-  var n, r;
33444-  if (e)
```

## 4. Internal integration hydration — yB / J7 / T1
```text
22365-}
22366-function N1(e = {}) {
22367-  const { shouldSkipDynamicValues: t = !0 } = e, n = te.getState();
22368-  return {
22369-    name: n.documentName || "",
22370-    globalVariables: n.globalVariables || {},
22371-    // It removes selected, dynamic points from avoid nodes etc.
22372-    nodes: t ? b5(n.nodes) : n.nodes,
22373-    edges: t ? v5(n.edges) : n.edges,
22374-    layoutDirection: n.layoutDirection
22375-  };
22376-}
22377:function T1(e) {
22378-  te.setState((t) => ({
22379-    documentName: e.name ?? t.documentName,
22380-    globalVariables: e.globalVariables || t.globalVariables,
22381-    nodes: (e.nodes ? v1(e.nodes) : t.nodes).map(ja),
22382-    edges: e.edges ? b1(e.edges) : t.edges,
22383-    layoutDirection: e.layoutDirection ?? t.layoutDirection
22384-  }));
22385-}
22386-function C5() {
22387-  const e = te.getState().nodes, t = u5(e);
22388-  y1(e, t) || te.setState({
22389-    nodes: t
--
30709-    onModalClosed: () => te.getState().setDiagramModel(void 0, { skipIfNotEmpty: !0 })
30710-  });
30711-}
30712-const Dr = ll()(
30713-  Na(
30714-    () => ({
30715-      savingStatus: "disabled",
30716-      lastSaveAttemptTimestamp: Date.now()
30717-    }),
30718-    { name: "integrationStore" }
30719-  )
30720-);
30721:function J7(e) {
30722-  Object.values(e).some(Boolean) ? (T1(e), ur({
30723-    title: "restoreDiagramSuccess",
30724-    variant: Tt.SUCCESS
30725-  })) : Ob(), Dr.setState({
30726-    savingStatus: "waiting",
30727-    lastSaveAttemptTimestamp: Date.now()
30728-  });
30729-}
30730-function Q7() {
30731-  return Dr.getState().savingStatus;
30732-}
30733-function _c(e) {
--
33229-function Tc(e) {
33230-  e != null && e.isAutoSave || ur({
33231-    title: "saveDiagramSuccess",
33232-    variant: Tt.SUCCESS
33233-  });
33234-}
33235-function gB(e) {
33236-  e != null && e.isAutoSave || ur({
33237-    title: "saveDiagramError",
33238-    variant: Tt.ERROR
33239-  });
33240-}
33241:function yB({ children: e, name: t, globalVariables: n, layoutDirection: r, nodes: o, edges: i, onSave: l }) {
33242-  return Se(() => {
33243-    J7({
33244-      name: t,
33245-      layoutDirection: r,
33246-      globalVariables: n,
33247-      nodes: o,
33248-      edges: i
33249-    });
33250-  }, [i, n, r, t, o]), /* @__PURE__ */ f(e4, { onSave: l, children: e });
33251-}
33252-const Zh = "workflowBuilderDiagram";
33253-function bB({
```

## 5. Are J7 / T1 / store setters publicly exported?
```text
344:    globalVariables: VariablesIndex;
596:export declare function getStoreDataForIntegration(params?: GetStoreDataParams): IntegrationDataFormat;
715: * {@link getStoreDataForIntegration} and passed to the host's save
722:    globalVariables: VariablesIndex;
1521:export declare function setStoreNodes(nodes: WorkflowBuilderNode[]): void;
```

## 6. IntegrationDataFormat
```text

declare type InnerHandleId = `${OuterHandleId}:${InnerHandleMarker}:${NodeEntityId}`;

declare type InnerHandleMarker = typeof INNER_HANDLE_MARKER;

/**
 * Canonical persistable shape of a workflow document. Returned by
 * {@link getStoreDataForIntegration} and passed to the host's save
 * callback under the `'props'` strategy.
 *
 * @category Integration
 */
export declare type IntegrationDataFormat = {
    name: string;
    globalVariables: VariablesIndex;
    layoutDirection: LayoutDirection;
    nodes: WorkflowBuilderNode[];
    edges: WorkflowBuilderEdge[];
};

/**
 * Same shape as {@link IntegrationDataFormat} but with every field
 * optional — accepted by load callbacks that may only deliver a partial
 * payload (e.g. just nodes + edges, layoutDirection inferred).
 *
 * @category Integration
 */
export declare type IntegrationDataFormatOptional = Partial<IntegrationDataFormat>;

```

## 7. KALFA — initialGlobalVariables source and usage
```text
src/app/(admin)/admin/workflows/[id]/page.tsx-143-            התהליך השמור לא ניתן לקריאה ונפתח כקנבס ריק. שמירה תדרוס אותו.
src/app/(admin)/admin/workflows/[id]/page.tsx-144-          </span>
src/app/(admin)/admin/workflows/[id]/page.tsx-145-        )}
src/app/(admin)/admin/workflows/[id]/page.tsx-146-      </div>
src/app/(admin)/admin/workflows/[id]/page.tsx-147-
src/app/(admin)/admin/workflows/[id]/page.tsx-148-      <WorkflowEditor
src/app/(admin)/admin/workflows/[id]/page.tsx-149-        key={workflow.id}
src/app/(admin)/admin/workflows/[id]/page.tsx-150-        workflowId={workflow.id}
src/app/(admin)/admin/workflows/[id]/page.tsx-151-        name={workflow.name}
src/app/(admin)/admin/workflows/[id]/page.tsx-152-        layoutDirection={
src/app/(admin)/admin/workflows/[id]/page.tsx-153-          parsed.success ? parsed.data.layoutDirection : undefined
src/app/(admin)/admin/workflows/[id]/page.tsx-154-        }
src/app/(admin)/admin/workflows/[id]/page.tsx:155:        initialGlobalVariables={
src/app/(admin)/admin/workflows/[id]/page.tsx-156-          parsed.success ? parsed.data.globalVariables : undefined
src/app/(admin)/admin/workflows/[id]/page.tsx-157-        }
src/app/(admin)/admin/workflows/[id]/page.tsx-158-        initialNodes={nodes as never}
src/app/(admin)/admin/workflows/[id]/page.tsx-159-        initialEdges={edges as never}
src/app/(admin)/admin/workflows/[id]/page.tsx-160-        whatsappNumbers={whatsappNumbers}
src/app/(admin)/admin/workflows/[id]/page.tsx-161-        voicePurposes={voicePurposes}
src/app/(admin)/admin/workflows/[id]/page.tsx-162-        voiceCallerIds={voiceCallerIds}
src/app/(admin)/admin/workflows/[id]/page.tsx-163-        secretNames={secretNames}
src/app/(admin)/admin/workflows/[id]/page.tsx-164-        saveAction={saveWorkflowAction}
src/app/(admin)/admin/workflows/[id]/page.tsx-165-      />
src/app/(admin)/admin/workflows/[id]/page.tsx-166-
src/app/(admin)/admin/workflows/[id]/page.tsx-167-      <RunNowPanel workflowId={workflow.id} scopedEventId={workflow.eventId} />
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-56-  setEditorCompact,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-57-  setPropertiesOpen,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-58-  usePanelsStore,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-59-} from "./use-panels-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-60-import { setSecretNames } from "./use-secrets-store";
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-61-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-62-type Props = {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-63-  workflowId: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-64-  name: string;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-65-  initialNodes: IntegrationDataFormat["nodes"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-66-  initialEdges: IntegrationDataFormat["edges"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-67-  layoutDirection?: IntegrationDataFormat["layoutDirection"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:68:  initialGlobalVariables?: IntegrationDataFormat["globalVariables"];
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-69-  /**
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-70-   * A Server Action. It carries `requireAdmin` and the ownership check on its
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-71-   * own side — nothing here is authorization, and the browser's copy of the id
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-72-   * is not trusted by it.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-73-   *
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-74-   * It THROWS on failure rather than returning a falsy value. See the comment on
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-75-   * `handleSave`.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-76-   */
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-77-  saveAction: (workflowId: string, definition: unknown) => Promise<void>;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-78-  /**
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-79-   * Our WhatsApp lines, for the trigger node's "which number" dropdown.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-80-   *
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-138-// initialised i18next (the import above is evaluated first, in source order).
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-139-// `addResourceBundle` on an already-initialised instance needs no particular
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-140-// ordering — unlike the "configure i18next before importing the SDK" route
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-141-// upstream describes, which would depend on import order and be fragile here.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-142-applyHebrewToSdk();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-143-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-144-export function WorkflowEditor({
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-145-  workflowId,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-146-  name,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-147-  initialNodes,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-148-  initialEdges,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-149-  layoutDirection,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:150:  initialGlobalVariables,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-151-  whatsappNumbers,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-152-  voicePurposes,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-153-  voiceCallerIds,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-154-  secretNames,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-155-  saveAction,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-156-}: Props) {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-157-  // ── the two live dial lists ────────────────────────────────────────────────
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-158-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-159-  // ⚠️ FETCHED WHEN A CALL NODE IS FIRST SELECTED, never on mount. Opening a
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-160-  // workflow must not depend on Voximplant and ElevenLabs both being reachable,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-161-  // and most workflows have no call node at all. Until the fetch lands the two
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-162-  // dropdowns offer only their blank default, which means "the rule configured
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-281-  // render has already written the new palette into the module variable and
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-282-  // `fetchData()` copies the CURRENT one. Calling it during render would copy
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-283-  // the previous.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-284-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-285-  // Harmless on mount, where it re-takes a snapshot the Palette just took.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-286-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-287-    useStore.getState().fetchData();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-288-  }, [paletteItems]);
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-289-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-290-  // Root 2.3.0 omits globalVariables from its props. Its child effects load
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-291-  // nodes/edges first; this parent effect restores the remaining persisted field.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-292-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:293:    useStore.setState({ globalVariables: initialGlobalVariables ?? {} });
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-294-    resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-295-    resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-296-    return () => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-297-      resetExecution();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-298-      resetPanels();
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-299-    };
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:300:  }, [workflowId, initialGlobalVariables]);
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-301-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-302-  // Published to a module store rather than passed down: the header control is
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-303-  // registered at module scope and mounted by the SDK's own tree, so there is no
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-304-  // props path to it. Same mechanism, same reason, as use-panels-store.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-305-  //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-306-  // `.join()` as the dependency, not the array: `secretNames` is a fresh array
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-307-  // on every server render, and depending on its identity would re-set the store
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-308-  // on every re-render for no change.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-309-  const secretNamesKey = secretNames.join(",");
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-310-  useEffect(() => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-311-    setSecretNames(secretNamesKey === "" ? [] : secretNamesKey.split(","));
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-312-  }, [secretNamesKey]);
--
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-639-) => Promise<DidSaveStatus> {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-640-  return async (data, params) => {
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-641-    // The editor also saves in the background — before the user leaves the page
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-642-    // — at a rate we do not control. Both paths persist; `isAutoSave` is carried
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-643-    // so the action can tell a deliberate save from a background one and the
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-644-    // snackbar stays off for the latter (the runtime already suppresses it).
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-645-    void params?.isAutoSave;
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-646-
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-647-    // The WHOLE payload, not a chosen four fields.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-648-    //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-649-    // This used to rebuild `{ name, layoutDirection, nodes, edges }` — the shape
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-650-    // the docs site documents for IntegrationDataFormat. The installed
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx:651:    // `dist/index.d.ts` declares a fifth, `globalVariables: VariablesIndex`,
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-652-    // which appears nowhere in their published docs. Cherry-picking therefore
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-653-    // silently erased the diagram's global variables on every save, including
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-654-    // every background auto-save.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-655-    //
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-656-    // Passing `data` straight through also means the next field they add
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-657-    // survives instead of being dropped until someone notices. The column stores
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-658-    // the editor's format verbatim precisely so this can be a pass-through.
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-659-    // ⚠️ MINUS THE EDITOR'S OWN VALIDATION STATE. `properties.errors` is written
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-660-    // by the SDK on every change and `properties.customErrors` by our arm-blocker
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-661-    // sync; neither is diagram CONTENT, and eight of the twenty-two nodes stored
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-662-    // today already carry a stale `errors` array because nothing ever stripped
src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx-663-    // them. Schema errors are self-healing — the SDK recomputes them on load —
```

## 8. KALFA — lifecycle effect
```text
  // before running the parent's effects, so by the time this runs, `<Root>`'s
  // render has already written the new palette into the module variable and
  // `fetchData()` copies the CURRENT one. Calling it during render would copy
  // the previous.
  //
  // Harmless on mount, where it re-takes a snapshot the Palette just took.
  useEffect(() => {
    useStore.getState().fetchData();
  }, [paletteItems]);

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
```

## 9. SDK — all globalVariables runtime references
```text
242-    tab: {
243-      general: "General",
244-      generalDescription: "General settings",
245:      globalVariables: "Global variables",
246:      globalVariablesDescription: "Manage reusable workflow variables",
247-      addVariable: "Add variable",
248-      editVariable: "Edit variable",
249-      removeVariable: "Delete variable",
--
454-    tab: {
455-      general: "Ogólne",
456-      generalDescription: "Ogólne ustawienia",
457:      globalVariables: "Zmienne globalne",
458:      globalVariablesDescription: "Zarządzaj wielokrotnego użytku zmiennymi workflow",
459-      addVariable: "Dodaj zmienną",
460-      editVariable: "Edytuj zmienną",
461-      removeVariable: "Usuń zmienną",
--
22193-    edges: [],
22194-    reactFlowInstance: null,
22195-    documentName: null,
22196:    globalVariables: {},
22197-    isReadOnlyMode: !1,
22198-    layoutDirection: "RIGHT",
22199-    connectionBeingDragged: null,
--
22367-  const { shouldSkipDynamicValues: t = !0 } = e, n = te.getState();
22368-  return {
22369-    name: n.documentName || "",
22370:    globalVariables: n.globalVariables || {},
22371-    // It removes selected, dynamic points from avoid nodes etc.
22372-    nodes: t ? b5(n.nodes) : n.nodes,
22373-    edges: t ? v5(n.edges) : n.edges,
--
22377-function T1(e) {
22378-  te.setState((t) => ({
22379-    documentName: e.name ?? t.documentName,
22380:    globalVariables: e.globalVariables || t.globalVariables,
22381-    nodes: (e.nodes ? v1(e.nodes) : t.nodes).map(ja),
22382-    edges: e.edges ? b1(e.edges) : t.edges,
22383-    layoutDirection: e.layoutDirection ?? t.layoutDirection
--
22391-}
22392-function D1(e) {
22393-  te.setState((t) => ({
22394:    globalVariables: {
22395:      ...t.globalVariables,
22396-      [e.id]: e
22397-    }
22398-  }));
22399-}
22400-function z5(e) {
22401-  te.setState((t) => {
22402:    const { [e]: n, ...r } = t.globalVariables;
22403-    return {
22404:      globalVariables: r
22405-    };
22406-  });
22407-}
--
23517-    layoutDirection: "RIGHT",
23518-    nodes: [],
23519-    edges: [],
23520:    globalVariables: {}
23521-  }, r = [], o = [];
23522-  if (t != null && t.name && typeof t.name == "string" && (n.name = t.name), t.layoutDirection && sO(t.layoutDirection) && (n.layoutDirection = t.layoutDirection), Array.isArray(t.nodes)) {
23523-    const { knownNodes: l, unknownNodes: s } = t.nodes.reduce(
--
23538-      messageParams: { nodesIds: c.join(", ") }
23539-    });
23540-  }
23541:  return Array.isArray(t.edges) && (n.edges = t.edges), typeof t.globalVariables == "object" && (n.globalVariables = t.globalVariables), r.length > 0 ? {
23542-    hasErrors: !0,
23543-    errors: r,
23544-    warnings: o,
--
23674-  tabs: wO
23675-}, tl = {
23676-  GENERAL: "general",
23677:  GLOBAL_VARIABLES: "globalVariables"
23678-}, SO = "_container_evduo_5", xO = "_button_evduo_16", wc = {
23679-  container: SO,
23680-  button: xO,
--
23944-    return;
23945-  const n = t.slice(Er.length).slice(0, -1 * $i.length);
23946-  if (n.startsWith(Od)) {
23947:    const [c, u] = n.split("."), d = te.getState().globalVariables[u];
23948-    return d ? d.type : void 0;
23949-  }
23950-  if (n.startsWith(za)) {
--
30385-  return `${Od}.${e}`;
30386-}
30387-function c7({ className: e, setActivePane: t, id: n }) {
30388:  const r = te((s) => s.globalVariables[n]), { t: o } = Ne(), i = X(
30389-    (s) => {
30390-      D1(s), t(Dt.LIST);
30391-    },
--
30428-  ] });
30429-}
30430-function b7({ id: e, onEdit: t, onRemove: n }) {
30431:  const r = te((i) => i.globalVariables[e]), { t: o } = Ne();
30432-  return r ? /* @__PURE__ */ H("div", { className: xi.container, children: [
30433-    /* @__PURE__ */ H("div", { className: xi.line, children: [
30434-      /* @__PURE__ */ f(Tb, { name: r.name, type: r.type }),
--
30441-  ] }) : null;
30442-}
30443-function v7({ className: e, setActivePane: t }) {
30444:  const n = te((i) => i.globalVariables), { t: r } = Ne(), o = ze(() => Object.keys(n), [n]);
30445-  return /* @__PURE__ */ H("div", { className: be(zc.container, e), "data-no-b-pd": !0, children: [
30446-    /* @__PURE__ */ f(
30447-      Ua,
30448-      {
30449:        title: "workflowsSettings.tab.globalVariables",
30450:        description: "workflowsSettings.tab.globalVariablesDescription",
30451-        children: /* @__PURE__ */ H(lt, { variant: "secondary", size: "extra-small", onClick: () => t(Dt.ADD), children: [
30452-          /* @__PURE__ */ f(_e, { name: "Plus" }),
30453-          r("workflowsSettings.tab.addVariable")
--
30473-  buttons: C7
30474-};
30475-function z7({ className: e, setActivePane: t, id: n }) {
30476:  const r = te((s) => s.globalVariables[n]), { t: o } = Ne(), i = X(() => {
30477-    z5(n), t(Dt.LIST);
30478-  }, [n, t]), l = ze(() => {
30479-    const s = Vd(n);
--
32426-  return c;
32427-}
32428-function Cs(e, t = []) {
32429:  const n = te((c) => c.globalVariables), r = te((c) => c.nodes), o = te((c) => c.edges), { t: i } = Ne(), l = ze(() => {
32430-    const c = Object.values(n).filter(QV).map((d) => ({
32431-      id: Vd(d.id),
32432-      display: bu(d.name, 25),
--
32435-      type: d.type
32436-    }));
32437-    return [{
32438:      label: i("workflowsSettings.tab.globalVariables"),
32439-      icon: "Gear",
32440-      suggestions: c
32441-    }];
--
33238-    variant: Tt.ERROR
33239-  });
33240-}
33241:function yB({ children: e, name: t, globalVariables: n, layoutDirection: r, nodes: o, edges: i, onSave: l }) {
33242-  return Se(() => {
33243-    J7({
33244-      name: t,
33245-      layoutDirection: r,
33246:      globalVariables: n,
33247-      nodes: o,
33248-      edges: i
33249-    });
--
33255-  endpoints: t,
33256-  onDataSave: n,
33257-  name: r,
33258:  globalVariables: o,
33259-  layoutDirection: i,
33260-  nodes: l,
33261-  edges: s,
33262-  children: c
33263-}) {
33264:  const [{ name: u, globalVariables: d, layoutDirection: p, nodes: m, edges: y }, h] = we(
33265-    () => ({
33266-      name: r,
33267:      globalVariables: o,
33268-      layoutDirection: i,
33269-      nodes: l,
33270-      edges: s
--
33278-        const v = JSON.parse(b);
33279-        h({
33280-          name: v.name,
33281:          globalVariables: v.globalVariables,
33282-          layoutDirection: v.layoutDirection,
33283-          nodes: v.nodes,
33284-          edges: v.edges
--
33331-    yB,
33332-    {
33333-      name: u,
33334:      globalVariables: d,
33335-      layoutDirection: p,
33336-      nodes: m,
33337-      edges: y,
```

## 10. SDK — fetchData implementation
```text
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1159-export declare type PaletteItemOrGroup = PaletteItem | PaletteGroup;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1160-
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1161-declare type PaletteState = {
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1162-    isSidebarExpanded: boolean;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1163-    data: PaletteItemOrGroup[];
node_modules/@workflowbuilder/sdk/dist/index.d.ts:1164:    fetchDataStatus: StatusType;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1165-    draggedItem: DraggingItem | null;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1166-    toggleSidebar: (value?: boolean) => void;
node_modules/@workflowbuilder/sdk/dist/index.d.ts:1167:    fetchData: () => void;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1168-    setDraggedItem: (item: DraggingItem | null) => void;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1169-    getNodeDefinition: (nodeType: string) => PaletteItem | undefined;
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1170-};
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1171-
node_modules/@workflowbuilder/sdk/dist/index.d.ts-1172-/**
--
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22262-}
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22263-function p5(e, t) {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22264-  return {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22265-    isSidebarExpanded: !1,
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22266-    data: [],
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:22267:    fetchDataStatus: pa.Idle,
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22268-    draggedItem: null,
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22269-    setDraggedItem: (n) => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22270-      e({ draggedItem: n });
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22271-    },
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22272-    toggleSidebar: (n) => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22273-      e({
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22274-        isSidebarExpanded: n ?? !t().isSidebarExpanded
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22275-      });
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22276-    },
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:22277:    fetchData: () => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:22278:      e({ fetchDataStatus: pa.Loading }), e({
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22279-        data: C1(),
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:22280:        fetchDataStatus: pa.Success
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22281-      }), setTimeout(() => C5(), 0);
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22282-    },
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22283-    getNodeDefinition: (n) => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22284-      const { data: r } = t(), o = r.find((l) => (l == null ? void 0 : l.type) === n);
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-22285-      if (o)
--
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32136-    onMouseDown: i,
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32137-    onDragStart: l
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32138-  };
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32139-}
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32140-function cv() {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:32141:  const e = te((d) => d.toggleSidebar), t = te((d) => d.fetchData), n = te((d) => d.isSidebarExpanded), r = te((d) => d.data), o = te((d) => d.isReadOnlyMode), { draggedItem: i, zoom: l, ref: s, onMouseDown: c, onDragStart: u } = PV(!o);
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32142-  return Se(() => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32143-    t();
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32144-  }, [t]), /* @__PURE__ */ H(
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32145-    lv,
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-32146-    {
--
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33113-      i === "sourceHandle" && typeof o[i] == "string" ? t.push(o[i]) : n(o[i]);
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33114-  }
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33115-  return n(e), t;
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33116-}
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33117-const pB = rt(({ node: e }) => {
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js:33118:  const t = te((y) => y.fetchDataStatus), n = te((y) => y.getNodeDefinition), r = te((y) => y.setNodeProperties), o = te((y) => y.isReadOnlyMode), { data: i, id: l } = e, { properties: s, type: c } = i, u = n(c);
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33119-  if (!u || t === pa.Loading)
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33120-    return;
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33121-  const { schema: d, uischema: p } = u;
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33122-  return /* @__PURE__ */ f(
node_modules/@workflowbuilder/sdk/dist/index-CEBfv0NZ.js-33123-    cB,
```
