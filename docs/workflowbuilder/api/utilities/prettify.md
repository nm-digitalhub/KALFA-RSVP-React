> מקור: https://www.workflowbuilder.io/docs/api/utilities/prettify/
> נשמר: 2026-09-09

# Prettify

**Prettify**<`T`> = `{ [K in keyof T]: T[K] }` & `object`

Forces TypeScript to flatten an intersection / mapped type into a single object literal. Doesn’t change semantics — only what TS shows in tooltips and error messages.

## Type Parameters

### T

`T`
