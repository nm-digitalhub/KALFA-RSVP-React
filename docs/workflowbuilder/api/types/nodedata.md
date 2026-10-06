> מקור: https://www.workflowbuilder.io/docs/api/types/nodedata/
> נשמר: 2026-09-09

# NodeData

**NodeData**<`T`> = `object`

Per-node data attached to every [WorkflowBuilderNode](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/). The `properties` field carries the node’s user-editable values (typed by `T`); `type` matches the corresponding `NodeDefinition.type`; `icon` is the icon shown in palette and on the diagram canvas.

Generic over `T` so concrete node types can refine `properties` to their own schema-driven shape (typically via `NodeDataProperties<MySchema>`).

## Type Parameters

### T

`T` = `BaseNodeProperties` & `Record`<`string`, `unknown`>
