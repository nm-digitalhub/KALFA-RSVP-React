> מקור: https://www.workflowbuilder.io/docs/api/core/workflowbuilderreactflowprops/
> נשמר: 2026-09-09

# WorkflowBuilderReactFlowProps

**WorkflowBuilderReactFlowProps** = `Omit`<`ReactFlowProps`<[`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/), [`WorkflowBuilderEdge`](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)>, `AssertAssignable`<`SdkOwnedReactFlowKey`, keyof `ReactFlowProps`<[`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/), [`WorkflowBuilderEdge`](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)>>>

Escape hatch for the underlying ReactFlow canvas: forwards any ReactFlow prop except the ones the SDK owns (SdkOwnedReactFlowKey). Theme via the SDK design tokens, not `colorMode`.

Treat as static config: the canvas reads it out-of-band, so changing a value at runtime may not apply until the canvas re-renders.
