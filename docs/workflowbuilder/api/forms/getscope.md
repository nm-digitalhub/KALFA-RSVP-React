> מקור: https://www.workflowbuilder.io/docs/api/forms/getscope/
> נשמר: 2026-09-09

# getScope

**getScope**<`T`>(`path`): `string`

Build a JsonForms `scope` pointer from a typed dot-path. Equivalent to the JsonPointer fragment-encoding rule: turns `'properties.label'` into `'#/properties/label'`. Generic over the schema type so TypeScript autocompletes valid paths.

## Type Parameters

### T

`T` *extends* `object`

## Parameters

### path

`""` | `PropertyPath`<`T`>

## Returns

`string`

## Example
```ts
getScope<typeof mySchema>('properties.label');
// => '#/properties/label'
```
## See

[https://jsonforms.io/docs/uischema/controls/#scope-string](https://jsonforms.io/docs/uischema/controls/#scope-string)
