> מקור: https://www.workflowbuilder.io/docs/api/components/workflowbuildernodetemplates/
> נשמר: 2026-09-09

# WorkflowBuilderNodeTemplates

**WorkflowBuilderNodeTemplates** = `Record`<`string`, `ComponentType`<[`WorkflowNodeTemplateProps`](https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/)>>

Per-node-type custom template registry. Keys are `data.type` values from the palette; values are React components that take [WorkflowNodeTemplateProps](https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/) and replace the default node renderer for matching nodes.
