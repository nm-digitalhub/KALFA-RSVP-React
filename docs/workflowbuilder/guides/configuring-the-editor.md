> מקור: https://www.workflowbuilder.io/docs/guides/configuring-the-editor/
> נשמר: 2026-09-09

# Configuring the editor

Pass node types, integration strategy, plugins, and JsonForms extensions to WorkflowBuilder.Root.

`<WorkflowBuilder.Root>` is the main entry point of the SDK. Mount it at the top of your editor subtree with the props you need. The full type-level reference lives at [`WorkflowBuilderRoot`](https://www.workflowbuilder.io/docs/api/core/workflowbuilderroot/) under API Reference; this page focuses on what each prop does and when you reach for it.
```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

<WorkflowBuilder.Root nodeTypes={[/* ... */]} integration={/* ... */} />;
```
## Props reference

Every prop is optional. The **Type** column links to the auto-generated [API Reference](https://www.workflowbuilder.io/docs/api/core/workflowbuilderrootprops/) for the exact shape. The **Description** points to the section or guide that shows how to use each prop, and notes the default where there is one.
``[``](https://www.workflowbuilder.io/docs/api/integration/workflowbuilderintegration/)````[``](https://www.workflowbuilder.io/docs/api/types/paletteitemorgroup/)````[``](https://www.workflowbuilder.io/docs/api/components/workflowbuildernodetemplates/)````[``](https://www.workflowbuilder.io/docs/api/components/workflowbuilderedgetemplates/)``````[``](https://www.workflowbuilder.io/docs/api/types/templatemodel/)````[``](https://www.workflowbuilder.io/docs/api/plugins/workflowbuilderjsonformconfig/)``[``](https://www.workflowbuilder.io/docs/api/plugins/workflowbuilderplugin/)````````````````[``](https://www.workflowbuilder.io/docs/api/types/layoutdirection/)````````[``](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)````````[``](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)````````[``](https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnection/)``[``](https://www.workflowbuilder.io/docs/api/core/workflowbuilderreactflowprops/)````
| Prop | Type | Description |
|---|---|---|
| integration | WorkflowBuilderIntegration | How the builder loads and persists diagram data. Defaults to { strategy: 'localStorage' }. See Integration strategies. |
| nodeTypes | PaletteItemOrGroup[] | Node type definitions rendered in the palette and used for validation. Defaults to [] (empty palette). See Node types. |
| nodeTemplates | WorkflowBuilderNodeTemplates | Per-node-type custom renderers, keyed by data.type. See Custom node and edge renderers. |
| edgeTemplates | WorkflowBuilderEdgeTemplates | Per-edge-type custom renderers, keyed by edge.type, overriding the built-in 'labelEdge'. See Custom node and edge renderers. |
| diagramTemplates | TemplateModel[] | Starter diagrams offered in the template selector. Defaults to []. |
| jsonForm | WorkflowBuilderJsonFormConfig | Custom JSONForms renderers, cells, and translations for the properties panel. See Custom JsonForms control. |
| plugins | WorkflowBuilderPlugin[] | Plugin initializer functions, each called once on first mount. See Build a plugin. |
| name | string | Workflow name shown in the header and included in saved data. |
| logo | WorkflowBuilderLogo | Replaces the built-in app-bar logo: an image URL, { light, dark } per-theme URLs, or a custom element. |
| logoHref | string | Wraps the app-bar logo (built-in or custom) in a link opened in a new tab. |
| layoutDirection | LayoutDirection | Initial flow direction, 'DOWN' or 'RIGHT'. Defaults to 'DOWN'. |
| initialNodes | WorkflowBuilderNode[] | Initial nodes for the props integration strategy. Defaults to []. See props. |
| initialEdges | WorkflowBuilderEdge[] | Initial edges for the props integration strategy. Defaults to []. See props. |
| isValidConnection | WorkflowBuilderIsValidConnection | Validate connections as the user draws them. See Connection validation. |
| reactFlowProps | WorkflowBuilderReactFlowProps | Escape hatch forwarding extra props to the underlying ReactFlow canvas. See Advanced: ReactFlow props. |
| children | ReactNode | Custom layout. Omit for the default floating-overlay layout. See Compound subcomponents. |

## Compound subcomponents

Build your own layout by composing the namespaced subcomponents:
``````````
| Component | Renders |
|---|---|
| WorkflowBuilder.TopBar | App-bar with name, controls, toolbar. |
| WorkflowBuilder.Palette | Palette of node types (draggable). |
| WorkflowBuilder.Canvas | xyflow canvas with nodes, edges, drag-drop. |
| WorkflowBuilder.PropertiesPanel | Properties sidebar driven by JsonForms. |
| WorkflowBuilder.DefaultLayout | The default floating-overlay arrangement of the four above. |

Pass children to skip the default layout and compose your own:
```
<WorkflowBuilder.Root nodeTypes={myNodeTypes}>  <header>    <WorkflowBuilder.TopBar />  </header>  <aside>    <WorkflowBuilder.Palette />  </aside>  <main>    <WorkflowBuilder.Canvas />  </main>  <aside>    <WorkflowBuilder.PropertiesPanel />  </aside></WorkflowBuilder.Root>
```
