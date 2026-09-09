> מקור: https://www.workflowbuilder.io/docs/api/core/workflowbuilder/
> נשמר: 2026-09-09

# WorkflowBuilder

`const` **WorkflowBuilder**: `Readonly`<{ `Canvas`: `MemoExoticComponent`<(`props`) => `Element`>; `DefaultLayout`: () => `Element`; `Palette`: () => `Element`; `PropertiesPanel`: () => `Element`; `Root`: (`__namedParameters`) => `Element`; `TopBar`: () => `Element`; }>

Workflow Builder compound component. Mount `<WorkflowBuilder.Root>` at the top of the editor subtree; compose with `.TopBar`, `.Palette`, `.Canvas`, `.PropertiesPanel`, or `.DefaultLayout` as children (or omit children to get the default floating-overlay layout).
```tsx
import { WorkflowBuilder } from '@workflowbuilder/sdk';

<WorkflowBuilder.Root nodeTypes={myNodeTypes} />
```
