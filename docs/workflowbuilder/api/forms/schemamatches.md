> מקור: https://www.workflowbuilder.io/docs/api/forms/schemamatches/
> נשמר: 2026-09-09

# schemaMatches

`const` **schemaMatches**: (`predicate`) => `Tester` = `JsonFormsCore.schemaMatches`

Tester matching when the bound schema fragment satisfies a predicate.

Only applicable for Controls.

This function checks whether the given UI schema is of type Control and if so, resolves the sub-schema referenced by the control and applies the given predicate

## Parameters

### predicate

(`schema`, `rootSchema`) => `boolean`

the predicate that should be applied to the resolved sub-schema

## Returns

`Tester`
