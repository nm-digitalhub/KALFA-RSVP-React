> מקור: https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/
> נשמר: 2026-09-09

# WorkflowNodeTemplateProps

**WorkflowNodeTemplateProps**<`P`> = `object`

Props for the editor’s default workflow-node template. A custom node type wraps this template (or composes its parts) to render its body — see [Add a custom node](https://www.workflowbuilder.io/docs/guides/add-a-custom-node/) for the full pattern.

`id`, `icon`, `label`, `description` define the header. `selected` / `isValid` drive visual state. `showHandles` toggles the connection dots; `layoutDirection` controls which sides those dots sit on. `children` are rendered inside a collapsible body section.

Generic over `P` so consumer templates can narrow `data.properties` to their schema’s shape without casts:
```ts
type MyProps = WorkflowNodeTemplateProps<NodeDataProperties<MySchema>>;
```
Defaults to the wide `BaseNodeProperties & Record<string, unknown>` so existing usages remain backward-compatible.

## Type Parameters

### P

`P` = `BaseNodeProperties` & `Record`<`string`, `unknown`>
