> מקור: https://www.workflowbuilder.io/docs/api/forms/optionis/
> נשמר: 2026-09-09

# optionIs

`const` **optionIs**: (`optionName`, `optionValue`) => `Tester` = `JsonFormsCore.optionIs`

Tester matching by a uischema element `options` value.

Checks whether the given UI schema has an option with the given name and whether it has the expected value. If no options property is set, returns false.

## Parameters

### optionName

`string`

the name of the option to check

### optionValue

`any`

the expected value of the option

## Returns

`Tester`
