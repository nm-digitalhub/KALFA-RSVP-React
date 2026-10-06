> מקור: https://www.workflowbuilder.io/docs/api/plugins/registercomponentdecorator/
> נשמר: 2026-09-09

# registerComponentDecorator

**registerComponentDecorator**<`P`>(`componentName`, `plugin`): `void`

Decorate a named slot — add UI before/after/around it or transform its props.

Slots are mount points the SDK exposes for plugins to inject custom UI without forking the editor. Common slots include `'OptionalAppBarControls'`, `'OptionalNodeContent'`, and others — see the [Build a plugin](https://www.workflowbuilder.io/docs/guides/build-a-plugin/) guide for the authoritative list.

Safe to call more than once; pass `plugin.name` to deduplicate.

## Type Parameters

### P

`P`

## Parameters

### componentName

`string`

Slot identifier (e.g. `'OptionalAppBarControls'`).

### plugin

[`ComponentDecoratorOptions`](https://www.workflowbuilder.io/docs/api/plugins/componentdecoratoroptions/)<`P`>

Decorator configuration. See [ComponentDecoratorOptions](https://www.workflowbuilder.io/docs/api/plugins/componentdecoratoroptions/).

## Returns

`void`

## Example
```ts
registerComponentDecorator('OptionalAppBarControls', {
  content: MyButton,
  place: 'after',
  name: 'analytics-button',
});
```
