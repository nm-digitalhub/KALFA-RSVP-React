> מקור: https://www.workflowbuilder.io/docs/api/store/trackfuturechange/
> נשמר: 2026-09-09

# trackFutureChange

`const` **trackFutureChange**: (…`params`) => `void`

Mark that a tracked change is about to occur. Updates the [useChangesTrackerStore](https://www.workflowbuilder.io/docs/api/store/usechangestrackerstore/) so subscribers see the new `lastChangeName` / `lastChangeTimestamp`.

Wrapped with `withOptionalFunctionPlugins`, so plugins can decorate it via [registerFunctionDecorator](https://www.workflowbuilder.io/docs/api/plugins/registerfunctiondecorator/) keyed `'trackFutureChange'` to observe or transform every change before it reaches the store.

## Parameters

### params

…[`string`, `object`]

Optional metadata about the change.

## Returns

`void`
