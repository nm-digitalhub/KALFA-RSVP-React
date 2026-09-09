> מקור: https://www.workflowbuilder.io/docs/api/plugins/registerfunctiondecorator/
> נשמר: 2026-09-09

# registerFunctionDecorator

**registerFunctionDecorator**(`functionName`, `plugin`): `void`

Decorate a named SDK function — observe its calls or transform its arguments / return value without forking.

Common decoration targets: `'trackFutureChange'` (state-mutation tracking), diagram-listener emitters, save callbacks. See the [Build a plugin](https://www.workflowbuilder.io/docs/guides/build-a-plugin/) guide for the authoritative list of decoratable functions.

Safe to call more than once; pass `plugin.name` to deduplicate.

## Parameters

### functionName

`string`

### plugin

[`FunctionDecoratorOptions`](https://www.workflowbuilder.io/docs/api/plugins/functiondecoratoroptions/)

## Returns

`void`

## Example
```ts
registerFunctionDecorator('trackFutureChange', {
  place: 'after',
  callback: ({ params }) => auditLog(params),
  name: 'audit-log',
});
```
