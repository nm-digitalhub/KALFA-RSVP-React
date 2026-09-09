> מקור: https://www.workflowbuilder.io/docs/api/types/nodedataproperties/
> נשמר: 2026-09-09

# NodeDataProperties

**NodeDataProperties**<`T`> = `MakePropertiesOptional`<`ExtractProperties`<`T`>>

Derives a TypeScript type for a node’s `data.properties` directly from its [NodeSchema](https://www.workflowbuilder.io/docs/api/types/nodeschema/). Each property is optional (matching the runtime, where partial form-state is normal).

## Type Parameters

### T

`T`

## Example
```ts
const schema = { type: 'object', properties: { count: { type: 'number' } } } as const;
type Props = NodeDataProperties<typeof schema>; // { count?: number }
```
