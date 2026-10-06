> מקור: https://www.workflowbuilder.io/docs/api/forms/rankwith/
> נשמר: 2026-09-09

# rankWith

`const` **rankWith**: (`rank`, `tester`) => (`uischema`, `schema`, `context`) => `number` = `JsonFormsCore.rankWith`

Assigns a priority to a tester; rank above the built-ins to override a control.

Create a ranked tester that will associate a number with a given tester, if the latter returns true.

## Parameters

### rank

`number`

the rank to be returned in case the tester returns true

### tester

`Tester`

a tester

## Returns

(`uischema`, `schema`, `context`) => `number`
