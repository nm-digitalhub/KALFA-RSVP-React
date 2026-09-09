> מקור: https://www.workflowbuilder.io/docs/api/core/workflowbuilderroot/
> נשמר: 2026-09-09

# WorkflowBuilderRoot

**WorkflowBuilderRoot**(`__namedParameters`): `Element`

Top-level component that wires up the Workflow Builder editor. Provides the per-instance store, integration wrapper, ReactFlow context, global overlay (snackbar, loader, plugin hooks), and renders either the supplied children or `<DefaultLayout />` as a fallback.

## Parameters

### __namedParameters

[`WorkflowBuilderRootProps`](https://www.workflowbuilder.io/docs/api/core/workflowbuilderrootprops/)

## Returns

`Element`

## Examples
```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

export function App() {
  return <WorkflowBuilder.Root nodeTypes={myNodeTypes} />;
}
```
```
<WorkflowBuilder.Root nodeTypes={myNodeTypes}>  <header><WorkflowBuilder.TopBar /></header>  <aside><WorkflowBuilder.Palette /></aside>  <main><WorkflowBuilder.Canvas /></main>  <aside><WorkflowBuilder.PropertiesPanel /></aside></WorkflowBuilder.Root>
```
