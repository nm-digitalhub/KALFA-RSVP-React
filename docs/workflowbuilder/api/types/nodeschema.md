> מקור: https://www.workflowbuilder.io/docs/api/types/nodeschema/
> נשמר: 2026-09-09

# NodeSchema

**NodeSchema** = `ObjectFieldRequiredValidationSchema` & `object`

JSON-schema-like description of a node type’s editable properties.

Drives three things at runtime:

1. **Validation** — values are checked against this shape; failures bubble into `NodeData.properties.errors` for UI display.

1. **Rendering** — JsonForms uses the schema (combined with an optional [UISchema](https://www.workflowbuilder.io/docs/api/types/uischema/)) to render the property panel.

1. **Type inference** — `NodeDataProperties<MySchema>` extracts a precise TypeScript type for a node’s `properties`.

## Type Declaration

### allOf?

`optional` **allOf?**: [`IfThenElseSchema`](https://www.workflowbuilder.io/docs/api/types/ifthenelseschema/)[]

### properties

**properties**: `NodePropertiesSchema`
