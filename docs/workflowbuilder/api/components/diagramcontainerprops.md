> מקור: https://www.workflowbuilder.io/docs/api/components/diagramcontainerprops/
> נשמר: 2026-09-09

# DiagramContainerProps

**DiagramContainerProps** = `object`

Props accepted by [DiagramContainer](https://www.workflowbuilder.io/docs/api/components/workflowbuildercanvas/). Use this when typing a `registerComponentDecorator<DiagramContainerProps>('DiagramContainer', …)` call.

## Properties

### edgeTypes?

`optional` **edgeTypes?**: `EdgeTypes`

Extra edge types forwarded to ReactFlow alongside the built-in `'labelEdge'` and any Root-level `edgeTemplates`. Merged last, so a key here intentionally overrides those (this is the direct-mount escape hatch, hence no collision warning); prefer `<WorkflowBuilder.Root edgeTemplates>` for app-wide edges.
