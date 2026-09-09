> מקור: https://www.workflowbuilder.io/docs/api/components/workflowbuilderedgetemplates/
> נשמר: 2026-09-09

# WorkflowBuilderEdgeTemplates

**WorkflowBuilderEdgeTemplates** = `Record`<`string`, `ComponentType`<`EdgeProps`<[`WorkflowBuilderEdge`](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)>>>

Per-edge-type custom renderer registry. Keys are `edge.type` values; values are React components that take ReactFlow’s EdgeProps (typed for [WorkflowBuilderEdge](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)) and replace the default edge renderer for matching edges.

Unlike node templates, edge templates need no adapter: the built-in edges already take `EdgeProps` directly, so a consumer component drops straight into ReactFlow’s edge-type map with no wrapping.
