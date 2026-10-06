> מקור: https://www.workflowbuilder.io/docs/api/forms/formatis/
> נשמר: 2026-09-09

# formatIs

`const` **formatIs**: (`expectedFormat`) => `Tester` = `JsonFormsCore.formatIs`

Tester matching by the bound schema’s `format`.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and checks whether the format of the sub-schema matches the expected one.

## Parameters

### expectedFormat

`string`

the expected format of the resolved sub-schema

## Returns

`Tester`
