> מקור: https://www.workflowbuilder.io/docs/api/components/definenodetemplate/
> נשמר: 2026-09-09

# defineNodeTemplate

**defineNodeTemplate**<`P`>(`template`): `ComponentType`<[`WorkflowNodeTemplateProps`](https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/)>

Erases the per-schema `P` parameter from a typed node template so it can be stored in a NodeTemplatesMap without consumer-side casts.

The cast is safe in practice: SDK only mounts a template for a node whose palette schema produces `P`. The pair (palette item, template) carries the runtime guarantee; TypeScript cannot express that link, so we erase the parameter here in one well-documented spot.

## Type Parameters

### P

`P`

## Parameters

### template

`ComponentType`<[`WorkflowNodeTemplateProps`](https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/)<`P`>>

## Returns

`ComponentType`<[`WorkflowNodeTemplateProps`](https://www.workflowbuilder.io/docs/api/components/workflownodetemplateprops/)>

## Example
```ts
type MultiPortProperties = NodeDataProperties<typeof multiPortSchema>;

export const MultiPortNodeTemplate = defineNodeTemplate<MultiPortProperties>(
  memo(({ data }: WorkflowNodeTemplateProps<MultiPortProperties>) => {
    const status = data?.properties.status ?? 'active';
    return <NodePanel.Root>…</NodePanel.Root>;
  }),
);
```
