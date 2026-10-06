> מקור: https://www.workflowbuilder.io/docs/api/forms/schematypeis/
> נשמר: 2026-09-09

# schemaTypeIs

`const` **schemaTypeIs**: (`expectedType`) => `Tester` = `JsonFormsCore.schemaTypeIs`

Tester matching by the bound schema’s `type`.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and checks whether the type of the sub-schema matches the expected one.

## Parameters

### expectedType

`string`

the expected type of the resolved sub-schema

## Returns

`Tester`
